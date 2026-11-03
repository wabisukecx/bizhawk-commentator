import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeBattle } from './helpers/fe1.js';
import { orientBattle } from './helpers/fe1.js';

// Three recorded fights that ended with a unit going down. In every fight the fight data lists our unit first.
// order_flag_raw is $0302: 0 when we started the fight, 1 when the enemy did.
const fighter = (pid, name, className, level, hp, maxHp, hpAfter, damage, flags) => ({ pid, name, class_name: className, level, hp, max_hp: maxHp, hp_after: hpAfter, damage,
  hit_first: false, hit_second: false, crit_first: false, crit_second: false, strength: 5, skill: 3, speed: 5, luck: 1, defense: 3, ...flags });
const after = { level: 3, max_hp: 20, exp: 0, strength: 5, skill: 3, speed: 5, luck: 1, defense: 3 };
const state = { units: [
  { key: 'player:0', side: 'player', character_id: 10, name: 'サジ', class_name: 'せんし' },
  { key: 'player:1', side: 'player', character_id: 11, name: 'マジ', class_name: 'せんし' },
  { key: 'enemy:0', side: 'enemy', character_id: 133, class_name: 'かいぞく' }, { key: 'enemy:1', side: 'enemy', character_id: 131, class_name: 'ソシアルナイト' } ] };

// 14:12:15 - Saji started it. Both would hit on the first exchange, but Saji strikes first and kills (7 HP, 10 damage).
const sajiKills = { id: 1, order_flag_raw: 0, follow_up: 0, exp: 0, exp_gained: 24, after,
  attacker: fighter(10, 'サジ', 'せんし', 3, 13, 20, 13, 10, { hit_first: true, hit_second: true }),
  defender: fighter(133, undefined, 'かいぞく', 1, 7, 18, 0, 7, { hit_first: true }) };
// 14:21:58 - the enemy started it and missed; Maji (index 0) then hit twice (a follow-up) and the pirate went down.
const majiCounterKills = { id: 2, order_flag_raw: 1, follow_up: 1, exp: 0, exp_gained: 24, after,
  attacker: fighter(11, 'マジ', 'せんし', 3, 13, 20, 13, 10, { hit_first: true, hit_second: true }),
  defender: fighter(133, undefined, 'かいぞく', 1, 18, 18, 0, 7, { hit_second: true }) };
// 14:23:19 - the enemy started it: the Social Knight hit first and Maji (5 HP) was killed before striking back.
const majiDown = { id: 3, order_flag_raw: 1, follow_up: 0, exp: 0, exp_gained: 0, after,
  attacker: fighter(11, 'マジ', 'せんし', 3, 5, 20, 0, 7, { hit_second: true }),
  defender: fighter(131, undefined, 'ソシアルナイト', 1, 16, 16, 16, 8, { hit_first: true, hit_second: true }) };

test('$0302 decides who started the fight: 0 ours, 1 the enemy; the phase is only a fallback for older logs', () => {
  assert.equal(orientBattle(sajiKills, state, 'enemy'), sajiKills, 'a 0 flag wins over a wrong phase guess');
  const turned = orientBattle(majiCounterKills, state, 'player');
  assert.equal(turned.attacker.pid, 133, 'a 1 flag means the enemy started it even when the phase guess says ours');
  assert.equal(turned.initiated_by, 'enemy');
  const { order_flag_raw, ...oldLog } = majiCounterKills;
  assert.equal(orientBattle(oldLog, state, 'player'), oldLog, 'without the flag the phase decides');
  assert.equal(orientBattle(oldLog, state, 'enemy').attacker.pid, 133);
});

