import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { lua, lauxlib, lualib, to_luastring, to_jsstring } = require('fengari');

test('actual Lua script captures same-frame metadata, yields while paused, rejects control commands', () => {
  const state = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(state);
  const file = fileURLToPath(new URL('../lua/bridge.lua', import.meta.url)).replaceAll('\\', '/');
  const harness = `
    local source = ${JSON.stringify(file)}
    local folder = source:match("^(.*[/])")
    local json = dofile(folder .. "json.lua")
    local incoming = {
      json.encode({id=1, method="get_info"}),
      json.encode({id=2, method="get_context", params={screenshot_path="test.png"}}),
      json.encode({id=3, method="write8"}),
      "NONE",
      json.encode({id=4, method="get_context", params={screenshot_path="test.png"}})
    }
    local sent = {}
    local ticks, shots = 0, 0
    console = { log=function() end }
    emu = {
      getsystemid=function() return ticks == 4 and "NULL" or "NES" end,
      framecount=function() return 42 end,
      yield=function() ticks=ticks+1; if ticks >= #incoming then error("TEST_DONE") end end,
      frameadvance=function() error("Must never advance paused game") end
    }
    gameinfo = { getromname=function() return "FE test" end, getromhash=function() return "HASH" end }
    memory = { getmemorydomainlist=function() return {[0]="RAM",[1]="ROM"} end }
    client = {
      ispaused=function() return true end,
      screenshot=function(p) assert(p=="test.png"); shots=shots+1 end,
      bufferwidth=function() return 256 end, bufferheight=function() return 240 end
    }
    comm = {
      socketServerSetTimeout=function(n) assert(n==5) end,
      socketServerSend=function(s) sent[#sent+1]=s; return #s end,
      socketServerResponse=function() return incoming[ticks+1] end
    }
    local ok, err = pcall(dofile, source)
    assert(not ok and tostring(err):match("TEST_DONE"), tostring(err))
    assert(sent[1]=="READY")
    local info=json.decode(sent[2]:sub(8)).result
    assert(info.paused==true and info.memory_domains[1]=="RAM")
    local context=json.decode(sent[3]:sub(8)).result
    assert(context.frame==42 and context.frame_after_capture==42 and shots==1)
    assert(json.decode(sent[4]:sub(8)).error.message:match("Unknown"))
    assert(json.decode(sent[6]:sub(8)).error.message:match("No ROM"))
  `;
  const result = lauxlib.luaL_dostring(state, to_luastring(harness));
  const error = result === lua.LUA_OK ? '' : to_jsstring(lua.lua_tostring(state, -1));
  lua.lua_close(state);
  assert.equal(result, 0, error);
});
