import { luaPath } from './helpers/fe1.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { Watcher } from '../app/watcher.js';
import { playByPlay } from './helpers/fe1.js';
import { tones, localizedTone } from './helpers/fe1.js';
const require = createRequire(import.meta.url);
const { lua, lauxlib, lualib, to_luastring, to_jsstring } = require('fengari');
const folder = fileURLToPath(new URL('../lua/', import.meta.url)).replaceAll('\\', '/');

// A fight recorded in a real play session (Doga, armor knight, levels up from 1 to 2).
const mem = { 0x304: 6, 0x305: 133, 0x306: 2, 0x307: 8, 0x308: 1, 0x309: 1, 0x30A: 18, 0x30B: 18, 0x30C: 18, 0x30D: 18, 0x30E: 88, 0x30F: 16,
  0x312: 7, 0x313: 5, 0x314: 3, 0x315: 1, 0x318: 3, 0x319: 6, 0x31A: 1, 0x31B: 0, 0x31C: 11, 0x31D: 4,
  0x329: 2, 0x32A: 18, 0x32B: 4, 0x32C: 8, 0x32D: 3, 0x32F: 4, 0x330: 2, 0x331: 11, 0x334: 17, 0x335: 2,
  0x33C: 8, 0x33D: 1, 0x344: 1, 0x345: 1, 0x346: 1, 0x347: 1, 0x34B: 0, 0x34C: 1, 0x348: 1, 0x302: 1 };

test('Lua profile reads the fight struct: attacker first, results, and level-up stats', () => {
  const state = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(state);
  const fightTable = Object.entries(mem).map(([k, v]) => `[${k}]=${v}`).join(',');
  const source = `
    local profile = dofile(${JSON.stringify(luaPath('fe1.lua'))})
    local mem = { [0x7674]=1,[0x7675]=1,[0x7676]=20,[0x7677]=31, [0x6a90]=1,[0x6a91]=21,[0x6a92]=1,[0x6a93]=18,[0x6a94]=18,[0x6aa0]=6,[0x6aa1]=25 }
    local fight = { ${fightTable} }
    local function read(addr) return mem[addr] or 0 end
    local idle = profile.read(read)
    assert(idle.battle == nil, "battle should be nil while jid is 0")
    for k, v in pairs(fight) do mem[k] = v end
    local battle = profile.read(read).battle
    assert(battle.attacker.pid == 6 and battle.attacker.name == "ドーガ" and battle.attacker.class_name == "アーマーナイト")
    assert(battle.defender.pid == 133 and battle.defender.name == "ガルダへい" and battle.defender.class_name == "かいぞく")
    assert(battle.attacker.hp == 18 and battle.attacker.hp_after == 17 and battle.defender.hp_after == 2)
    assert(battle.after.level == 2 and battle.after.strength == 8 and battle.attacker.strength == 7 and battle.exp_gained == 16)
    assert(battle.attacker.damage == 8 and battle.defender.damage == 1)
    assert(battle.attacker.hit_first == true and battle.attacker.hit_second == true and battle.defender.hit_first == true)
    assert(battle.attacker.crit_first == false and battle.defender.crit_first == true and battle.follow_up == 1 and battle.order_flag_raw == 1)
    mem[0x306] = 0x55
    assert(profile.read(read).battle == nil, "idle sentinel 0x55 is not a class")
  `;
  const status = lauxlib.luaL_dostring(state, to_luastring(source));
  const message = status === lua.LUA_OK ? '' : to_jsstring(lua.lua_tostring(state, -1));
  lua.lua_close(state);
  assert.equal(status, 0, message);
});

const unit = (key, side, extra = {}) => ({ key, side, character_id: 4, name: side === 'player' ? 'カイン' : undefined, class_name: side === 'player' ? 'ソシアルナイト' : 'かいぞく', hp: 18, max_hp: 18, x: 5, y: 5, ...extra });
const world = units => ({ profile_id: 'fe1-jp-v1', chapter: 1, turn: 1, units });
const side = (pid, jid, className, hp, hpAfter, stats, name) => ({ pid, jid, class_name: className, name, level: 1, hp, max_hp: 18, hp_after: hpAfter, ...stats });
const doga = side(6, 2, 'アーマーナイト', 18, 17, { strength: 7, skill: 3, speed: 3, luck: 1, defense: 11 }, 'ドーガ');
const pirate = side(133, 8, 'かいぞく', 18, 2, { strength: 5, skill: 1, speed: 6, luck: 0, defense: 4 });
const fight = { type: 'battle', event_id: 1_000_001, attacker: doga, defender: pirate, exp: 88, exp_gained: 16, after: { level: 2, max_hp: 18, exp: 4, strength: 8, skill: 3, speed: 4, luck: 2, defense: 11 } };
const noLevelUp = { ...fight.after, level: 1 };

