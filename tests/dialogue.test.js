import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { Watcher } from '../app/watcher.js';
import { dialogue } from '../app/games/fe1.js';
const require = createRequire(import.meta.url);
const { lua, lauxlib, lualib, to_luastring, to_jsstring } = require('fengari');
const folder = fileURLToPath(new URL('../lua/', import.meta.url)).replaceAll('\\', '/');

// Rows 12-23 of the second nametable, captured from a real village conversation (supported ROM).
const rows = [
    "8afe8afe8afef5f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f65e8b5e8b5e8b",
    "fe9afe9afe9afdffff0fffffffffffffffff0fff0ffffffffffe8b5e8b5e8b5e",
    "8afe8afe8afefd9eab405c3c8513010205010e0705fffffffffe5e8b5e8b5e8b",
    "fe9afe9afe9afdffffffff0fffffffff0ffffffffffffffffffe8b5e8b5e8b5e",
    "8afe686b6b6bfdffff04020b160001100585131027fffffffffe5e8b5e8b5e8b",
    "fe9a4c6c7b7bfdfffffffffffffffffffffffffffffffffffffe8b5e8b5e8b5e",
    "8afe4c4d8afefdfffffffffffffffffffffffffffffffffffffe5e8b5e8b5e8b",
    "fe9a4c4dfe9afdfffffffffffffffffffffffffffffffffffffe8b5e8b5e8b5e",
    "8afe5f5f8afefdfffffffffffffffffffffffffffffffffffffe5e8b5e8b5e8b",
    "fe9a6f6ffe9afdfffffffffffffffffffffffffffffffffffffe8b5e8b5e8b5e",
    "8afe4c4d8afefdfffffffffffffffffffffffffffffffffffffe5e8b5e8b5e8b",
    "fe9a4c4dfe9af9f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8fa8b5e8b5e8b5e",
];

function luaDecode(rowHex, firstRow = 12) {
  const state = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(state);
  const tiles = new Array(960).fill(0x5e);
  rowHex.forEach((hex, i) => { for (let x = 0; x < 32; x++) tiles[(firstRow + i) * 32 + x] = parseInt(hex.slice(x * 2, x * 2 + 2), 16); });
  const source = `
    local text = dofile(${JSON.stringify(folder + 'profiles/fe1-text.lua')})
    local nt = { ${tiles.join(',')} }
    local result = text.dialogue(nt)
    if not result then return "NONE" end
    return result.text
  `;
  const status = lauxlib.luaL_dostring(state, to_luastring(source));
  const out = to_jsstring(lua.lua_tostring(state, -1));
  lua.lua_close(state);
  assert.equal(status, 0, out);
  return out;
}

test('dialogue window text is decoded from nametable tiles, including dakuten and small kana', () => {
  const text = luaDecode(rows);
  assert.match(text, /ダロスっていうかいぞくが/);
  assert.match(text, /おうじにあいたがってたよ/);
});

test('a window without the speech marker, or a mid-redraw frame, is not treated as dialogue', () => {
  const noMarker = rows.map(row => row.replaceAll('9eab', 'ffff'));
  assert.equal(luaDecode(noMarker), 'NONE');
  const noise = rows.map((row, i) => i === 2 ? row.replace(/9eab405c3c8513010205010e0705/, '9eabd0d1d2d3d4d5d6d7d8d9dadb') : row);
  assert.equal(luaDecode(noise), 'NONE');
});

test('adapter exposes decoded text only when present', () => {
  assert.deepEqual(dialogue({ dialogue: { text: 'こんにちは' } }), { text: 'こんにちは' });
  assert.equal(dialogue({}), null);
  assert.equal(dialogue({ dialogue: { text: '' } }), null);
});

