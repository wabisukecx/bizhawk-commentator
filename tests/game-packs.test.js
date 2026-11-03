import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { zipSync, strToU8 } from 'fflate';
import { readGamePack, buildGamePack, buildSourcePacks, prepareGamePacks, loadGameAdapters } from '../src/game-packs.js';
import { createGameRegistry } from '../app/games/registry.js';
import { fe1 } from './helpers/fe1.js';
import { Watcher } from '../app/watcher.js';
const { lua, lauxlib, lualib, to_luastring, to_jsstring } = createRequire(import.meta.url)('fengari');
const root = fileURLToPath(new URL('../', import.meta.url));
const luaFolder = path.join(root, 'lua').replaceAll('\\', '/') + '/';

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'commentator-packs-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const packs = path.join(directory, 'packs');
  await fs.mkdir(packs);
  return { directory: packs, cacheDirectory: path.join(directory, 'cache'), indexFile: path.join(directory, 'index.lua') };
}

test('development sources build into the runtime folder and ZIP-only installations do not require sources', async t => {
  const options = await fixture(t);
  const sources = path.join(path.dirname(options.directory), 'sources');
  await fs.cp(path.join(root, 'tests/fixtures/game-pack'), path.join(sources, 'example'), { recursive: true });
  const outputs = await buildSourcePacks(sources, options.directory);
  assert.deepEqual(outputs, [path.join(options.directory, 'example-hp-v1.zip')]);
  assert.deepEqual(await fs.readdir(sources), ['example']);
  const zip = await fs.readFile(outputs[0]);
  const repeat = path.join(path.dirname(options.directory), 'repeat.zip');
  await buildGamePack(path.join(sources, 'example'), repeat);
  assert.deepEqual(await fs.readFile(repeat), zip, 'unchanged source produces the same pack and cache key');
  assert.deepEqual(await buildSourcePacks(path.join(sources, 'not-included'), options.directory), []);
  assert.deepEqual(await fs.readFile(outputs[0]), zip, 'missing sources must not change the runtime ZIP');
  const [adapter] = await loadGameAdapters(options);
  assert.equal(adapter.id, 'example-hp-v1');
});

function runLua(indexFile, source) {
  const state = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(state);
  // Redirect only the generated index: execute the delivered bridge/registries/profile/observer unchanged.
  const harness = `local original_dofile=dofile
    dofile=function(filename)
      if filename:gsub("\\\\", "/"):match("runtime/game%-packs/index%.lua$") then
        return original_dofile(${JSON.stringify(indexFile.replaceAll('\\', '/'))})
      end
      return original_dofile(filename)
    end
    ${source}`;
  const status = lauxlib.luaL_dostring(state, to_luastring(harness));
  const error = status === lua.LUA_OK ? '' : to_jsstring(lua.lua_tostring(state, -1));
  lua.lua_close(state);
  assert.equal(status, lua.LUA_OK, error);
}

