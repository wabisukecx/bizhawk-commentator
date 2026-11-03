import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { lua, lauxlib, lualib, to_luastring, to_jsstring } = require('fengari');
const folder = fileURLToPath(new URL('../lua/', import.meta.url)).replaceAll('\\', '/');

function run(source) {
  const state = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(state);
  const result = lauxlib.luaL_dostring(state, to_luastring(source));
  const error = result === lua.LUA_OK ? '' : to_jsstring(lua.lua_tostring(state, -1));
  lua.lua_close(state);
  assert.equal(result, 0, error);
}

test('FE1 profile gates exact ROM identity and decodes HP and zero-based coordinates with validation', () => run(`
  local profile=dofile(${JSON.stringify(folder + 'profiles/fe1.lua')})
  local registry=dofile(${JSON.stringify(folder + 'profiles/registry.lua')})
  assert(registry.find("NES","8600D1880EB311BAE0ECE197F6175228E38F6B69").id==profile.id)
  assert(registry.find("NES","other-rom")==nil)
  assert(registry.find("SNES","8600D1880EB311BAE0ECE197F6175228E38F6B69")==nil)
  assert(profile.matches("NES","8600d1880eb311bae0ece197f6175228e38f6b69"))
  assert(not profile.matches("NES","other-rom"))
  assert(not profile.matches("SNES","8600D1880EB311BAE0ECE197F6175228E38F6B69"))
  local mem={ [0x7674]=1,[0x7675]=1,[0x7676]=20,[0x7677]=31 }
  local a=0x6a90
  mem[a]=1; mem[a+1]=21; mem[a+2]=1; mem[a+3]=18; mem[a+4]=18
  mem[a+7]=5; mem[a+16]=6; mem[a+17]=25
  local read=function(addr) return mem[addr] or 0 end
  local result=profile.read(read)
  assert(result.chapter==1 and result.turn==1 and result.map.width==32)
  assert(#result.units==1 and result.units[1].hp==18 and result.units[1].name=="マルス")
  assert(result.units[1].x==25 and result.units[1].y==6 and result.units[1].strength==5)
  assert(result.phase==nil and result.selected_unit==nil)
  mem[a]=9; mem[a+1]=19
  assert(profile.read(read).units[1].name=="リフ")
  mem[a]=14; mem[a+1]=6
  assert(profile.read(read).units[1].name=="オグマ")
  mem[a]=53; mem[a+1]=20
  assert(profile.read(read).units[1].name=="ガトー")
  mem[a]=1; mem[a+1]=21
  mem[a+0x13]=15; mem[a+0x17]=20
  mem[0xd9c3+14]=0x0e; mem[0xd657+14]=6; mem[0xd70f+14]=7
  result=profile.read(read)
  local item=result.units[1].inventory[1]
  assert(item.item_id==15 and item.uses==20 and item.metadata_verified)
  assert(item.is_attack_item and item.ranges[1]==1 and item.ranges[2]==2)
  assert(item.might==6 and item.weight==7 and result.units[1].inventory_complete)
  mem[a+0x13]=19; mem[0xd9c3+18]=0x0c
  item=profile.read(read).units[1].inventory[1]
  assert(#item.ranges==1 and item.ranges[1]==2)
  mem[a+0x13]=93
  result=profile.read(read)
  assert(not result.units[1].inventory_complete and not result.units[1].inventory[1].metadata_verified)
  mem[a+3]=19
  assert(profile.read(read)==nil,"HP above maximum must not be exposed")
  mem[a+3]=18; mem[a+18]=0xff
  assert(profile.read(read)==nil,"Excluded roster records must not appear active")
  mem[a+18]=0; mem[a+17]=32
  assert(profile.read(read)==nil,"Coordinates outside map must be excluded")
  mem[a+17]=25; mem[0x7674]=255
  assert(profile.read(read)==nil,"Uninitialized map must fall back to image-only")
`));

test('history bounds sampled changes and resets on savestate, ROM, rewind, chapter and unavailable state', () => run(`
  local history=dofile(${JSON.stringify(folder + 'observations.lua')}).new("test-session")
  local function state(hp,x,turn,chapter)
    return { chapter=chapter or 1,turn=turn or 1,units={{key="player:0",character_id=1,name="マルス",side="player",hp=hp,x=x,y=6}} }
  end
  history:sample(100,"ROM",state(18,25))
  history:sample(115,"ROM",state(12,26))
  assert(#history.events==2 and history.events[1].type=="hp_changed")
  assert(history.events[1].from==18 and history.events[1].to==12)
  assert(history.events[1].before_frame==100 and history.events[1].after_frame==115)
  history:sample(130,"ROM",state(12,26))
  assert(#history.events==2,"Identical observations must not repeat events")
  history:sample(145,"ROM",state(12,26,2))
  assert(history.events[3].type=="turn_changed")
  local timeline=history:get().timeline_id
  history:reset("savestate_loaded")
  history:sample(500,"ROM",state(18,25))
  assert(#history.events==0 and history:get().timeline_id~=timeline)
  history:sample(400,"ROM",state(17,25))
  assert(#history.events==0 and history.reset_reason=="frame_rewound")
  history:sample(415,"OTHER",state(1,1))
  assert(#history.events==0 and history.reset_reason=="rom_changed")
  history:sample(430,"OTHER",state(15,2,1,2))
  assert(#history.events==1 and history.events[1].type=="chapter_changed")
  history:sample(445,"OTHER",nil)
  history:sample(460,"OTHER",state(9,3,1,2))
  assert(#history.events==1,"No HP comparison across unavailable observations")
  for i=1,150 do history:sample(460+i*15,"OTHER",state(10+i%2,3,1,2)) end
  assert(#history.events==128 and history.dropped>0)
  assert(history.events[128].event_id>history.events[1].event_id)
`));

test('unknown observation engines do not interpret game-specific state', () => run(`
  local engines=dofile(${JSON.stringify(folder + 'observations.lua')})
  assert(engines.supports("tactical-map-v1"))
  assert(not engines.supports("unregistered"))
  local empty=engines.new("unknown-session","unregistered")
  empty:sample(100,"ROM",{units={{hp=18}}})
  empty:sample(115,"ROM",{units={{hp=1}}})
  assert(#empty:get().events==0 and empty:get().state_available==false)
`));