test('a conversation is explained once after the window closes, in the chosen tone, without repeating pages', async () => {
  let now = 0;
  const payloads = [];
  const watcher = new Watcher({ authenticate: async () => ({ plan: 'pro' }), includedOnlyConfirmed: true, clock: () => now, tone: 'companion',
    generate: async payload => { payloads.push(payload); return { speak: true, comment: 'ダロスっていう海賊が王子に会いたがってるらしいよ。' }; } });
  await watcher.start('lively', { includedOnlyConfirmed: true });
  const unit = (key, side, x) => ({ key, side, character_id: 4, name: side === 'player' ? 'カイン' : undefined, class_name: 'かいぞく', hp: 18, max_hp: 18, x, y: 5 });
  const make = text => ({ game_state: { profile_id: 'fe1-jp-v1', chapter: 1, turn: 1, units: [unit('player:0', 'player', 1), unit('enemy:1', 'enemy', 20)], ...(text ? { dialogue: { text } } : {}) },
    recent_observations: { timeline_id: 't', events: [] } });
  watcher.accept(make());
  watcher.accept(make('ダロスっていうかいぞくが\nおうじにあいたがってたよ'));
  now = 3000; watcher.accept(make('ダロスっていうかいぞくが\nおうじにあいたがってたよ'));
  assert.equal(watcher.quiet(), true, 'quiet while the window is open');
  await watcher.maybeGenerate();
  assert.equal(payloads.length, 0, 'not explained while the window is open');
  now = 6000; watcher.accept(make('もう わるいことはやめて'));
  now = 9000; watcher.accept(make()); now = 11500; watcher.accept(make());
  now = 14000; await watcher.maybeGenerate();
  assert.equal(payloads.length, 1);
  assert.equal(payloads[0].context.topic, 'village_dialogue');
  assert.equal(payloads[0].context.facts.lines.length, 3);
  assert.match(payloads[0].context.facts.speaker, /不明/);
  assert.equal(watcher.history.length, 1);
  // The same pages shown again are not explained twice.
  now = 100000; watcher.accept(make('ダロスっていうかいぞくが\nおうじにあいたがってたよ')); now = 103000; watcher.accept(make()); now = 106000; watcher.accept(make());
  now = 110000; await watcher.maybeGenerate();
  assert.equal(payloads.length, 1);
});

test('a unit named in the conversation is located relative to nearby allies', async () => {
  const { mentionedUnits, dialogueContext } = await import('../app/games/fe1.js');
  const state = { units: [
    { key: 'player:0', side: 'player', name: 'カイン', class_name: 'ソシアルナイト', hp: 18, max_hp: 18, x: 10, y: 5 },
    { key: 'player:1', side: 'player', name: 'アベル', class_name: 'ソシアルナイト', hp: 18, max_hp: 18, x: 20, y: 9 },
    { key: 'enemy:3', side: 'enemy', candidate_name: 'ダロス', class_name: 'かいぞく', hp: 20, max_hp: 20, x: 10, y: 10 },
    { key: 'enemy:4', side: 'enemy', class_name: 'かいぞく', hp: 18, max_hp: 18, x: 30, y: 2 },
  ] };
  const [daros] = mentionedUnits(['ダロスっていうかいぞくが', 'おうじにあいたがってたよ'], state);
  assert.equal(daros.name, 'ダロス');
  assert.equal(daros.name_status, 'candidate_from_character_id');
  assert.deepEqual(daros.position, { x: 10, y: 10 });
  assert.equal(daros.nearest_allies[0].name, 'カイン');
  assert.equal(daros.nearest_allies[0].distance, 5);
  assert.equal(daros.nearest_allies[0].direction, '北に5マス');
  assert.equal(daros.nearest_allies[1].name, 'アベル');
  assert.deepEqual(mentionedUnits(['ここにはだれもいないよ'], state), []);
  assert.deepEqual(mentionedUnits(['ダロスがいたよ'], { units: [{ ...state.units[2], hp: 0 }] }), [], 'defeated or absent units are not located');
  const withUnit = dialogueContext(['ダロスのうわさ'], state);
  assert.ok(withUnit.facts.mentioned_units && /位置関係/.test(withUnit.focus));
  const without = dialogueContext(['むかしむかし'], state);
  assert.equal(without.facts.mentioned_units, undefined);
  assert.match(without.focus, /位置には触れない/);
});