test('a ZIP supplies a new scalar game from Lua capture and custom observations through watcher narration', async t => {
  const options = await fixture(t);
  const filename = path.join(options.directory, 'example.zip');
  await buildGamePack(path.join(root, 'tests/fixtures/game-pack'), filename);
  const { files, manifest } = readGamePack(await fs.readFile(filename));
  files['lua/profile.lua'] = strToU8(new TextDecoder().decode(files['lua/profile.lua']).replace('return {profile_id=profile.id,', 'return {battle={unrelated=true}, profile_id=profile.id,'));
  files['lua/observer.lua'] = strToU8(new TextDecoder().decode(files['lua/observer.lua']).replace('return {observer_session_id=session,', 'return {logs={arbitrary={{id=1,text="custom log"}}}, observer_session_id=session,'));
  await fs.writeFile(filename, zipSync({ ...files, 'pack.json': strToU8(JSON.stringify({ ...manifest, memoryDomain: 'Fixture RAM' })) }));
  const adapters = await loadGameAdapters(options);
  assert.equal(adapters[0].id, 'example-hp-v1');
  runLua(options.indexFile, `
    local json=dofile(${JSON.stringify(luaFolder + 'json.lua')})
    local ticks=0; local sent={}
    local incoming={json.encode({id=1,method="get_state"}),json.encode({id=2,method="get_state"})}
    console={log=function() end}
    emu={getsystemid=function() return "NES" end,framecount=function() return 1+ticks*15 end,
      yield=function() ticks=ticks+1; if ticks==2 then error("TEST_DONE") end end}
    gameinfo={getromname=function() return "Synthetic fixture" end,getromhash=function() return string.rep("0",40) end}
    memory={read_u8=function(address,domain)
      assert(domain=="Fixture RAM")
      if address==0x100 then return ticks==0 and 10 or 7 end
      if address==0x101 then return 10 end
      if address==0x102 then return 1 end
      return 0
    end,getmemorydomainlist=function() return {[0]="Fixture RAM"} end}
    client={ispaused=function() return false end}
    comm={socketServerSetTimeout=function() end,
      socketServerResponse=function() return incoming[ticks+1] end,
      socketServerSend=function(value) sent[#sent+1]=value; return #value end}
    local ok, reason=pcall(dofile,${JSON.stringify(luaFolder + 'bridge.lua')})
    assert(not ok and tostring(reason):match("TEST_DONE"), tostring(reason))
    local snapshot=json.decode(sent[3]:sub(8)).result
    assert(snapshot.game_state.profile_id=="example-hp-v1" and snapshot.game_state.hp==7)
    assert(snapshot.game_state.units==nil, "must not inherit FE state")
    assert(snapshot.game_state.battle.unrelated==true, "the bridge must not interpret an arbitrary battle field")
    assert(snapshot.game_logs.arbitrary[1].text=="custom log")
    assert(snapshot.battle_log==nil and snapshot.phase_log==nil and snapshot.dialogue_log==nil)
    assert(snapshot.recent_observations.events[1].field=="hp")
    assert(snapshot.recent_observations.events[1].from==10 and snapshot.recent_observations.events[1].to==7)
    local registry=dofile(${JSON.stringify(luaFolder + 'profiles/registry.lua')})
    assert(registry.find("NES",string.rep("1",40))==nil)
    assert(registry.find("SNES",string.rep("0",40))==nil)
    assert(registry.find("NES","8600D1880EB311BAE0ECE197F6175228E38F6B69")==nil, "no built-in FE fallback")
  `);
  let now = 0, generation;
  const watcher = new Watcher({ language: 'en', tone: 'announcer', clock: () => now, resolveGame: createGameRegistry(adapters).resolve,
    authenticate: async () => ({ plan: 'pro' }), includedOnlyConfirmed: true,
    generate: async payload => { generation = payload; return { speak: true, comment: 'The HP dropped.' }; } });
  t.after(() => watcher.stop());
  await watcher.start();
  const snapshot = (hp, events = []) => ({ game_state: { profile_id: 'example-hp-v1', hp, max_hp: 10, stage: 1 }, recent_observations: { timeline_id: 'sample:1', events } });
  watcher.accept(snapshot(10));
  const event = { event_id: 1, type: 'value_changed', field: 'hp', from: 10, to: 7 };
  watcher.accept(snapshot(7, [event]));
  watcher.maybePlay();
  assert.equal(watcher.history.at(-1).text, 'Player: HP 10 to 7.');
  assert.equal(watcher.publicState().game.label, 'Stage 1');
  now = 2500; await watcher.maybeGenerate();
  assert.deepEqual(generation.game, { stage: 1, hp: 7, max_hp: 10 });
  assert.equal(watcher.history.at(-1).text, 'The HP dropped.');
});

test('with no ZIP installed, both the app and Lua bridge have no FE reader or commentary fallback', async t => {
  const options = await fixture(t);
  const adapters = await loadGameAdapters(options);
  assert.deepEqual(adapters, []);
  const registry = createGameRegistry(adapters);
  assert.equal(registry.resolve({ profile_id: fe1.id, units: [] }), null);
  let calls = 0;
  const watcher = new Watcher({ resolveGame: registry.resolve, includedOnlyConfirmed: true,
    authenticate: async () => ({ plan: 'pro' }), generate: async () => { calls++; } });
  t.after(() => watcher.stop());
  await watcher.start();
  watcher.accept({ game_state: { profile_id: fe1.id, units: [] }, recent_observations: { timeline_id: 'none', events: [{ event_id: 1, type: 'unit_joined' }] },
    battle_log: [{ id: 1, unrelated: true }] });
  await watcher.maybeGenerate();
  assert.equal(watcher.runtime, null);
  assert.equal(calls, 0);
  runLua(options.indexFile, `
    assert(dofile(${JSON.stringify(luaFolder + 'profiles/registry.lua')}).find("NES","8600D1880EB311BAE0ECE197F6175228E38F6B69")==nil)
    assert(not dofile(${JSON.stringify(luaFolder + 'observations.lua')}).supports("fe1-map-v2"))
  `);
});