test('a fight is narrated with who attacked whom, the result, and the level-up growth', () => {
  const state = world([unit('player:0', 'player', { character_id: 6, name: 'ドーガ' }), unit('enemy:0', 'enemy', { character_id: 133, hp: 2 })]);
  const lines = playByPlay([fight], state, { tone: localizedTone('announcer') });
  assert.equal(lines[0].priority, 9);
  assert.match(lines[0].text, /ドーガがレベル2に上がりました/);
  assert.match(lines[0].text, /力\+1、速さ\+1、幸運\+1/);
  assert.doesNotMatch(lines[0].text, /HP\+|守備\+|技\+/);
  assert.match(lines[1].text, /ドーガ(が|の攻撃が)ガルダへい/);
  assert.match(lines[1].text, /18から2/);
  assert.match(lines[1].text, /反撃で、ドーガのHPは18から17/);
});

test('kills, misses and an enemy attacking us are described from the same data', () => {
  const state = world([unit('player:0', 'player', { character_id: 4, name: 'カイン' }), unit('enemy:0', 'enemy', { character_id: 133 })]);
  const enemyAttack = { ...fight, attacker: { ...pirate, hp: 18, hp_after: 18 }, defender: { ...doga, pid: 4, name: 'カイン', hp: 18, hp_after: 11 }, after: noLevelUp };
  const [hit] = playByPlay([enemyAttack], state, { tone: localizedTone('passion') });
  assert.match(hit.text, /ガルダへい/);
  assert.match(hit.text, /カイン/);
  assert.match(hit.text, /18から11/);
  const [kill] = playByPlay([{ ...fight, defender: { ...pirate, hp_after: 0 }, after: noLevelUp }], state, { tone: localizedTone('companion') });
  assert.match(kill.text, /ドーガがガルダへいを倒したよ/);
  const [miss] = playByPlay([{ ...fight, defender: { ...pirate, hp_after: 18 }, attacker: { ...doga, hp_after: 18 }, after: noLevelUp }], state, { tone: localizedTone('calm') });
  assert.match(miss.text, /ダメージはありませんでした/);
  const [down] = playByPlay([{ ...fight, attacker: { ...doga, hp_after: 0 }, after: noLevelUp }], state, { tone: localizedTone('announcer') });
  assert.match(down.text, /倒れました/);
});

test('trivial HP changes are skipped, fights replace per-HP lines, and enemies are said to approach a named target', () => {
  const state = world([unit('player:0', 'player', { x: 1, y: 1, hp: 17 }), unit('enemy:0', 'enemy', { x: 4, y: 1 })]);
  const small = { event_id: 1, type: 'hp_changed', unit_key: 'player:0', side: 'player', from: 18, to: 17 };
  assert.deepEqual(playByPlay([small], state, { tone: localizedTone('announcer') }), []);
  const big = { event_id: 2, type: 'hp_changed', unit_key: 'player:0', side: 'player', from: 18, to: 12 };
  const withFightState = world([unit('player:0', 'player', { character_id: 6, name: 'ドーガ', hp: 12 })]);
  assert.equal(playByPlay([big, fight], withFightState, { tone: localizedTone('announcer') }).some(line => line.topicKey.startsWith('hurt:')), false);
  const move = { event_id: 3, type: 'position_changed', side: 'enemy', unit_key: 'enemy:0', from: { x: 9, y: 1 }, to: { x: 4, y: 1 } };
  const [approach] = playByPlay([move], state, { tone: localizedTone('announcer') });
  assert.match(approach.text, /かいぞくがカインに近づいています/);
  const far = world([unit('player:0', 'player', { x: 30, y: 20 }), unit('enemy:0', 'enemy', { x: 4, y: 1 })]);
  assert.deepEqual(playByPlay([move], far, { tone: localizedTone('announcer') }), []);
});

