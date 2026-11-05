import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { luaPath, playByPlay, localizedTone, fe1 } from './helpers/fe1.js';
const { lua, lauxlib, lualib, to_luastring, to_jsstring } = createRequire(import.meta.url)('fengari');
function run(source) {
  const vm = lauxlib.luaL_newstate(); lualib.luaL_openlibs(vm);
  try {
    const status = lauxlib.luaL_dostring(vm, to_luastring(source));
    assert.equal(status, lua.LUA_OK, status ? to_jsstring(lua.lua_tostring(vm, -1)) : '');
  } finally { lua.lua_close(vm); }
}

test('map reader restores occupied terrain, respects row stride, and reads actual battle weapon effectiveness', () => run(`
  local p=dofile(${JSON.stringify(luaPath('fe1.lua'))})
  local m={[0x7674]=2,[0x7675]=3,[0x7676]=3,[0x7677]=7,
    [0x6a90]=1,[0x6a91]=21,[0x6a92]=1,[0x6a93]=18,[0x6a94]=18,
    [0x6a96]=0xab,[0x6aa0]=1,[0x6aa1]=2,
    [0x72af+32+2]=0x2a,[0x72af+64+3]=0xa5,
    [0x7078]=133,[0x7079]=2,[0x707a]=1,[0x707b]=20,[0x707c]=20,
    [0x304]=1,[0x305]=133,[0x306]=21,[0x307]=2,[0x308]=1,[0x309]=1,[0x30c]=18,[0x30d]=20,
    [0x320]=4,[0x321]=0,[0xd8db+4]=1,[0xd939]=0x4d,[0xd93a]=0xd9,[0xd94d]=2,[0xd94e]=0xff,
    [0x338]=5,[0x33a]=25,[0x340]=3}
  local function read(a) return m[a] or 0 end
  local s=p.read(read)
  assert(s.map_cells[1*8+2+1]==0xab,'unit graphics must not hide the chest underneath')
  assert(s.map_cells[2*8+3+1]==0xa5,'32-byte memory stride differs from output width')
  assert(s.enemy_records[1].character_id==133)
  assert(s.battle.attacker.effective and s.battle.attacker.attack_speed==5 and s.battle.attacker.hit_rate==25)
  m[0x320]=8; m[0xd8db+8]=1
  assert(not p.read(read).battle.attacker.effective,'magic sword skips physical effectiveness')
  m[0x320]=0x2a; m[0xd8db+0x2a]=1
  assert(not p.read(read).battle.attacker.effective,'magic skips physical effectiveness')
`));

test('new enemies and terrain events require confirmation, and never cross reset or missing-data boundaries', () => run(`
  local h=dofile(${JSON.stringify(luaPath('map-observer.lua'))}).new('extra')
  local function state(tile,enemy,flag,hp,chapter)
    local units={{key='player:0',side='player',character_id=1,class_id=21,hp=18,x=1,y=1,acted=false}}
    if enemy then units[#units+1]={key='enemy:0',side='enemy',character_id=133,hp=20,x=3,y=2} end
    return {chapter=chapter or 2,turn=3,map={width=2,height=1},map_cells={tile,0xab},units=units,
      enemy_records=flag and {{key='enemy:0',character_id=133,flag=flag,hp=hp}} or {}}
  end
  h:sample(100,'ROM',state(0xa5,false))
  h:sample(115,'ROM',state(0xa9,true))
  assert(#h.events==0,'first changed sample is not enough')
  h:sample(130,'ROM',state(0xa9,true))
  assert(#h.events==2 and h.events[1].type=='enemy_appeared' and h.events[2].type=='village_destroyed')
  h:sample(145,'ROM',state(0xa9,true)); assert(#h.events==2,'no repetition')
  h:reset('savestate_loaded')
  h:sample(200,'ROM',state(0xa5,false,0xff,0))
  h:sample(215,'ROM',state(0xa5,true))
  h:sample(230,'ROM',state(0xa5,true))
  assert(#h.events==1 and h.events[1].type=='enemy_appeared','defeated slot can be reused')
  h:reset('savestate_loaded')
  h:sample(300,'ROM',state(0xa5,false,0xf0,20))
  h:sample(315,'ROM',state(0xa5,true)); h:sample(330,'ROM',state(0xa5,true))
  assert(#h.events==0,'living excluded record returning is not an observed reinforcement')
  h:sample(345,'ROM',nil)
  h:sample(360,'ROM',state(0xa9,true)); h:sample(375,'ROM',state(0xa9,true))
  assert(#h.events==0,'no comparisons across unavailable state')
  h:sample(390,'ROM',state(0xa5,false, nil,nil,3))
  h:sample(405,'ROM',state(0xa5,false,nil,nil,3))
  assert(#h.events==1 and h.events[1].type=='chapter_changed','new chapter is only a baseline')
  h:reset('test')
  h:sample(500,'ROM',state(0xa5,false))
  h:sample(515,'ROM',state(0xa9,false))
  h:sample(530,'ROM',state(0xa5,false))
  assert(#h.events==0,'a transient changed tile is not announced')
  local s=state(0xa5,false); h:sample(545,'ROM',s)
  s=state(0xa5,false); s.map_cells[2]=0xac; h:sample(560,'ROM',s); h:sample(575,'ROM',s)
  assert(#h.events==1 and h.events[1].type=='chest_opened')
  h:reset('busy')
  h:sample(600,'ROM',state(0xa5,false))
  local busy=state(0xa9,false); busy.scene={menu_mode_raw=1}
  h:sample(615,'ROM',busy); h:sample(630,'ROM',busy)
  assert(#h.events==0,'menus hold confirmed events')
  h:sample(645,'ROM',state(0xa9,false))
  assert(#h.events==1 and h.events[1].type=='village_destroyed')
  h:reset('rewind')
  h:sample(700,'ROM',state(0xa5,false))
  h:sample(715,'ROM',state(0xa9,true))
  local rewound=state(0xa9,true); rewound.turn=2
  h:sample(730,'ROM',rewound)
  assert(#h.events==0 and h.reset_reason=='turn_rewound','turn rewind discards pending events')
`));

