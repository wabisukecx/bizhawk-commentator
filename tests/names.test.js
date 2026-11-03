import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { playerNames, enemyNames, unitName } from '../app/games/fe1-names.js';
import { fe1 } from '../app/games/fe1.js';

test('name lookup uses character ID, handles old bridge data and does not name generic enemies', async () => {
  assert.equal(playerNames[8], 'リカード');
  assert.equal(playerNames[9], 'リフ');
  assert.equal(playerNames[14], 'オグマ');
  assert.equal(playerNames[53], 'ガトー');
  assert.equal(unitName({ side: 'enemy', character_id: 9 }), undefined);
  assert.equal(unitName({ side: 'enemy', character_id: 133 }), 'ガルダへい', 'old bridge data without a name still gets the enemy name');
  assert.equal(unitName({ side: 'enemy', character_id: 133, name: 'ガルダへい' }), 'ガルダへい');
  assert.equal(unitName({ side: 'player', character_id: 255 }), undefined);
  const lua = await readFile(new URL('../lua/profiles/fe1.lua', import.meta.url), 'utf8');
  const tableOf = text => Object.fromEntries([...text.matchAll(/\[(\d+)\]="([^"]+)"/g)].map(m => [m[1], m[2]]));
  const split = lua.indexOf('local enemy_names');
  assert.deepEqual(tableOf(lua.slice(0, split)), playerNames, 'Lua and automatic commentary must use identical PID names');
  assert.deepEqual(tableOf(lua.slice(split, lua.indexOf('local classes'))), enemyNames, 'and identical enemy names');
});

test('both selected facts and full model input name a newly recruited ally without a Lua restart', () => {
  const marth = { key: 'p:0', side: 'player', character_id: 1, x: 0, y: 0, hp: 18, max_hp: 18 };
  const wrys = { key: 'p:7', side: 'player', character_id: 9, class_name: 'そうりょ', x: 6, y: 0, hp: 12, max_hp: 16 };
  const before = { profile_id: fe1.id, chapter: 1, turn: 1, units: [marth, wrys] };
  const current = { ...before, units: [{ ...marth, x: 5 }, wrys] };
  const candidate = fe1.selectCandidate([{ event: { type: 'position_changed', unit_key: marth.key }, receivedAt: 0 }], current, { before });
  assert.equal(candidate.context.facts.joined[0].name, 'リフ');
  assert.equal(fe1.summarize(current).units[1].name, 'リフ');
});