test('FE observation logs belong to its pack and are reset along with its timeline', async t => {
  const options = await fixture(t);
  await fs.copyFile(path.join(root, 'game-packs/fe1-jp-v1.zip'), path.join(options.directory, 'fe1.zip'));
  await prepareGamePacks(options);
  runLua(options.indexFile, `
    local engine=dofile(${JSON.stringify(luaFolder + 'game-packs.lua')}).engines["fe1-map-v2"]
    local observer=engine.new("logs")
    local state={chapter=2,turn=3,units={},dialogue={text="village"},phase_banner="player",
      battle={attacker={pid=3,hp=20,hp_after=17,level=1},defender={pid=133,hp=18,hp_after=0,level=1},after={level=1},exp=5}}
    observer:sample(100,"ROM",state)
    assert(#observer:get().logs.battle==0, "a half-written fight is not logged")
    observer:sample(115,"ROM",state)
    observer:sample(130,"ROM",state)
    local logs=observer:get().logs
    assert(#logs.battle==1 and logs.battle[1].attacker.pid==3)
    assert(#logs.dialogue==1 and #logs.phase==1)
    observer:reset("savestate_loaded")
    assert(#observer:get().logs.battle==0 and #observer:get().logs.dialogue==0 and #observer:get().logs.phase==0)
  `);
});

test('a non-FE pack runtime owns derived events and model context without host schema assumptions', async t => {
  let now = 0, payload;
  const adapter = { id: 'score-only', title: 'Score', accepts: state => Number.isFinite(state.score),
    summarize: state => ({ score: state.score }), fingerprint: state => String(state.score), describe: state => String(state.score), selectCandidate: () => null,
    playByPlay: events => events.map(event => ({ text: `Score is ${event.value}.`, topicKey: String(event.event_id), priority: 2 })),
    createRuntime() {
      let ready = null;
      return {
        observe(snapshot, events, { now, baseline }) {
          if (baseline) return [];
          ready = { event: { type: 'score_milestone' }, receivedAt: now, category: 'score', priority: 2, context: { score: snapshot.game_state.score } };
          return [{ type: 'score_report', event_id: 99, value: snapshot.game_state.score }];
        },
        candidate: () => ready, consume: () => { ready = null; }, context: state => ({ scoreboard: state.score }),
      };
    } };
  const watcher = new Watcher({ language: 'en', tone: 'announcer', resolveGame: createGameRegistry([adapter]).resolve, clock: () => now, includedOnlyConfirmed: true,
    authenticate: async () => ({ plan: 'pro' }), generate: async input => { payload = input; return { speak: false, comment: '' }; } });
  t.after(() => watcher.stop());
  await watcher.start();
  const snapshot = score => ({ game_state: { profile_id: adapter.id, score }, recent_observations: { timeline_id: 'score:1', events: [] }, game_logs: { scoreboard: [] } });
  watcher.accept(snapshot(0));
  now = 2500; watcher.accept(snapshot(100)); watcher.maybePlay();
  assert.equal(watcher.history[0].text, 'Score is 100.');
  now = 5000; await watcher.maybeGenerate();
  assert.deepEqual(payload.game_context, { scoreboard: 100 });
  assert.equal(watcher.runtime.candidate(), null);
});

test('the distributed FE1 ZIP retains its adapter and Lua helper behavior', async t => {
  const options = await fixture(t);
  const filename = path.join(options.directory, 'fe1.zip');
  await fs.copyFile(path.join(root, 'game-packs/fe1-jp-v1.zip'), filename);
  const pack = readGamePack(await fs.readFile(filename));
  assert.ok(pack.files['app/fe1-names.js']);
  assert.ok(pack.files['app/fe1-i18n.js']);
  assert.ok(pack.files['lua/fe1-text.lua']);
  assert.ok(pack.files['app/runtime.js']);
  assert.ok(pack.files['app/phrases.js']);
  assert.ok(pack.files['lua/observer.lua']);
  assert.equal(Object.keys(pack.files).some(name => name.startsWith('dev/')), false);
  const [adapter] = await loadGameAdapters(options);
  const state = { profile_id: fe1.id, chapter: 2, turn: 3, units: [{ key: 'player:0', character_id: 1, side: 'player', hp: 18, max_hp: 18, x: 2, y: 3 }] };
  assert.deepEqual(adapter.summarize(state), fe1.summarize(state));
  assert.equal(adapter.fingerprint(state), fe1.fingerprint(state));
  runLua(options.indexFile, `
    local profile=dofile(${JSON.stringify(luaFolder + 'profiles/registry.lua')}).find("NES","8600D1880EB311BAE0ECE197F6175228E38F6B69")
    local memory={ [0x7674]=2,[0x7675]=3,[0x7676]=14,[0x7677]=31,
      [0x6A90]=1,[0x6A91]=21,[0x6A92]=1,[0x6A93]=18,[0x6A94]=18,[0x6AA0]=3,[0x6AA1]=2 }
    local state=profile.read(function(address) return memory[address] or 0 end)
    assert(state and state.units[1].name=="マルス" and state.units[1].hp==18)
    assert(profile.memory_domain=="System Bus")
  `);
});