test('class and acted changes are confirmed; terrain recovery describes location without assuming its cause', () => run(`
  local h=dofile(${JSON.stringify(luaPath('map-observer.lua'))}).new('stats')
  local function state(jid,acted,hp,tile)
    return {chapter=1,turn=1,units={{key='player:0',side='player',character_id=1,class_id=jid,
      acted=acted,hp=hp,x=1,y=1,terrain_tile_raw=tile}}}
  end
  h:sample(100,'ROM',state(6,false,10,0x4a))
  h:sample(115,'ROM',state(10,true,15,0x4a))
  assert(h.events[1].recovery_on_terrain)
  h:sample(130,'ROM',state(10,true,15,0x4a))
  assert(h.events[2].type=='class_changed' and h.events[3].type=='unit_acted')
  h:sample(145,'ROM',state(10,true,18,0x4b))
  assert(not h.events[4].recovery_on_terrain,'moving onto different terrain is not terrain recovery evidence')
`));

const player = { key: 'player:0', side: 'player', character_id: 1, name: 'マルス', class_name: 'ロード', class_id: 21, hp: 18, max_hp: 18, x: 1, y: 1, acted: true };
const enemy = { key: 'enemy:0', side: 'enemy', character_id: 133, hp: 20, x: 4, y: 4 };
const state = { chapter: 2, turn: 3, units: [player, enemy] };
for (const language of ['ja', 'en']) {
  test(`observed map changes, class changes and location-qualified healing narrate in ${language}`, () => {
    const tone = localizedTone('announcer', language);
    const events = [
      { type: 'enemy_appeared', unit_key: enemy.key, character_id: 133 },
      { type: 'village_destroyed', x: 1, y: 2 }, { type: 'chest_opened', x: 3, y: 2 },
      { type: 'class_changed', unit_key: player.key, character_id: 1, to: 21 },
      { type: 'hp_changed', unit_key: player.key, from: 10, to: 18, recovery_on_terrain: true },
    ];
    const lines = playByPlay(events, state, { tone });
    assert.equal(lines.length, 5);
    assert.ok(lines.some(l => /回復地形|healing terrain/.test(l.text)));
    assert.ok(lines.some(l => /宝箱|chest/.test(l.text)));
    assert.ok(lines.every(l => !/\{\w+\}/.test(l.text)));
    assert.deepEqual(playByPlay([{ type: 'enemy_appeared', unit_key: enemy.key, character_id: 999 }], state, { tone }), [], 'discard a replaced enemy');
  });
}

test('battle facts explain actual effective hits and near-level experience, never mere carried weapons', () => {
  const attacker = { pid: 1, name: 'マルス', jid: 21, level: 1, hp: 18, hp_after: 18, max_hp: 18, damage: 5, hit_first: true, effective: true };
  const defender = { pid: 133, jid: 2, level: 1, hp: 20, hp_after: 15, max_hp: 20, damage: 0, hit_first: false };
  const battle = { type: 'battle', event_id: 10, attacker, defender, after: { level: 1, exp: 95 }, exp_gained: 5, follow_up: 0 };
  const tone = localizedTone('announcer');
  let lines = playByPlay([battle], state, { tone });
  assert.match(lines[0].text, /特効/);
  assert.ok(lines.some(l => /経験値あと5/.test(l.text)));
  lines = playByPlay([{ ...battle, attacker: { ...attacker, effective: undefined } }], state, { tone });
  assert.doesNotMatch(lines[0].text, /特効/);
  lines = playByPlay([{ ...battle, attacker: { ...attacker, hit_first: false, hit_rate: 25 }, defender: { ...defender, hp_after: 20 } }], state, { tone });
  assert.doesNotMatch(lines[0].text, /特効/);
  assert.match(lines[0].text, /命中率25%/);
  for (const patch of [{ exp: 89 }, { exp: 100 }, { exp: undefined }, { level: 2, exp: 95 }]) {
    lines = playByPlay([{ ...battle, after: { ...battle.after, ...patch } }], state, { tone });
    assert.ok(!lines.some(l => l.topicKey.startsWith('experience:')), 'experience milestone requires a valid near-level remainder without a level-up');
  }
});

test('remaining actions require the player phase and fully known flags', () => {
  const runtime = fe1.createRuntime();
  const units = Array.from({ length: 5 }, (_, i) => ({ ...player, key: `player:${i}`, character_id: i + 1, acted: i < 4 }));
  const snapshot = (phase, id) => ({ game_state: { ...state, units }, phase_log: [{ phase, id, frame: id * 100 }], battle_log: [], dialogue_log: [] });
  runtime.observe(snapshot('player', 0), [], { baseline: true, now: 0 });
  const acted = { type: 'unit_acted', event_id: 1, after_frame: 110 };
  let derived = runtime.observe(snapshot('player', 1), [acted], { now: 1 });
  assert.equal(derived.find(e => e.type === 'actions_remaining')?.count, 1);
  derived = runtime.observe(snapshot('enemy', 2), [{ ...acted, after_frame: 210 }], { now: 2 });
  assert.equal(derived.length, 0);
});
