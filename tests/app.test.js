import test from 'node:test';
import assert from 'node:assert/strict';
import { Watcher } from '../app/watcher.js';
import { selectCandidate, fingerprint } from '../app/games/fe1.js';
import { subscriptionEnvironment, validateSubscription, parseComment } from '../app/claude.js';
import { createApp } from '../app/server.js';

const actor = { key: 'player:2', character_id: 4, side: 'player', name: 'カイン', hp: 18, max_hp: 18, x: 22, y: 11 };
function snapshot(events = [], changes = {}) {
  return { game_state: { profile_id: 'fe1-jp-v1', chapter: 1, turn: 1, units: [{ ...actor, ...changes.unit }, { key: 'player:0', side: 'player', hp: 18, x: 25, y: 6 }, { key: 'enemy:6', side: 'enemy', hp: 3, x: 22, y: 10 }] },
    recent_observations: { timeline_id: changes.timeline ?? 'session:1', events } };
}
const movement = { event_id: 1, type: 'position_changed', side: 'player', unit_key: actor.key, name: actor.name, from: { x: 23, y: 8 }, to: { x: 22, y: 11 } };
const damage = { event_id: 2, type: 'hp_changed', side: 'player', unit_key: actor.key, from: 18, to: 10 };
const auth = async () => ({ plan: 'pro' });

