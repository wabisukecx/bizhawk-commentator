import test from 'node:test';
import assert from 'node:assert/strict';
import { Watcher } from '../app/watcher.js';
import { playByPlay, analyzeBattle } from './helpers/fe1.js';
import { battleHighlight } from './helpers/fe1.js';
import { tones, localizedTone } from './helpers/fe1.js';

const unit = (key, side, extra = {}) => ({ key, side, character_id: 4, name: side === 'player' ? 'カイン' : undefined, class_name: side === 'player' ? 'ソシアルナイト' : 'かいぞく', hp: 18, max_hp: 18, x: 5, y: 5, ...extra });
const world = units => ({ profile_id: 'fe1-jp-v1', chapter: 1, turn: 1, units });
const strikes = (hitFirst, hitSecond, critFirst = false, critSecond = false) => ({ hit_first: hitFirst, hit_second: hitSecond, crit_first: critFirst, crit_second: critSecond });
const fighter = (pid, name, className, hp, hpAfter, flags) => ({ pid, name, class_name: className, level: 1, hp, max_hp: 20, hp_after: hpAfter, damage: 7, strength: 5, skill: 3, speed: 5, luck: 1, defense: 3, ...flags });
const after = { level: 1, max_hp: 20, exp: 10, strength: 5, skill: 3, speed: 5, luck: 1, defense: 3 };
// Fights reproduced from recorded data: hit flags x damage give the recorded HP after (5 of 5 fights).
const doubleHit = { type: 'battle', id: 3, event_id: 1_000_003, follow_up: 1, exp: 0, exp_gained: 10, after,
  attacker: fighter(14, 'オグマ', 'ようへい', 20, 20, strikes(true, true)), defender: fighter(133, undefined, 'かいぞく', 18, 4, strikes(false, true)) };

test('hit counts follow the strike flags and the follow-up holder; lethal fights make no count or crit claim', () => {
  const r = analyzeBattle(doubleHit);
  assert.deepEqual(r.attacker, { hits: 2, crit: false });
  assert.deepEqual(r.defender, { hits: 0, crit: false }, 'the defender has no follow-up, so its second flag is ignored');
  assert.equal(r.lethal, false);
  const crit = analyzeBattle({ ...doubleHit, follow_up: 0, attacker: { ...doubleHit.attacker, ...strikes(true, true, true) } });
  assert.deepEqual(crit.attacker, { hits: 1, crit: true });
  const missedCrit = analyzeBattle({ ...doubleHit, attacker: { ...doubleHit.attacker, ...strikes(false, false, true, true) } });
  assert.deepEqual(missedCrit.attacker, { hits: 0, crit: false }, 'a crit flag without a hit is nothing');
  const kill = analyzeBattle({ ...doubleHit, defender: { ...doubleHit.defender, hp_after: 0 } });
  assert.deepEqual(kill, { staff: false, lethal: true, defeated: 'defender', attacker: { hits: null, crit: false }, defender: { hits: null, crit: false } });
  assert.equal(analyzeBattle({ ...doubleHit, attacker: { ...doubleHit.attacker, hp_after: 0 } }).defeated, 'attacker');
});

test('double hits and criticals are added to the fight narration; the counter-attacker crit names the counter-attacker', () => {
  const state = world([unit('player:0', 'player', { character_id: 14, name: 'オグマ' }), unit('enemy:0', 'enemy', { character_id: 133 })]);
  const [double] = playByPlay([doubleHit], state, { tone: localizedTone('announcer') });
  assert.match(double.text, /オグマの連続攻撃が、二度とも当たりました/);
  const counterCrit = { ...doubleHit, follow_up: 0, attacker: { ...doubleHit.attacker, ...strikes(false, false), hp_after: 8 }, defender: { ...doubleHit.defender, hp_after: 18, ...strikes(true, false, true) } };
  const [text] = playByPlay([counterCrit], state, { tone: localizedTone('companion') });
  assert.match(text.text, /ガルダへいの必殺の一撃だよ/);
  assert.doesNotMatch(text.text, /オグマの必殺/);
});