test('a window whose tiles stay in the nametable is explained after its text stops changing, once', async () => {
  let now = 0;
  const payloads = [];
  const watcher = new Watcher({ authenticate: async () => ({ plan: 'pro' }), includedOnlyConfirmed: true, clock: () => now, tone: 'companion',
    generate: async payload => { payloads.push(payload); return { speak: true, comment: '僧侶はやられそうになってもレベルが上がるみたいだよ。' }; } });
  await watcher.start('lively', { includedOnlyConfirmed: true });
  const unit = (key, side, x) => ({ key, side, character_id: 4, name: side === 'player' ? 'カイン' : undefined, class_name: 'かいぞく', hp: 18, max_hp: 18, x, y: 5 });
  const make = text => ({ game_state: { profile_id: 'fe1-jp-v1', chapter: 1, turn: 1, units: [unit('player:0', 'player', 1), unit('enemy:1', 'enemy', 20)], ...(text ? { dialogue: { text } } : {}) },
    recent_observations: { timeline_id: 't', events: [] } });
  const tip = ['そうりょは', 'てきのこうげきに たえると', 'レベルが あがるよ'].join(String.fromCharCode(10));
  watcher.accept(make());
  for (now = 2500; now <= 5000; now += 2500) watcher.accept(make(tip));
  assert.equal(watcher.quiet(), true, 'quiet while the page is still fresh');
  for (now = 7500; now <= 10000; now += 2500) watcher.accept(make(tip));
  assert.equal(watcher.dialogueReady?.pages.length, 1, 'ready after six unchanged seconds although the window never closes');
  assert.equal(watcher.quiet(), false, 'stale tiles do not keep it quiet');
  await watcher.maybeGenerate();
  assert.equal(payloads.length, 1);
  for (now = 60000; now <= 300000; now += 2500) watcher.accept(make(tip));
  await watcher.maybeGenerate();
  assert.equal(payloads.length, 1, 'the leftover tiles are not explained again');
});

test('overlapping scrolled pages merge into one conversation, and a half-typed repeat is not explained again', async () => {
  const { mergePages } = await import('../app/games/fe1.js');
  const nl = String.fromCharCode(10);
  const pages = [
    ['「ダロスっていうかいぞくが', 'おうじにあいたがってたよ', '「もう わるいことはやめて', 'みんなのため'].join(nl),
    ['おうじにあいたがってたよ', '「もう わるいことはやめて', 'みんなのために', 'たたかいたいんだってさ', '「いちど'].join(nl),
    ['みんなのために', 'たたかいたいんだってさ', '「いちどあって', 'はなしをきいてやってよ'].join(nl),
  ];
  assert.deepEqual(mergePages(pages), ['「ダロスっていうかいぞくが', 'おうじにあいたがってたよ', '「もう わるいことはやめて', 'みんなのために', 'たたかいたいんだってさ', '「いちどあって', 'はなしをきいてやってよ']);
  assert.deepEqual(mergePages([]), []);

  let now = 0; const payloads = [];
  const watcher = new Watcher({ authenticate: async () => ({ plan: 'pro' }), includedOnlyConfirmed: true, clock: () => now, tone: 'companion',
    generate: async payload => { payloads.push(payload); return { speak: true, comment: 'なるほどね。' }; } });
  await watcher.start('lively', { includedOnlyConfirmed: true });
  const base = { profile_id: 'fe1-jp-v1', chapter: 1, turn: 1, units: [{ key: 'player:0', side: 'player', hp: 18, max_hp: 18, x: 1, y: 1 }, { key: 'enemy:1', side: 'enemy', hp: 18, max_hp: 18, x: 20, y: 5 }] };
  const poll = log => ({ game_state: base, recent_observations: { timeline_id: 't', events: [] }, dialogue_log: log });
  watcher.accept(poll([]));
  // Pages arrive only through the Lua log (shown for under a poll interval).
  now = 2500; watcher.accept(poll(pages.map((text, i) => ({ id: i + 1, text, frame: i }))));
  now = 11000; watcher.accept(poll(pages.map((text, i) => ({ id: i + 1, text, frame: i }))));
  now = 14000; await watcher.maybeGenerate();
  assert.equal(payloads.length, 1);
  assert.equal(payloads[0].context.facts.lines.length, 7);
  // Later, the first page is typed again only partway: same conversation, not new.
  now = 60000; watcher.accept(poll([{ id: 4, text: '「ダロスっていうか', frame: 9 }]));
  now = 70000; watcher.accept(poll([{ id: 4, text: '「ダロスっていうか', frame: 9 }]));
  await watcher.maybeGenerate();
  assert.equal(payloads.length, 1);
});
