import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameRegistry, getGameAdapter } from '../app/games/registry.js';
import { fe1 } from '../app/games/fe1.js';
import { getModel } from '../app/models.js';
import { generateComment, parseModelComment } from '../app/claude.js';
import { Watcher } from '../app/watcher.js';

test('only explicitly registered games with valid state can use an adapter', () => {
  assert.equal(getGameAdapter({ profile_id: 'unknown', units: [] }), null);
  assert.equal(getGameAdapter({ profile_id: fe1.id, units: [{ hp: 18 }] }), null);
  assert.throws(() => createGameRegistry([fe1, fe1]), /Duplicate/);
  assert.throws(() => createGameRegistry([{ id: 'incomplete' }]), /missing/);
});

test('unregistered game state never triggers FE commentary', async () => {
  let calls = 0;
  const watcher = new Watcher({ tone: 'companion', authenticate: async () => ({ plan: 'pro' }), includedOnlyConfirmed: true,
    generate: async () => { calls++; } });
  await watcher.start();
  watcher.accept({ game_state: { profile_id: 'unsupported', units: [] }, recent_observations: { timeline_id: 't', events: [{ event_id: 1, type: 'hp_changed', side: 'player', from: 18, to: 10 }] } });
  await watcher.maybeGenerate();
  assert.equal(calls, 0);
  assert.match(watcher.publicState().message, /対応していません/);
  watcher.stop();
});

test('the shared watcher supports a different test-only state and event schema through its adapter', async () => {
  const adapter = { id: 'test-only', title: 'Registry contract fixture',
    accepts: state => Number.isFinite(state.value),
    selectCandidate: pending => pending.length ? { ...pending[0], priority: 2, category: 'change', context: { fixture: true } } : null,
    fingerprint: state => String(state.value), summarize: state => ({ value: state.value }),
    describe: state => `Value ${state.value}`, instructions: 'Test-specific instructions.' };
  const registry = createGameRegistry([adapter]);
  let now = 0, received;
  const watcher = new Watcher({ tone: 'companion', resolveGame: registry.resolve, clock: () => now,
    authenticate: async () => ({ plan: 'pro' }), includedOnlyConfirmed: true, model: 'haiku',
    generate: async (payload, options) => { received = { payload, options }; return { speak: true, comment: '変化を確認。' }; } });
  await watcher.start();
  const state = events => ({ game_state: { profile_id: adapter.id, value: 2 }, recent_observations: { timeline_id: 'test:1', events } });
  watcher.accept(state([]));
  watcher.accept(state([{ event_id: 1, type: 'test-value-changed' }]));
  now = 2500; await watcher.maybeGenerate();
  assert.deepEqual(received.payload.game, { value: 2 });
  assert.match(received.options.instructions, /Test-specific/);
  assert.doesNotMatch(received.options.instructions, /ファイアーエムブレム|カイン/);
  assert.equal(received.options.model, 'haiku');
  assert.equal(watcher.publicState().game.label, 'Value 2');
  assert.equal(watcher.history[0].model, 'haiku');
  watcher.stop();
});

test('model aliases follow their families across versions and reject mismatched or unknown models', async () => {
  assert.equal(getModel('haiku').cliName, 'haiku');
  assert.equal(getModel('sonnet').cliName, 'sonnet');
  assert.throws(() => getModel('__proto__'), /モデル/);
  const result = { structured_output: { speak: true, comment: '試験字幕' }, modelUsage: { 'claude-haiku-5-5': {} } };
  assert.deepEqual(parseModelComment(result, 'haiku').resolvedModels, ['claude-haiku-5-5']);
  assert.deepEqual(parseModelComment({ ...result, modelUsage: { 'claude-haiku-6-0': {} } }, 'haiku').resolvedModels, ['claude-haiku-6-0']);
  assert.throws(() => parseModelComment({ ...result, modelUsage: { 'claude-sonnet-5-5': {} } }, 'haiku'), /確認できなかった/);
  assert.deepEqual(parseModelComment({ ...result, modelUsage: { 'claude-sonnet-6-0': {} } }, 'sonnet').resolvedModels, ['claude-sonnet-6-0']);
  assert.equal(getModel('haiku-5-5').cliName, 'haiku');
  assert.equal(new Watcher({ tone: 'companion', model: 'haiku-5-5' }).model, 'haiku');
  await assert.rejects(generateComment({}, { model: 'unregistered-model' }), /モデル/);
});
