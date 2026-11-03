import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { Watcher } from '../app/watcher.js';
import { playByPlay, analyzeBattle } from '../game-pack-sources/fe1-jp-v1/app/fe1-play.js';
import { battleHighlight } from '../game-pack-sources/fe1-jp-v1/app/fe1.js';
import { localizedTone } from '../game-pack-sources/fe1-jp-v1/app/tone.js';
import { localizeSnapshot } from '../game-pack-sources/fe1-jp-v1/app/fe1-i18n.js';
const require = createRequire(import.meta.url);
const { lua, lauxlib, lualib, to_luastring, to_jsstring } = require('fengari');
const folder = fileURLToPath(new URL('../lua/', import.meta.url)).replaceAll('\\', '/');

// A recorded staff use: Lif (priest, ID 9) heals Ogma (ID 14) from 14 to 20 HP with staff item 53.
// It goes through the fight data like an attack, with 0% hit chance and no damage.
const side = (pid, jid, name, className, hp, hpAfter, extra) => ({ pid, jid, name, class_name: className, level: 1, hp, max_hp: 20, hp_after: hpAfter,
  strength: 5, skill: 3, speed: 5, luck: 1, defense: 3, damage: 0, hit_first: false, hit_second: false, crit_first: false, crit_second: false, ...extra });
const heal = { type: 'battle', id: 5, event_id: 1_000_005, follow_up: 0, exp: 0, exp_gained: 38, after: { level: 1, max_hp: 16, exp: 0, strength: 5, skill: 3, speed: 5, luck: 1, defense: 3 },
  attacker: side(9, 19, 'リフ', 'そうりょ', 16, 16, { item_id: 53, is_attack_item: false, max_hp: 16 }),
  defender: side(14, 6, 'オグマ', 'ようへい', 14, 20, { item_id: 1, is_attack_item: true, damage: 8 }) };
const unit = (key, pid, name, className, hp = 20, max = 20, extra = {}) => ({ key, side: 'player', character_id: pid, name, class_name: className, level: 1, hp, max_hp: max, x: 5, y: 5, ...extra });
const world = units => ({ profile_id: 'fe1-jp-v1', chapter: 1, turn: 1, units });
const state = world([unit('player:0', 9, 'リフ', 'そうりょ', 16, 16), unit('player:1', 14, 'オグマ', 'ようへい', 20, 20)]);

test('a staff use is analyzed as support, from the item flags or from a target whose HP rose', () => {
  assert.equal(analyzeBattle(heal).staff, true);
  const unknownItem = { ...heal, attacker: { ...heal.attacker, is_attack_item: undefined } };
  assert.equal(analyzeBattle(unknownItem).staff, true, 'HP rose, so it was a heal');
  const sword = { ...heal, attacker: { ...heal.attacker, is_attack_item: true }, defender: { ...heal.defender, hp_after: 14 } };
  assert.equal(analyzeBattle(sword).staff, false);
  assert.equal(battleHighlight(heal, state), null, 'no spoken highlight for a heal');
});

test('a heal is narrated as healing in every tone, never as an attack', () => {
  const ja = playByPlay([heal], state, { tone: localizedTone('announcer', 'ja') })[0].text;
  assert.equal(ja, 'リフがオグマを回復。HPは14から20になりました。');
  assert.doesNotMatch(ja, /攻撃|ダメージ/);
  assert.equal(playByPlay([heal], state, { tone: localizedTone('companion', 'ja') })[0].text, 'リフがオグマを回復したよ。HPが14から20になったよ。');
  const english = localizeSnapshot({ game_state: state, battle_log: [heal] });
  const line = playByPlay([english.battle_log[0]], english.game_state, { tone: localizedTone('passion', 'en') })[0].text;
  assert.equal(line, 'Rifu heals Ogma! HP 14 to 20!');
  const noEffect = { ...heal, defender: { ...heal.defender, hp_after: 14 } };
  assert.equal(playByPlay([noEffect], state, { tone: localizedTone('calm', 'ja') })[0].text, 'リフが、オグマに杖を使いました。');
});

test('the staff user gets the level-up, not the healed ally', () => {
  const levelUp = { ...heal, after: { ...heal.after, level: 2, max_hp: 17, speed: 6, luck: 2 } };
  const lines = playByPlay([levelUp], state, { tone: localizedTone('announcer', 'ja') });
  assert.equal(lines[0].priority, 9);
  assert.match(lines[0].text, /^リフがレベル2に上がりました。HP\+1、速さ\+1、幸運\+1。$/);
  assert.match(lines[1].text, /リフがオグマを回復/);
});

test('the watcher narrates a logged heal once and does not call it an attack', async () => {
  let now = 0;
  const watcher = new Watcher({ authenticate: async () => ({ plan: 'pro' }), includedOnlyConfirmed: true, clock: () => now, tone: 'announcer', generate: async () => ({ speak: false, comment: '' }) });
  await watcher.start('lively', { includedOnlyConfirmed: true });
  const poll = log => ({ game_state: state, recent_observations: { timeline_id: 't', events: [] }, battle_log: log, dialogue_log: [] });
  watcher.accept(poll([]));
  const entry = { ...heal, id: 1 };
  delete entry.type; delete entry.event_id;
  now = 2500; watcher.accept(poll([entry]));
  now = 20000; watcher.maybePlay();
  assert.equal(watcher.history.length, 1);
  assert.equal(watcher.history[0].text, 'リフがオグマを回復。HPは14から20になりました。');
  assert.equal(watcher.runtime.highlightReady, null);
});

test('the Lua profile reports the item used and whether it is an attack item (staffs are not)', () => {
  const state2 = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(state2);
  const source = `
    local profile = dofile(${JSON.stringify(folder + '../game-pack-sources/fe1-jp-v1/lua/fe1.lua')})
    local mem = { [0x7674]=1,[0x7675]=1,[0x7676]=20,[0x7677]=31, [0x6a90]=1,[0x6a91]=21,[0x6a92]=1,[0x6a93]=18,[0x6a94]=18,[0x6aa0]=6,[0x6aa1]=25,
      [0x304]=9,[0x305]=14,[0x306]=19,[0x307]=6,[0x308]=1,[0x309]=2,[0x30A]=16,[0x30B]=14,[0x30C]=16,[0x30D]=20,
      [0x320]=53,[0x321]=1, [0x334]=16,[0x335]=20,
      -- item flag table (indexed by the fight's item value itself): staff 53 (IID_HEAL) has no attack bit, 1 (a sword) has bit 3 set.
      -- Neighbouring entries are set the other way so an off-by-one would show.
      [0xd9c3+52]=0x0a, [0xd9c3+53]=0x12, [0xd9c3]=0x00, [0xd9c3+1]=0x0a }
    local battle = profile.read(function(addr) return mem[addr] or 0 end).battle
    return tostring(battle.attacker.item_id) .. "|" .. tostring(battle.attacker.is_attack_item) .. "|" .. tostring(battle.defender.is_attack_item)
  `;
  const status = lauxlib.luaL_dostring(state2, to_luastring(source));
  const out = to_jsstring(lua.lua_tostring(state2, -1));
  lua.lua_close(state2);
  assert.equal(status, 0, out);
  assert.equal(out, '53|false|true');
});
