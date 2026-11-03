import test from 'node:test';
import assert from 'node:assert/strict';
import { selectCandidate, reviewComment } from './helpers/fe1.js';
import { Watcher } from '../app/watcher.js';

const unit = (key, side, x, y, hp = 18) => ({ key, character_id: key, side, x, y, hp, max_hp: 18 });
const state = units => ({ profile_id: 'fe1-jp-v1', chapter: 1, turn: 1, units });
const entry = (event, receivedAt = 100) => ({ event, receivedAt });
const move = key => ({ event_id: 1, type: 'position_changed', unit_key: key, side: 'player' });
const hp = (key, from, to, side, event_id = 1) => ({ event_id, type: 'hp_changed', unit_key: key, from, to, side });
const a = unit('a', 'player', 0, 0), b = unit('b', 'player', 1, 0), enemy = unit('e', 'enemy', 5, 0);

test('ordinary movement and small isolated HP changes need no model call', () => {
  assert.equal(selectCandidate([entry(move('a'))], state([{ ...a, x: 1 }, { ...b, x: 2 }, enemy]), { before: state([a, b, enemy]) }), null);
  assert.equal(selectCandidate([entry(hp('a', 18, 16, 'player'))], state([{ ...a, hp: 16 }, b, enemy])), null);
  assert.equal(selectCandidate([entry({ type: 'turn_changed' })], state([a, b, enemy])), null);
});

test('new separation is a topic; already separated movement is not; recent topic is suppressed', () => {
  const current = state([{ ...a, x: 5 }, b, enemy]);
  const pending = [entry(move('a'))];
  const selected = selectCandidate(pending, current, { before: state([a, b, enemy]) });
  assert.equal(selected.context.topic, 'isolation_opened');
  assert.equal(selectCandidate(pending, current, { before: state([{ ...a, x: 6 }, b, enemy]) }), null);
  assert.equal(selectCandidate(pending, current, { before: state([a, b, enemy]), now: 1000, recentTopics: [{ key: selected.topicKey, at: 100 }] }), null);
});

test('joining a pressured ally offers a support topic, without asserting available actions', () => {
  const before = state([a, { ...b, x: 6 }, enemy]);
  const result = selectCandidate([entry(move('a'))], state([{ ...a, x: 6, y: 1 }, { ...b, x: 6 }, enemy]), { before });
  assert.equal(result.context.topic, 'support_rejoined');
  assert.equal(result.context.facts.joined[0].key, 'b');
  assert.match(result.context.limitations, /行動可否/);
});

test('rolling changes expose cumulative attrition and favorable exchange without attacker or hit count', () => {
  const changes = [entry(hp('a', 18, 16, 'player')), entry(hp('a', 16, 13, 'player', 2))];
  const result = selectCandidate(changes.slice(-1), state([{ ...a, hp: 13 }, b, enemy]), { changes });
  assert.equal(result.context.topic, 'attrition');
  assert.equal(result.context.facts.observed_losses.length, 2);
  const exchange = [entry(hp('a', 18, 16, 'player')), entry(hp('e', 18, 6, 'enemy', 2))];
  const selected = selectCandidate(exchange.slice(-1), state([{ ...a, hp: 16 }, b, { ...enemy, hp: 6 }]), { changes: exchange });
  assert.equal(selected.context.topic, 'exchange');
  assert.equal(selected.context.facts.enemy_hp_lost, 12);
  assert.equal('attacker' in selected.context.facts, false);
});

test('weakened enemy topic includes experience choices but never predicts a kill', () => {
  const selected = selectCandidate([entry(hp('e', 18, 3, 'enemy'))], state([a, b, { ...enemy, x: 2, hp: 3 }]));
  assert.equal(selected.context.topic, 'cleanup_choice');
  assert.equal(selected.context.facts.nearby_allies.length, 2);
  for (const text of ['もう一度当てられたね。', '安全だね。', 'あと一撃で倒せる。', '反撃されないね。']) assert.equal(reviewComment(text), false);
  assert.equal(reviewComment('弱った敵を、誰の経験につなげるか考えどころだね。'), true);
});

test('watcher retains several changes, suppresses attempted topics and clears context on rewind', async () => {
  let now = 0, calls = 0, payload;
  const watcher = new Watcher({ tone: 'companion', clock: () => now, includedOnlyConfirmed: true, authenticate: async () => ({ plan: 'pro' }),
    generate: async p => { calls++; payload = p; return { speak: true, comment: 'もう一度当てられたね。' }; } });
  const accept = (units, events, timeline = 't') => watcher.accept({ game_state: state(units), recent_observations: { timeline_id: timeline, events } });
  await watcher.start(); accept([a, b, enemy], []);
  const first = hp('a', 18, 16, 'player'); now = 1000; accept([{ ...a, hp: 16 }, b, enemy], [first]);
  now = 4000; await watcher.maybeGenerate(); assert.equal(calls, 0);
  const second = hp('a', 16, 13, 'player', 2); now = 5000; accept([{ ...a, hp: 13 }, b, enemy], [first, second]);
  now = 8000; await watcher.maybeGenerate(); assert.equal(calls, 1);
  assert.equal(payload.context.topic, 'attrition'); assert.equal(payload.recent_changes.length, 2);
  assert.equal(watcher.history.length, 0, 'Unsupported hit count is discarded');
  now = 50000; accept([{ ...a, hp: 12 }, b, enemy], [first, second, hp('a', 13, 12, 'player', 3)]);
  now = 53000; await watcher.maybeGenerate(); assert.equal(calls, 1);
  accept([a, b, enemy], [], 'rewound');
  assert.equal(watcher.changes.length, 0); assert.equal(watcher.topics.length, 0); assert.equal(watcher.reference, null);
  watcher.stop();
});