test('the watcher turns logged fights into narration, once', async () => {
  let now = 0;
  const watcher = new Watcher({ authenticate: async () => ({ plan: 'pro' }), includedOnlyConfirmed: true, clock: () => now, tone: 'announcer', generate: async () => ({ speak: false, comment: '' }) });
  await watcher.start('lively', { includedOnlyConfirmed: true });
  const state = world([unit('player:0', 'player', { character_id: 6, name: 'ドーガ' }), unit('enemy:0', 'enemy', { character_id: 133, hp: 2 })]);
  const poll = log => ({ game_state: state, recent_observations: { timeline_id: 't', events: [] }, battle_log: log });
  watcher.accept(poll([]));
  const entry = { ...fight, id: 1 };
  delete entry.type; delete entry.event_id;
  now = 2500; watcher.accept(poll([entry]));
  now = 20000; watcher.maybePlay();
  assert.equal(watcher.history.length, 1);
  assert.match(watcher.history[0].text, /ドーガがレベル2に上がりました/);
  assert.match(watcher.history[0].text, /ドーガ(が|の攻撃が)ガルダへい/);
  now = 40000; watcher.accept(poll([entry])); watcher.maybePlay();
  assert.equal(watcher.history.length, 1, 'the same logged fight is not narrated again');
});

test('Jagen defeating an enemy absent from the roster uses its name in narration and Claude facts, in both languages', async t => {
  for (const language of ['ja', 'en']) {
    let now = 0;
    const watcher = new Watcher({ language, tone: 'passion', clock: () => now, includedOnlyConfirmed: true,
      authenticate: async () => ({ plan: 'pro' }), generate: async () => ({ speak: false, comment: '' }) });
    t.after(() => watcher.stop());
    await watcher.start('lively', { includedOnlyConfirmed: true });
    const state = world([unit('player:0', 'player', { character_id: 3, name: 'ジェイガン', hp: 17, max_hp: 22 })]);
    const logged = { id: 1, frame: 500, order_flag_raw: 0, follow_up: 1, after: { level: 1 },
      attacker: { pid: 3, name: 'ジェイガン', class_name: 'パラディン', level: 1, hp: 20, max_hp: 22, hp_after: 17, damage: 9, hit_first: true, hit_second: true },
      defender: { pid: 133, class_name: 'かいぞく', level: 1, hp: 18, max_hp: 18, hp_after: 0, damage: 3, hit_first: true } };
    const poll = log => ({ game_state: state, recent_observations: { timeline_id: 'jagen:1', events: [] }, battle_log: log });
    watcher.accept(poll([]));
    now = 2500; watcher.accept(poll([logged]));
    now = 20000; watcher.maybePlay();
    const text = watcher.history.at(-1).text;
    if (language === 'ja') {
      assert.match(text, /ジェイガンがガルダへいを倒した！/);
      assert.match(text, /連続攻撃が二発とも入った/);
      assert.match(text, /20から17/);
      assert.doesNotMatch(text, /かいぞく/);
    } else {
      assert.match(text, /Jagen takes down Garuda soldier!/);
      assert.doesNotMatch(text, /Pirate|かいぞく|ガルダへい/);
    }
    assert.equal(watcher.runtime.highlightReady.context.facts.defeated, language === 'ja' ? 'ガルダへい' : 'Garuda soldier');
    assert.equal(logged.defender.name, undefined, 'an old bridge log need not be mutated or reread');
  }
});

test('unknown fight IDs still fall back to the class in the selected language', () => {
  const unknown = { ...fight, defender: { ...pirate, pid: 240, hp_after: 0 }, after: noLevelUp };
  assert.match(playByPlay([unknown], world([]), { tone: localizedTone('passion') })[0].text, /かいぞくを倒した/);
  const english = { ...unknown, attacker: { ...doga, name: 'Draug', class_name: 'Armor Knight' }, defender: { ...unknown.defender, class_name: 'Pirate' } };
  assert.match(playByPlay([english], world([]), { tone: localizedTone('passion', 'en') })[0].text, /Draug takes down the Pirate/);
});