test('only subscription auth is accepted; API credentials and provider flags do not reach the CLI', () => {
  const env = { PATH: 'kept', ANTHROPIC_API_KEY: 'secret', ANTHROPIC_BASE_URL: 'other', CLAUDE_CODE_OAUTH_TOKEN: 'token', CLAUDE_CODE_USE_VERTEX: '1' };
  assert.deepEqual(subscriptionEnvironment(env), { PATH: 'kept' });
  assert.equal(env.ANTHROPIC_API_KEY, 'secret');
  assert.equal(validateSubscription({ loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty', subscriptionType: 'pro' }).plan, 'pro');
  for (const authMethod of ['api_key', 'api_key_helper', 'third_party', 'none', 'oauth_token']) {
    assert.throws(() => validateSubscription({ loggedIn: true, authMethod, subscriptionType: 'pro' }), /ログイン/);
  }
  assert.throws(() => parseComment({ is_error: true }), /上限/);
  assert.deepEqual(parseComment({ structured_output: { speak: false, comment: '' } }), { speak: false, comment: '' });
  assert.throws(() => parseComment({ structured_output: { speak: true, comment: '' } }), /空/);
});

test('substantial attrition outranks a thin movement; changed HP invalidates the fingerprint', () => {
  const state = snapshot().game_state;
  assert.equal(selectCandidate([{ event: movement, receivedAt: 1 }, { event: damage, receivedAt: 2 }], state).event, damage);
  assert.notEqual(fingerprint(state, actor.key), fingerprint(snapshot([], { unit: { hp: 10 } }).game_state, actor.key));
});

test('no old-history replay, one comment for a new event, no repeated calls while quiet, and immediate stop', async () => {
  let now = 0, generated = 0;
  const watcher = new Watcher({ tone: 'companion', authenticate: auth, clock: () => now,
    generate: async () => { generated++; return { speak: true, comment: 'カイン、ほかの味方から少し離れたね。' }; } });
  await watcher.start('balanced', { includedOnlyConfirmed: true });
  watcher.accept(snapshot([movement]));
  now = 5000; await watcher.maybeGenerate();
  assert.equal(generated, 0, 'Events before start must not be replayed');
  watcher.accept(snapshot([movement, damage], { unit: { hp: 10 } }));
  now += 2500; await watcher.maybeGenerate();
  assert.equal(generated, 1);
  assert.equal(watcher.history.length, 1);
  watcher.accept(snapshot([movement, damage], { unit: { hp: 10 } }));
  now += 60000; await watcher.maybeGenerate();
  assert.equal(generated, 1, 'Unchanged state must not trigger another Claude call');
  watcher.stop();
  assert.equal(watcher.publicState().subtitle, null);
});

test('stale responses and timeline changes do not become subtitles', async () => {
  let now = 0, resolve;
  const watcher = new Watcher({ tone: 'companion', authenticate: auth, clock: () => now, generate: () => new Promise(done => { resolve = done; }) });
  await watcher.start('balanced', { includedOnlyConfirmed: true }); watcher.accept(snapshot());
  watcher.accept(snapshot([damage], { unit: { hp: 10 } }));
  now = 2500; const result = watcher.maybeGenerate();
  watcher.accept(snapshot([damage], { unit: { hp: 8 } }));
  resolve({ speak: true, comment: '古い値による発言' }); await result;
  assert.equal(watcher.history.length, 0);
  now += 60000;
  watcher.accept(snapshot([{ ...damage, from: 10, to: 4, event_id: 3 }], { unit: { hp: 4 } }));
  now += 2500; const next = watcher.maybeGenerate();
  watcher.accept(snapshot([], { timeline: 'session:2' }));
  resolve({ speak: true, comment: '以前の履歴による発言' }); await next;
  assert.equal(watcher.history.length, 0);
  watcher.stop();
});

test('hourly cap and generation failures stop monitoring instead of retrying or falling back to paid API', async () => {
  let now = 0, calls = 0;
  const watcher = new Watcher({ tone: 'companion', authenticate: auth, clock: () => now, generate: async () => { calls++; throw new Error('利用上限'); } });
  await watcher.start('balanced', { includedOnlyConfirmed: true }); watcher.accept(snapshot()); watcher.accept(snapshot([damage], { unit: { hp: 10 } }));
  now = 2500; await watcher.maybeGenerate();
  assert.equal(calls, 1); assert.equal(watcher.running, false);
  await watcher.start('balanced', { includedOnlyConfirmed: true }); watcher.accept(snapshot()); watcher.accept(snapshot([damage], { unit: { hp: 10 } }));
  now += 100000; watcher.calls = Array(45).fill(now - 1); await watcher.maybeGenerate();
  assert.equal(calls, 1); assert.equal(watcher.running, false);
});

test('local control page serves overlay, requires same-origin start/stop, and opens no model request by itself', async t => {
  let calls = 0;
  const bridge = { start: async () => {}, close: () => {}, call: async () => ({ bridge_ready: false }) };
  const watcher = new Watcher({ tone: 'companion', bridge, authenticate: auth, generate: async () => { calls++; } });
  let saved;
  const app = await createApp({ watcher, port: 0, savePreferences: async value => { saved = value; } });
  t.after(() => app.close());
  const page = await fetch(app.url); const html = await page.text(); assert.match(html, /見守りを開始/); assert.match(html, /value="haiku">Haiku<\/option>/); assert.doesNotMatch(html, /Haiku 5.5/);
  assert.equal((await fetch(app.url + '/overlay')).status, 200);
  assert.equal((await fetch(app.url + '/api/start', { method: 'POST' })).status, 403);
  assert.equal((await fetch(app.url + '/api/start', { method: 'POST', headers: { Origin: app.url } })).status, 400);
  const started = await fetch(app.url + '/api/start', { method: 'POST', headers: { Origin: app.url }, body: JSON.stringify({ frequency: 'balanced', includedOnlyConfirmed: true, model: 'haiku' }) });
  assert.equal(started.status, 200); assert.equal((await started.json()).running, true);
  assert.equal(watcher.includedOnlyConfirmed, true);
  assert.equal(watcher.model, 'haiku');
  assert.equal(saved.model, 'haiku');
  assert.equal(calls, 0);
  await fetch(app.url + '/api/stop', { method: 'POST', headers: { Origin: app.url } });
  assert.equal(watcher.running, false);
  const controller = new AbortController();
  const stream = await fetch(app.url + '/events', { signal: controller.signal });
  const reader = stream.body.getReader();
  await reader.read();
  await fetch(app.url + '/api/start', { method: 'POST', headers: { Origin: app.url } });
  assert.equal(watcher.running, true);
  controller.abort();
  await new Promise(resolve => setTimeout(resolve, 5200));
  assert.equal(watcher.running, false, 'Closing the control page must stop future model usage');
});