test('recovery is narrated; trivial recovery, and recovery during a fight report, are not', () => {
  const state = world([unit('player:0', 'player', { hp: 20, max_hp: 20, name: 'オグマ' })]);
  const heal = { event_id: 1, type: 'hp_changed', unit_key: 'player:0', side: 'player', from: 12, to: 20 };
  assert.match(playByPlay([heal], state, { tone: localizedTone('announcer') })[0].text, /オグマのHPが12から20に回復しました/);
  assert.deepEqual(playByPlay([{ ...heal, from: 19, to: 20 }], state, { tone: localizedTone('announcer') }), []);
  assert.equal(playByPlay([heal, doubleHit], state, { tone: localizedTone('announcer') }).some(line => line.topicKey.startsWith('heal:')), false);
});

test('only defeats and criticals produce a highlight, with the side that was hit or won', () => {
  const state = world([unit('player:0', 'player', { character_id: 14, name: 'オグマ' }), unit('enemy:0', 'enemy', { character_id: 133 })]);
  assert.equal(battleHighlight(doubleHit, state), null);
  const kill = battleHighlight({ ...doubleHit, id: 4, defender: { ...doubleHit.defender, hp_after: 0 } }, state);
  assert.equal(kill.key, 'highlight:4');
  assert.equal(kill.context.facts.defeated, 'ガルダへい');
  assert.equal(kill.context.facts.defeated_is_ours, false);
  assert.match(kill.context.focus, /繰り返さず/);
  const ourLoss = battleHighlight({ ...doubleHit, attacker: { ...doubleHit.attacker, hp_after: 0 } }, state);
  assert.equal(ourLoss.context.facts.defeated_is_ours, true);
  const crit = battleHighlight({ ...doubleHit, follow_up: 0, attacker: { ...doubleHit.attacker, ...strikes(true, false, true) } }, state);
  assert.equal(crit.context.facts.critical_by, 'オグマ');
});

test('a defeat offers recent-flow analysis after the fight, without interrupting narration or replaying the topic', async () => {
  let now = 0;
  const calls = [];
  const watcher = new Watcher({ authenticate: async () => ({ plan: 'pro' }), includedOnlyConfirmed: true, clock: () => now, tone: 'passion',
    generate: async (payload, options) => { calls.push({ payload, options }); return { speak: true, comment: '敵が減って、前線の並びも薄くなったね。' }; } });
  await watcher.start('lively', { includedOnlyConfirmed: true });
  const base = [unit('player:0', 'player', { character_id: 14, name: 'オグマ' }), unit('enemy:0', 'enemy', { character_id: 133 })];
  const poll = (units, log) => ({ game_state: world(units), recent_observations: { timeline_id: 't', events: [] }, battle_log: log });
  watcher.accept(poll(base, []));
  const entry = { ...doubleHit, id: 1, defender: { ...doubleHit.defender, hp_after: 0 } };
  delete entry.type; delete entry.event_id;
  now = 2500; watcher.accept(poll(base, [entry]));
  // The map changes after the fight (the defeated unit leaves); a normal fingerprint check would call this stale.
  now = 6000; watcher.accept(poll([base[0]], [entry]));
  await watcher.maybeGenerate();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].payload.context.topic, 'battle_highlight');
  assert.equal(calls[0].payload.recent_flow.before.units.length, 2);
  assert.equal(calls[0].payload.recent_flow.after.units.length, 1);
  assert.match(calls[0].options.instructions, /山場/);
  assert.equal(watcher.history.length, 1);
  assert.equal(watcher.history[0].intensity, 'normal', 'stored as normal so the speech queue does not cut off the narration');
  now = 30000; await watcher.maybeGenerate();
  assert.equal(calls.length, 1, 'one reaction per fight');
});
