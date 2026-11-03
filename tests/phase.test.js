import { luaPath } from './helpers/fe1.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Watcher } from '../app/watcher.js';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { orientBattle } from './helpers/fe1.js';
const require = createRequire(import.meta.url);
const { lua, lauxlib, lualib, to_luastring, to_jsstring } = require('fengari');
const folder = fileURLToPath(new URL('../lua/', import.meta.url)).replaceAll('\\', '/');

// A fight recorded in the enemy's phase: Maji (ours, ID 11) is index 0 although the Social Knight attacked.
const side = (pid, jid, name, className, hp, hpAfter, flags = {}) => ({ pid, jid, name, class_name: className, level: 3, hp, max_hp: 20, hp_after: hpAfter, strength: 5, skill: 3, speed: 5, luck: 1, defense: 3, damage: 7,
  hit_first: false, hit_second: false, crit_first: false, crit_second: false, ...flags });
const maji = side(11, 7, 'マジ', 'せんし', 13, 5, { hit_first: true });
const knight = side(131, 1, undefined, 'ソシアルナイト', 16, 9, { hit_first: true });
const fight = (id, frame, extra = {}) => ({ id, frame, follow_up: 1, exp: 0, exp_gained: 10, after: { level: 3, max_hp: 20, exp: 10, strength: 5, skill: 3, speed: 5, luck: 1, defense: 3 }, attacker: maji, defender: knight, ...extra });

const unit = (key, side_, extra = {}) => ({ key, side: side_, character_id: 4, class_name: side_ === 'player' ? 'せんし' : 'かいぞく', level: 3, hp: 18, max_hp: 20, x: 5, y: 5, ...extra });
const state = { profile_id: 'fe1-jp-v1', chapter: 1, turn: 3, units: [unit('player:0', 'player', { character_id: 11, name: 'マジ' }), unit('enemy:0', 'enemy', { character_id: 131, class_name: 'ソシアルナイト', x: 6 })] };

test('in the enemy phase the fighters are swapped, in the player phase or when unknown they are left alone', () => {
  const entry = fight(1, 100);
  assert.equal(orientBattle(entry, state, 'player'), entry);
  assert.equal(orientBattle(entry, state, null), entry, 'unknown phase keeps the old reading');
  const swapped = orientBattle(entry, state, 'enemy');
  assert.equal(swapped.attacker.pid, 131);
  assert.equal(swapped.defender.pid, 11);
  assert.equal(swapped.follow_up, 2, 'the follow-up belongs to the same fighter as before');
  assert.equal(swapped.initiated_by, 'enemy');
  const staff = { ...entry, attacker: side(9, 19, 'リフ', 'そうりょ', 16, 16), defender: side(14, 6, 'オグマ', 'ようへい', 14, 20) };
  const both = { ...state, units: [...state.units, unit('player:1', 'player', { character_id: 9 }), unit('player:2', 'player', { character_id: 14 })] };
  assert.equal(orientBattle(staff, both, 'enemy'), staff, 'a staff user is never swapped');
  assert.equal(orientBattle({ ...entry, follow_up: 0 }, state, 'enemy').follow_up, 0);
});

test('the watcher says who attacked from the phase: enemy attacks name the enemy, ours name us', async () => {
  let now = 0;
  const watcher = new Watcher({ authenticate: async () => ({ plan: 'pro' }), includedOnlyConfirmed: true, clock: () => now, tone: 'announcer', generate: async () => ({ speak: false, comment: '' }) });
  await watcher.start('lively', { includedOnlyConfirmed: true });
  let id = 0;
  const poll = (events = [], log = []) => ({ game_state: state, recent_observations: { timeline_id: 't', events }, battle_log: log, dialogue_log: [] });
  const turn = frame => ({ event_id: ++id, type: 'turn_changed', from: 2, to: 3, before_frame: frame - 5, after_frame: frame });
  const enemyMoves = frame => ({ event_id: ++id, type: 'position_changed', side: 'enemy', unit_key: 'enemy:0', from: { x: 9, y: 5 }, to: { x: 6, y: 5 }, before_frame: frame - 5, after_frame: frame });
  const say = async () => { now += 30000; watcher.maybePlay(); return watcher.history.at(-1).text; };

  watcher.accept(poll());
  // Our phase: a fight right after the turn started.
  now = 2500; watcher.accept(poll([turn(10)], [fight(1, 20)]));
  const ours = await say();
  assert.match(ours, /^マジ(が|の攻撃が)グルニアへい/, ours);
  assert.match(ours, /16から9/);

  // The enemy moves, then fights: the Social Knight is the attacker and Maji is hit.
  now += 3000; watcher.accept(poll([enemyMoves(200)], [fight(2, 220)]));
  const theirs = await say();
  assert.match(theirs, /^グルニアへい(が|の攻撃が)マジ/, theirs);
  assert.match(theirs, /13から5/);
  assert.doesNotMatch(theirs, /^マジが/);

  // A new turn starts our phase again, in the same poll as a late enemy fight that happened before it.
  now += 3000; watcher.accept(poll([enemyMoves(300), turn(400)], [fight(3, 350), fight(4, 450)]));
  now += 30000; watcher.maybePlay();
  const lines = watcher.history.slice(-1).map(item => item.text);
  assert.ok(lines.length === 1);
  assert.equal(watcher.runtime.phaseAt(350), 'enemy', 'a fight before the turn change is still the enemy phase');
  assert.equal(watcher.runtime.phaseAt(450), 'player', 'one after it is ours');
});

