import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { lua, lauxlib, lualib, to_luastring, to_jsstring } = require('fengari');
const folder = fileURLToPath(new URL('../lua/', import.meta.url)).replaceAll('\\', '/');

// Rows 2-21 of the second nametable while a unit's information and stats windows were open
// (a real capture from the supported ROM; Jagen, level 2).
const rows = [
  '5e8bf5f7f7f7f7f7f7f7f7f7f7f7f7f68afef5f7f7f7f7f7f7f7f7f7f7f65e8b',
  '8b5efdfffffffffffffffffffffffffefe9afdff0fffff0ffffffffffffe8b5e',
  '5e8bfdffffffffff1105288dff67fffe0e0ffdff3ba931355ffffffffffe5e8b',
  '8b5efdffffffffffffff0ffffffffffe1e1ffdff1fff0ffffffffffffffe8b5e',
  '5e8bfdffffffffffff2d0a8d6160fffe8afefdff4a5843a75ffffffffffe5e8b',
  'bcbdfdffffff0fffff0ffffffffffffefe9afdffff0ffffffffffffffffe8b5e',
  '8afefdffffff1c065b4d5a8d6160fffefe7cfdff5b4d5a8dff62fffffffe5e8b',
  'fe9afdffffffffff0ffffffffffffffe7c7dfdfffffffffffffffffffffe8b5e',
  'cf98fdffffffff0c1a250a8dff68fffe5e8bfdff71798d6260ad6260fffe5e8b',
  'df99fdfffffffffffffffffffffffffe8b5ef9f8f8f8f8f8f8f8f8f8f8fa8b5e',
  '8afefdffffff022f19270a8dff61fffeae8b7ffe8afeae8b5e8b5e8b5e8b5e8b',
  'fe9afdffffffff0ffffffffffffffffebe5e7e7ffe9abe5e8b5e8b5e8b5e8b5e',
  '8afefdffff0b861b2987078dff69fffe8c8df5f7f7f7f7f7f7f65e8b5e8b5e8b',
  'fe9afdffffff0ffffffffffffffffffefe8cfdfffffffffffffe8b5e8b5e8b5e',
  '8afefdffff0114022987078d6160fffe8afefdfffffffffffffe5e8b5e8b5e8b',
  'fe9afdffffffff0fff0ffffffffffffefe9afdfffffffffffffe8b5e8b5e8b5e',
  '8afefdff201e021e0206878dff60fffe8afefdfffffffffffffe5e8b5e8b5e8b',
  'fe9afdfffffffffffffffffffffffffefe9afdfffffffffffffe8b5e8b5e8b5e',
  '8afefdffffff0801082f118d6267fffe8afefdfffffffffffffe5e8b5e8b5e8b',
  'fe9af9f8f8f8f8f8f8f8f8f8f8f8f8fafe9af9f8f8f8f8f8f8fa8b5e8b5e8b5e'
];

function decodeWindows(rowHex, firstRow = 2) {
  const state = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(state);
  const tiles = new Array(960).fill(0x5e);
  rowHex.forEach((hex, i) => { for (let x = 0; x < 32; x++) tiles[(firstRow + i) * 32 + x] = parseInt(hex.slice(x * 2, x * 2 + 2), 16); });
  const source = `
    local text = dofile(${JSON.stringify(folder + 'profiles/fe1-text.lua')})
    local out = {}
    for _, w in ipairs(text.windows({ ${tiles.join(',')} })) do out[#out + 1] = w.col .. "|" .. tostring(w.speech) .. "|" .. w.unknown .. "|" .. w.text end
    return table.concat(out, "@@")
  `;
  const status = lauxlib.luaL_dostring(state, to_luastring(source));
  const out = to_jsstring(lua.lua_tostring(state, -1));
  lua.lua_close(state);
  assert.equal(status, 0, out);
  return out.split('@@').map(entry => { const [col, speech, unknown, ...text] = entry.split('|'); return { col: Number(col), speech: speech === 'true', unknown: Number(unknown), text: text.join('|') }; });
}

test('information and stats windows decode fully: long vowels, colons, slashes and small katakana', () => {
  const windows = decodeWindows(rows);
  const byText = needle => windows.find(window => window.text.includes(needle));
  const info = byText('ジェイガン');
  assert.ok(info, 'the unit information window is found');
  assert.equal(info.text, ['ジェイガン', 'パラディン', 'レベル: 2', 'HP:20/20'].join('\n'));
  assert.equal(info.unknown, 0);
  assert.equal(info.speech, false, 'not a conversation');
  const stats = byText('ちから');
  assert.ok(stats);
  assert.match(stats.text, /ちから: 7/);
  assert.match(stats.text, /すばやさ: 8/);
  assert.match(stats.text, /しゅびりょく: 9/);
  assert.match(stats.text, /けいけんち:27/);
  assert.equal(stats.unknown, 0, 'every tile in the stats window is mapped');
});

test('no window in a capture without a speech marker is reported as dialogue', () => {
  const state = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(state);
  const tiles = new Array(960).fill(0x5e);
  rows.forEach((hex, i) => { for (let x = 0; x < 32; x++) tiles[(2 + i) * 32 + x] = parseInt(hex.slice(x * 2, x * 2 + 2), 16); });
  const status = lauxlib.luaL_dostring(state, to_luastring(`
    local text = dofile(${JSON.stringify(folder + 'profiles/fe1-text.lua')})
    return tostring(text.dialogue({ ${tiles.join(',')} }))
  `));
  const out = to_jsstring(lua.lua_tostring(state, -1));
  lua.lua_close(state);
  assert.equal(status, 0, out);
  assert.equal(out, 'nil');
});

test('the unit information window is parsed into name, class text, level and HP', () => {
  const state = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(state);
  const tiles = new Array(960).fill(0x5e);
  rows.forEach((hex, i) => { for (let x = 0; x < 32; x++) tiles[(2 + i) * 32 + x] = parseInt(hex.slice(x * 2, x * 2 + 2), 16); });
  const status = lauxlib.luaL_dostring(state, to_luastring(`
    local text = dofile(${JSON.stringify(folder + 'profiles/fe1-text.lua')})
    local info = text.unit_info({ ${tiles.join(',')} })
    local empty = text.unit_info({ ${new Array(960).fill(0xff).join(',')} })
    return info.name .. "|" .. info.class_text .. "|" .. info.level .. "|" .. info.hp .. "|" .. info.max_hp .. "|" .. tostring(empty)
  `));
  const out = to_jsstring(lua.lua_tostring(state, -1));
  lua.lua_close(state);
  assert.equal(status, 0, out);
  assert.equal(out, 'ジェイガン|パラディン|2|20|20|nil');
});