test('the strike replay counts only the strikes that happened, including in fights where someone went down', () => {
  const saji = analyzeBattle(orientBattle(sajiKills, state, 'player'));
  assert.deepEqual(saji.attacker, { hits: 1, crit: false });
  assert.deepEqual(saji.defender, { hits: 0, crit: false }, 'the pirate flag said it would hit, but it never got to strike');
  assert.equal(saji.defeated, 'defender');

  const counter = analyzeBattle(orientBattle(majiCounterKills, state, 'player'));
  assert.deepEqual(counter.attacker, { hits: 0, crit: false }, 'the pirate struck first and missed');
  assert.deepEqual(counter.defender, { hits: 2, crit: false }, 'Maji hit twice with the follow-up');
  assert.equal(counter.defeated, 'attacker');

  const down = analyzeBattle(orientBattle(majiDown, state, 'player'));
  assert.deepEqual(down.attacker, { hits: 1, crit: false });
  assert.deepEqual(down.defender, { hits: 0, crit: false });
  assert.equal(down.defeated, 'defender', 'after turning the fight around, the defender is Maji');
});

test('a critical triples the damage in the replay (capped at 120); an inconsistent log makes no count', () => {
  const crit = { ...sajiKills, defender: { ...sajiKills.defender, hp: 30, max_hp: 30, hp_after: 0 }, attacker: { ...sajiKills.attacker, hit_second: false, crit_first: true, damage: 10 } };
  const result = analyzeBattle(crit);
  assert.deepEqual(result.attacker, { hits: 1, crit: true }, '30 HP gone in one blow only because it was a critical (10 x 3)');
  // Same lethal fight, but with a damage value that cannot produce the logged HP: no count is claimed.
  const wrong = { ...sajiKills, attacker: { ...sajiKills.attacker, damage: 5 } };
  assert.deepEqual(analyzeBattle(wrong).attacker, { hits: null, crit: false }, 'the replay does not reproduce the logged HP, so nothing is claimed');
});

test('a recorded level-up reports weapon level with the other stats, in the stats window order', async () => {
  const { playByPlay } = await import('./helpers/fe1.js');
  const { localizedTone } = await import('./helpers/fe1.js');
  // 13:55:06: Draug (armor knight) level 1 to 2: HP 18 to 19, skill 3 to 4, weapon level 4 to 5.
  const draug = fighter(6, 'ドーガ', 'アーマーナイト', 1, 17, 18, 17, 8, { hit_first: true, strength: 7, skill: 3, weapon_level: 4, speed: 3, luck: 1, defense: 11 });
  const leveled = { id: 9, order_flag_raw: 0, follow_up: 1, exp: 96, exp_gained: 24,
    after: { level: 2, max_hp: 19, exp: 20, strength: 7, skill: 4, weapon_level: 5, speed: 3, luck: 1, defense: 11 },
    attacker: draug, defender: fighter(133, undefined, 'かいぞく', 1, 6, 18, 6, 1, { hit_first: true }) };
  const world = { units: [{ key: 'player:0', side: 'player', character_id: 6, name: 'ドーガ', class_name: 'アーマーナイト', level: 1, hp: 17, max_hp: 18 }, { key: 'enemy:0', side: 'enemy', character_id: 133, class_name: 'かいぞく' }] };
  const ja = playByPlay([{ ...leveled, type: 'battle', event_id: 9 }], world, { tone: localizedTone('announcer', 'ja') })[0].text;
  assert.equal(ja, 'ドーガがレベル2に上がりました。HP+1、技+1、武器レベル+1。');
  // In English mode names arrive already converted (see localizeSnapshot).
  const english = { ...leveled, type: 'battle', event_id: 9, attacker: { ...leveled.attacker, name: 'Draug', class_name: 'Armor Knight' } };
  const englishWorld = { units: world.units.map(u => u.key === 'player:0' ? { ...u, name: 'Draug', class_name: 'Armor Knight' } : u) };
  const en = playByPlay([english], englishWorld, { tone: localizedTone('announcer', 'en') })[0].text;
  assert.equal(en, 'Draug reaches level 2. HP +1, Skl +1, WLv +1.');
});