// Real captures of the turn banner: a small window reading COMPUTER (second nametable, as the enemy phase
// began) and one reading PLAYER (first nametable, as our phase began). Rows 12-16 of the nametable.
const computerRows = [
  '8afe8afe8afef5f7f7f7f7f7f7f7f7f7f7f67ffe8afeae8b5e8b5e8b5e8b5e8b',
  'fe9afe9afe9afdfffffffffffffffffffffe7e7ffe9abe5e8b5e8b5e8b5e8b5e',
  '8afe8afe8afefdff6c7876797e7d6e7bfffe5e8b7f7c5e8b5e8b5e8b5e8b5e8b',
  'fe9afe9afe9af9f8f8f8f8f8f8f8f8f8f8fa8b5e8b5e8b5e8b5e8b5e8b5e8b5e',
  '8afe686b6b6b6b6b6c4d8afe444524258afeae8b5e8b5e8b5e8b5e8b5e8b5e8b'
];
const playerRows = [
  '66678afe8afe8afe8afe8afe8afef5f7f7f7f7f7f7f7f7f7f7f65eaf8afe8afe',
  '7677fe9afe9afe9afe9afe9afe9afdfffffffffffffffffffffe8bbffe9afe9a',
  '66678afe8afe8afe8afe8afe8afefdffff79756a826e7bfffffe00010e0f8afe',
  '7677fe9afe9afe9afe9afe9afe9af9f8f8f8f8f8f8f8f8f8f8fa10111e1ffe9a',
  '66676667686b6b6b6b6b4e4f6b6b6c6c4e4f6b6b6b698afe8afe4c4d8afe8afe'
];

function nametable(rowHex, firstRow = 12) {
  const tiles = new Array(960).fill(0x5e);
  rowHex.forEach((hex, i) => { for (let x = 0; x < 32; x++) tiles[(firstRow + i) * 32 + x] = parseInt(hex.slice(x * 2, x * 2 + 2), 16); });
  return tiles;
}

function banner(first, second) {
  const state = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(state);
  const status = lauxlib.luaL_dostring(state, to_luastring(`
    local text = dofile(${JSON.stringify(luaPath('fe1-text.lua'))})
    return tostring(text.phase_banner({ ${first.join(',')} }, { ${second.join(',')} }))
  `));
  const out = to_jsstring(lua.lua_tostring(state, -1));
  lua.lua_close(state);
  assert.equal(status, 0, out);
  return out;
}

test('the COMPUTER and PLAYER banners (either nametable) are read as the enemy and player phase', () => {
  const blank = new Array(960).fill(0x5e);
  assert.equal(banner(nametable(computerRows), blank), 'enemy');
  assert.equal(banner(blank, nametable(playerRows)), 'player');
  assert.equal(banner(blank, blank), 'nil');
  assert.equal(banner(nametable(computerRows), nametable(playerRows)), 'enemy', 'the first match wins when both are present');
});

test('the Lua profile exposes the banner and the bridge-facing state still decodes normally', () => {
  const state = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(state);
  const second = nametable(computerRows), first = new Array(960).fill(0x5e);
  const status = lauxlib.luaL_dostring(state, to_luastring(`
    local profile = dofile(${JSON.stringify(luaPath('fe1.lua'))})
    local mem = { [0x7674]=1,[0x7675]=2,[0x7676]=20,[0x7677]=31, [0x6a90]=1,[0x6a91]=21,[0x6a92]=1,[0x6a93]=18,[0x6a94]=18,[0x6aa0]=6,[0x6aa1]=25 }
    local nt1, nt0 = { ${second.join(',')} }, { ${first.join(',')} }
    local state = profile.read(function(addr) return mem[addr] or 0 end, function() return nt1, nt0 end)
    return tostring(state.phase_banner) .. "|" .. state.units[1].name
  `));
  const out = to_jsstring(lua.lua_tostring(state, -1));
  lua.lua_close(state);
  assert.equal(status, 0, out);
  assert.equal(out, 'enemy|マルス');
});

test('banner sightings logged by the bridge decide the phase for fights, before any movement is seen', async () => {
  let now = 0;
  const watcher = new Watcher({ authenticate: async () => ({ plan: 'pro' }), includedOnlyConfirmed: true, clock: () => now, tone: 'announcer', generate: async () => ({ speak: false, comment: '' }) });
  await watcher.start('lively', { includedOnlyConfirmed: true });
  const poll = (log, battles = []) => ({ game_state: state, recent_observations: { timeline_id: 't', events: [] }, battle_log: battles, dialogue_log: [], phase_log: log });
  watcher.accept(poll([]));
  // The enemy phase begins (COMPUTER at frame 100); an enemy attacks in place without anything having moved.
  now = 2500; watcher.accept(poll([{ id: 1, phase: 'enemy', frame: 100 }], [fight(1, 140)]));
  now += 30000; watcher.maybePlay();
  assert.match(watcher.history.at(-1).text, /^グルニアへい(が|の攻撃が)マジ/, watcher.history.at(-1).text);
  // PLAYER appears at frame 300: later fights are ours again.
  now += 3000; watcher.accept(poll([{ id: 1, phase: 'enemy', frame: 100 }, { id: 2, phase: 'player', frame: 300 }], [fight(1, 140), fight(2, 340)]));
  assert.equal(watcher.runtime.phaseAt(140), 'enemy');
  assert.equal(watcher.runtime.phaseAt(340), 'player');
  now += 30000; watcher.maybePlay();
  assert.match(watcher.history.at(-1).text, /^マジ(が|の攻撃が)グルニアへい/, watcher.history.at(-1).text);
});