test('pack validation rejects path traversal, case collisions, excessive expansion and unsupported manifests', async t => {
  const options = await fixture(t);
  await buildGamePack(path.join(root, 'tests/fixtures/game-pack'), path.join(options.directory, 'example.zip'));
  const { files } = readGamePack(await fs.readFile(path.join(options.directory, 'example.zip')));
  for (const name of ['../escape.js', 'C:/escape.js', 'lua/../../escape.lua', 'host.mjs', 'package.json', 'lua/CON.lua']) {
    assert.throws(() => readGamePack(zipSync({ ...files, [name]: strToU8('x') })), /entry|path/);
  }
  assert.throws(() => readGamePack(zipSync({ ...files, 'APP/adapter.js': strToU8('x') })), /Duplicate/);
  assert.throws(() => readGamePack(zipSync({ ...files, 'large.txt': new Uint8Array(2 * 1024 * 1024 + 1) })), /size limit/);
  const manifest = JSON.parse(new TextDecoder().decode(files['pack.json']));
  for (const change of [{ apiVersion: 99 }, { adapter: 'absent.js' }, { rom: { system: 'NES', hashes: ['any-rom'] } }, { observation: { kind: 'unknown-v1' } }]) {
    assert.throws(() => readGamePack(zipSync({ ...files, 'pack.json': strToU8(JSON.stringify({ ...manifest, ...change })) })));
  }
});

test('conflicting packs fail before publishing an index and missing folders publish an empty index', async t => {
  const options = await fixture(t);
  const filename = path.join(options.directory, 'one.zip');
  await buildGamePack(path.join(root, 'tests/fixtures/game-pack'), filename);
  await fs.copyFile(filename, path.join(options.directory, 'two.zip'));
  await assert.rejects(prepareGamePacks(options), /Duplicate game pack ID/);
  await assert.rejects(fs.readFile(options.indexFile), /ENOENT/);
  const { files, manifest } = readGamePack(await fs.readFile(filename));
  await fs.writeFile(path.join(options.directory, 'two.zip'), zipSync({ ...files, 'pack.json': strToU8(JSON.stringify({ ...manifest, id: 'another-game' })) }));
  await assert.rejects(prepareGamePacks(options), /Conflicting game pack ROM/);
  await fs.writeFile(path.join(options.directory, 'two.zip'), zipSync({ ...files, 'pack.json': strToU8(JSON.stringify({ ...manifest, id: 'another-game', rom: { system: 'NES', hashes: ['1'.repeat(40)] } })) }));
  await assert.rejects(prepareGamePacks(options), /Duplicate custom observation engine/);
  await fs.rm(path.join(options.directory, 'two.zip'));
  const emptyOptions = { ...options, directory: path.join(options.directory, 'missing') };
  assert.deepEqual(await prepareGamePacks(emptyOptions), []);
  assert.match(await fs.readFile(options.indexFile, 'utf8'), /return \{\}/);
});

test('updates use immutable caches, removal clears registration, and adapter contract mismatches fail', async t => {
  const options = await fixture(t);
  const filename = path.join(options.directory, 'example.zip');
  await buildGamePack(path.join(root, 'tests/fixtures/game-pack'), filename);
  const concurrent = await Promise.all(Array.from({ length: 8 }, () => prepareGamePacks(options)));
  const first = concurrent[0][0];
  assert.ok(concurrent.every(packs => packs[0].directory === first.directory), 'simultaneous app/MCP startup can share the cache and index');
  const { files, manifest } = readGamePack(await fs.readFile(filename));
  await fs.writeFile(filename, zipSync({ ...files, 'pack.json': strToU8(JSON.stringify({ ...manifest, version: '1.0.1' })) }));
  const [second] = await prepareGamePacks(options);
  assert.notEqual(first.directory, second.directory);
  await fs.writeFile(filename, zipSync({ ...files, 'app/adapter.js': strToU8('export default { id: "wrong" };') }));
  await assert.rejects(loadGameAdapters(options), /identity\/schema/);
  await fs.writeFile(filename, zipSync({ ...files, 'app/adapter.js': strToU8(`export default { id: 'example-hp-v1', stateSchema: 'example-hp-events-v1' };`) }));
  await assert.rejects(loadGameAdapters(options), /missing adapter.accepts/);
  await fs.rm(filename);
  assert.deepEqual(await loadGameAdapters(options), []);
  runLua(options.indexFile, `assert(#dofile(${JSON.stringify(luaFolder + 'game-packs.lua')}).profiles==0)`);
});
