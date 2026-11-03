import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { Watcher } from '../app/watcher.js';
import { playByPlay } from '../app/games/fe1-play.js';
import { selectedUnit, recruitHighlight } from '../app/games/fe1.js';
import { localizedTone } from '../app/tones.js';
import { localizeSnapshot } from '../app/games/fe1-i18n.js';
const require = createRequire(import.meta.url);
const { lua, lauxlib, lualib, to_luastring, to_jsstring } = require('fengari');
const folder = fileURLToPath(new URL('../lua/', import.meta.url)).replaceAll('\\', '/');

test('the observer reports a character seen for the first time as joined, but not one that only dropped out and came back', () => {
  const state = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(state);
  const source = `
    local observations = dofile(${JSON.stringify(folder + 'observations.lua')})
    local observer = observations.new("s", "tactical-map-v1")
    local function unit(key, pid, name) return { key = key, side = "player", character_id = pid, name = name, class_name = "ロード", level = 1, hp = 18, max_hp = 18, x = 1, y = 1 } end
    local function world(chapter, units) return { chapter = chapter, turn = 1, units = units } end
    local marth, daros, abel = unit("player:0", 1, "マルス"), unit("player:1", 15, "ダロス"), unit("player:2", 5, "アベル")
    observer:sample(10, "H", world(1, { marth, abel }))
    observer:sample(25, "H", world(1, { marth }))              -- Abel drops out of the list (flag change), not a recruit
    observer:sample(40, "H", world(1, { marth, abel }))        -- ... and comes back
    observer:sample(55, "H", world(1, { marth, abel, daros })) -- Daros is new
    observer:sample(70, "H", world(2, { marth, abel, daros })) -- chapter change: no join events, history reset
    local events = observer:get().events
    local joined = {}
    for _, e in ipairs(events) do if e.type == "unit_joined" then joined[#joined + 1] = e end end
    return #joined .. "|" .. (joined[1] and joined[1].name or "") .. "|" .. (joined[1] and joined[1].character_id or 0)
  `;
  const status = lauxlib.luaL_dostring(state, to_luastring(source));
  const out = to_jsstring(lua.lua_tostring(state, -1));
  lua.lua_close(state);
  assert.equal(status, 0, out);
  // The chapter change reset the history, so only what happened after it remains: nothing joined there.
  assert.equal(out, '0||0');
});

test('without a chapter change, the recruit is in the history with name, class and level', () => {
  const state = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(state);
  const source = `
    local observations = dofile(${JSON.stringify(folder + 'observations.lua')})
    local observer = observations.new("s", "tactical-map-v1")
    local function unit(key, pid, name) return { key = key, side = "player", character_id = pid, name = name, class_name = "かいぞく", level = 1, hp = 20, max_hp = 20, x = 1, y = 1 } end
    local marth, abel, daros = unit("player:0", 1, "マルス"), unit("player:2", 5, "アベル"), unit("player:3", 15, "ダロス")
    observer:sample(10, "H", { chapter = 1, turn = 1, units = { marth, abel } })
    observer:sample(25, "H", { chapter = 1, turn = 1, units = { marth } })
    observer:sample(40, "H", { chapter = 1, turn = 1, units = { marth, abel } })
    observer:sample(55, "H", { chapter = 1, turn = 1, units = { marth, abel, daros } })
    local joined = {}
    for _, e in ipairs(observer:get().events) do if e.type == "unit_joined" then joined[#joined + 1] = e.name .. ":" .. e.character_id .. ":" .. e.class_name .. ":" .. e.level end end
    return table.concat(joined, ",")
  `;
  const status = lauxlib.luaL_dostring(state, to_luastring(source));
  const out = to_jsstring(lua.lua_tostring(state, -1));
  lua.lua_close(state);
  assert.equal(status, 0, out);
  assert.equal(out, 'ダロス:15:かいぞく:1');
});

const unit = (key, side, extra = {}) => ({ key, side, character_id: 4, name: side === 'player' ? 'カイン' : undefined, class_name: side === 'player' ? 'ソシアルナイト' : 'かいぞく', level: 1, hp: 18, max_hp: 18, x: 5, y: 5, ...extra });
const world = units => ({ profile_id: 'fe1-jp-v1', chapter: 1, turn: 1, units });
const joined = { event_id: 7, type: 'unit_joined', unit_key: 'player:3', name: 'ダロス', side: 'player', character_id: 15, class_name: 'かいぞく', level: 1, hp: 20, max_hp: 20 };

test('a recruit is announced in every tone and language', () => {
  const state = world([unit('player:3', 'player', { character_id: 15, name: 'ダロス', class_name: 'かいぞく' })]);
  assert.match(playByPlay([joined], state, { tone: localizedTone('announcer', 'ja') })[0].text, /ダロスが(仲間に加わりました|新たに仲間になりました)/);
  const english = localizeSnapshot({ game_state: state, recent_observations: { events: [joined] } });
  const line = playByPlay(english.recent_observations.events, english.game_state, { tone: localizedTone('passion', 'en') })[0];
  assert.match(line.text, /^(Darosu joins the team!|A new ally, Darosu, is on board!)$/);
  assert.equal(line.priority, 9.5);
});

test('the information window identifies the unit being looked at, by level and HP and by name when needed', () => {
  const state = world([
    unit('player:0', 'player', { character_id: 5, name: 'アベル', class_name: 'ソシアルナイト', level: 3, hp: 20, max_hp: 20 }),
    unit('player:1', 'player', { character_id: 4, name: 'カイン', class_name: 'ソシアルナイト', level: 3, hp: 20, max_hp: 20 }),
    unit('enemy:0', 'enemy', { character_id: 133, class_name: 'かいぞく', level: 1, hp: 18, max_hp: 18 }),
  ]);
  assert.equal(selectedUnit(state), null, 'no window open');
  const byStats = selectedUnit({ ...state, unit_info: { name: 'かいぞく', class_text: 'かいぞく', level: 1, hp: 18, max_hp: 18 } });
  assert.equal(byStats.key, 'enemy:0');
  const byName = selectedUnit({ ...state, unit_info: { name: 'カイン', class_text: 'ソシアルナイト', level: 3, hp: 20, max_hp: 20 } });
  assert.equal(byName.key, 'player:1', 'two units share level and HP; the name decides');
  assert.equal(byName.status, 'matched_info_window');
  assert.equal(selectedUnit({ ...state, unit_info: { name: 'ふめい', class_text: '', level: 3, hp: 20, max_hp: 20 } }), null, 'ambiguous, so nothing is claimed');
  assert.equal(selectedUnit({ ...state, unit_info: { name: 'カイン', class_text: '', level: 9, hp: 1, max_hp: 1 } }), null, 'no unit matches');
  // In English mode the Japanese window text is matched against the kept Japanese names.
  const english = localizeSnapshot({ game_state: { ...state, unit_info: { name: 'カイン', class_text: 'ソシアルナイト', level: 3, hp: 20, max_hp: 20 } } }).game_state;
  assert.equal(selectedUnit(english).name, 'Cain');
});

test('a recruit gets the fixed line and one spoken reaction; a conversation right after a comment is still explained', async () => {
  let now = 0;
  const calls = [];
  const watcher = new Watcher({ authenticate: async () => ({ plan: 'pro' }), includedOnlyConfirmed: true, clock: () => now, tone: 'companion',
    generate: async (payload, options) => { calls.push({ payload, options }); return { speak: true, comment: 'やった、新しい仲間だ！' }; } });
  await watcher.start('quiet', { includedOnlyConfirmed: true });
  const base = [unit('player:0', 'player'), unit('enemy:0', 'enemy', { x: 20 })];
  const withDaros = [...base, unit('player:3', 'player', { character_id: 15, name: 'ダロス', class_name: 'かいぞく', hp: 20, max_hp: 20 })];
  const poll = (units, events = [], extra = {}) => ({ game_state: world(units), recent_observations: { timeline_id: 't', events }, dialogue_log: [], ...extra });
  watcher.accept(poll(base));
  now = 2500; watcher.accept(poll(withDaros, [joined]));
  now = 6000; await watcher.maybeGenerate();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].payload.context.topic, 'recruit');
  assert.equal(calls[0].payload.context.facts.name, 'ダロス');
  now = 30000; watcher.maybePlay();
  assert.match(watcher.history.at(-1).text, /ダロスが(仲間になったよ|仲間に加わったね)/);
  // A conversation ending shortly after that comment is explained although the 'quiet' cooldown is 60 s.
  const page = ['「マルスおうじ', 'おいらは', 'ふなのりのダロスです'].join(String.fromCharCode(10));
  now = 33000; watcher.accept(poll(withDaros, [], { dialogue_log: [{ id: 1, text: page, frame: 1 }] }));
  now = 42000; watcher.accept(poll(withDaros, [], { dialogue_log: [{ id: 1, text: page, frame: 1 }] }));
  now = 45000; await watcher.maybeGenerate();
  assert.equal(calls.length, 2, 'dialogue waits at most ten seconds after the previous comment');
  assert.equal(calls[1].payload.context.topic, 'village_dialogue');
});

test('enemy records are named from the enemy name table of the game (173 is Daros before he joins, 133 the Galda soldiers)', () => {
  const state = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(state);
  const source = `
    local profile = dofile(${JSON.stringify(folder + 'profiles/fe1.lua')})
    local mem = { [0x7674]=2,[0x7675]=3,[0x7676]=20,[0x7677]=31, [0x6a90]=1,[0x6a91]=21,[0x6a92]=1,[0x6a93]=18,[0x6a94]=18,[0x6aa0]=6,[0x6aa1]=25,
      [0x7078]=173,[0x7079]=8,[0x707a]=3,[0x707b]=21,[0x707c]=21,[0x7088]=4,[0x7089]=24,
      [0x7078+27]=133,[0x7079+27]=8,[0x707a+27]=1,[0x707b+27]=18,[0x707c+27]=18,[0x7088+27]=5,[0x7089+27]=20 }
    local result = profile.read(function(addr) return mem[addr] or 0 end)
    local out = {}
    for _, u in ipairs(result.units) do if u.side == "enemy" then out[#out + 1] = tostring(u.name) end end
    return table.concat(out, ",")
  `;
  const status = lauxlib.luaL_dostring(state, to_luastring(source));
  const out = to_jsstring(lua.lua_tostring(state, -1));
  lua.lua_close(state);
  assert.equal(status, 0, out);
  assert.equal(out, 'ダロス,ガルダへい');
});
