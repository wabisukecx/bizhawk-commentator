// Development tool: replays a recorded scene-probe session through the real FE1 Lua profile and checks that the
// decoded game state is self-consistent. Use it on recordings of later chapters, recruits and departures:
//   node game-pack-sources/fe1-jp-v1/dev/verify-session.mjs [captures/scene-probe/<session>]   (default: the newest session)
//   node game-pack-sources/fe1-jp-v1/dev/verify-session.mjs --all --json   (all local sessions, machine-readable reports)
// It needs sram_*.bin files (recorded by scene-probe.lua 0.9+). Exit code 1 means a finding that needs a look.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../../../', import.meta.url));
const { lua, lauxlib, lualib, to_luastring, to_jsstring } = require(path.join(root, 'node_modules/fengari'));
const luaFolder = fileURLToPath(new URL('../lua/', import.meta.url)).replaceAll('\\', '/');

const SRAM_START = 0x6A90;
const PLAYER_BASE = 0x6A90, PLAYER_SLOTS = 54, ENEMY_BASE = 0x7078, ENEMY_SLOTS = 20, RECORD = 27;
const EXCLUDED = new Set([0xFF, 0xF0]);
const exclusionMeaning = entry => entry.flag === 0xF0 ? 'unknown_exclusion' : entry.hp === 0 ? 'defeated' : 'left_side_with_hp';

// One Lua state with the profile loaded; decode(memory) returns the decoded game state (or the refusal reason).
function createDecoder() {
  const state = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(state);
  const ok = lauxlib.luaL_dostring(state, to_luastring(`
    profile = dofile(${JSON.stringify(luaFolder + 'fe1.lua')})
    json = dofile(${JSON.stringify(path.join(root, 'lua/json.lua').replaceAll('\\', '/'))})
    function decode(values, nametable)
      local mem = load("return {" .. values .. "}")()
      local nt = nametable ~= "" and load("return {" .. nametable .. "}")() or nil
      local result, reason = profile.read(function(address) return mem[address] or 0 end, nt and function() return nt end or nil)
      if not result then return json.encode({ reason = reason }) end
      return json.encode({ state = result })
    end
  `));
  if (ok !== lua.LUA_OK) throw new Error(to_jsstring(lua.lua_tostring(state, -1)));
  return (memory, nametable) => {
    lua.lua_getglobal(state, to_luastring('decode'));
    lua.lua_pushstring(state, to_luastring(memory));
    lua.lua_pushstring(state, to_luastring(nametable ?? ''));
    if (lua.lua_pcall(state, 2, 1, 0) !== lua.LUA_OK) throw new Error(to_jsstring(lua.lua_tostring(state, -1)));
    const out = to_jsstring(lua.lua_tostring(state, -1));
    lua.lua_pop(state, 1);
    return JSON.parse(out);
  };
}

function rosterOf(sram) {
  const read = address => sram[address - SRAM_START] ?? 0;
  const entries = [];
  const scan = (base, slots, side) => {
    for (let slot = 0; slot < slots; slot++) {
      const addr = base + slot * RECORD;
      const pid = read(addr);
      if (pid === 0) break; // the game stops at the first empty record
      entries.push({ key: `${side}:${slot}`, side, slot, pid, flag: read(addr + 0x12), hp: read(addr + 3), level: read(addr + 2), jid: read(addr + 1), x: read(addr + 0x11), y: read(addr + 0x10) });
    }
  };
  scan(PLAYER_BASE, PLAYER_SLOTS, 'player');
  scan(ENEMY_BASE, ENEMY_SLOTS, 'enemy');
  return entries;
}

export function analyze(dir) {
  const files = fs.readdirSync(dir);
  const seq = name => Number(name.split('_')[1]);
  const snaps = files.filter(f => f.startsWith('snap_')).sort();
  const srams = files.filter(f => f.startsWith('sram_')).sort();
  const report = { dir, snapshots: snaps.length, sramDumps: srams.length, findings: [], notes: [], chapters: [], rosterEvents: [], samples: 0, decoded: 0,
    coverage: { decodedChapters: [], playerZeroHpSamples: 0, playerDefeatTransitions: [] } };
  if (!srams.length) {
    report.findings.push({ level: 'error', message: 'No sram_*.bin files: record with dev/scene-probe.lua 0.9 or later (start-bizhawk.ps1 -LuaScript game-pack-sources/fe1-jp-v1/dev/bridge-with-probe.lua).' });
    return report;
  }
  const decode = createDecoder();
  let previousRoster = null, previousChapter = null, previousTurn = null, previousSample = null;
  const names = new Map();
  for (const sramName of srams) {
    // Each SRAM dump is saved together with the snapshot of the same number.
    const name = snaps.find(candidate => seq(candidate) === seq(sramName));
    if (!name) {
      report.findings.push({ level: 'error', message: `${sramName}: matching snap_*.bin file is missing` });
      previousRoster = null; previousSample = null;
      continue;
    }
    const snap = fs.readFileSync(path.join(dir, name));
    const sram = fs.readFileSync(path.join(dir, sramName));
    if (snap.length !== 4096 || sram.length < 0x7800 - SRAM_START) {
      report.findings.push({ level: 'error', message: `${sramName}: incomplete capture (snapshot ${snap.length} bytes, SRAM ${sram.length} bytes)` });
      previousRoster = null; previousSample = null;
      continue;
    }
    report.samples++;
    const memory = [];
    for (let i = 0; i < 0x800; i++) memory.push(`[${i}]=${snap[i]}`);
    for (let i = 0; i < sram.length; i++) memory.push(`[${SRAM_START + i}]=${sram[i]}`);
    const nametable = [...snap.subarray(2048 + 1024, 2048 + 1024 + 960)].join(',');
    const result = decode(memory.join(','), nametable);
    const roster = rosterOf(sram);
    const frame = Number(name.slice(0, -4).split('_')[2]);
    const label = `snapshot ${seq(name)}`;
    if (result.state) {
      report.decoded++;
      const state = result.state;
      if (!report.coverage.decodedChapters.includes(state.chapter)) report.coverage.decodedChapters.push(state.chapter);
      report.coverage.playerZeroHpSamples += roster.filter(entry => entry.side === 'player' && entry.hp === 0).length;
      // These are recorded RAM transitions, not proof of an on-screen death. Never infer one across
      // a chapter change, backwards frame/turn, invalid state or missing capture. A forward savestate
      // load cannot be identified from these dumps alone and still needs gameplay confirmation.
      if (previousSample?.state?.chapter === state.chapter && frame >= previousSample.frame && state.turn >= previousSample.state.turn) {
        for (const entry of roster.filter(unit => unit.side === 'player' && unit.hp === 0 && unit.flag === 0xFF)) {
          const old = previousRoster?.find(unit => unit.key === entry.key && unit.pid === entry.pid);
          if (old && old.hp > 0 && !EXCLUDED.has(old.flag)) report.coverage.playerDefeatTransitions.push({
            from: previousSample.at, at: seq(name), from_frame: previousSample.frame, frame,
            chapter: state.chapter, turn: state.turn, key: entry.key, pid: entry.pid,
            hp_from: old.hp, hp_to: entry.hp, flag_from: old.flag, flag_to: entry.flag,
          });
        }
      }
      if (state.chapter !== previousChapter) {
        report.chapters.push({ at: seq(name), chapter: state.chapter, turn: state.turn, map: state.map });
        previousChapter = state.chapter; previousTurn = null;
      }
      if (previousTurn !== null && state.turn < previousTurn) report.findings.push({ level: 'warn', message: `${label}: turn went back from ${previousTurn} to ${state.turn} within chapter ${state.chapter} (savestate load?)` });
      previousTurn = state.turn;
      const players = state.units.filter(u => u.side === 'player');
      const pids = players.map(u => u.character_id);
      if (new Set(pids).size !== pids.length) report.findings.push({ level: 'error', message: `${label}: duplicate player character IDs ${pids.filter((p, i) => pids.indexOf(p) !== i)}` });
      for (const unit of state.units) {
        if (unit.side === 'player' && !unit.name) report.findings.push({ level: 'warn', message: `${label}: player unit with character ID ${unit.character_id} has no name in the table` });
        if (!unit.class_name) report.findings.push({ level: 'warn', message: `${label}: ${unit.key} has unknown class ID ${unit.class_id}` });
        if (unit.side === 'player' && unit.name) names.set(unit.character_id, unit.name);
      }
      const occupied = new Map();
      for (const unit of state.units.filter(u => u.hp > 0)) {
        const cell = `${unit.x},${unit.y}`;
        if (occupied.has(cell)) report.findings.push({ level: 'warn', message: `${label}: ${unit.key} and ${occupied.get(cell)} share the cell ${cell}` });
        occupied.set(cell, unit.key);
      }
      if (state.rejected_records > 0) report.findings.push({ level: 'warn', message: `${label}: ${state.rejected_records} roster record(s) rejected by the profile's validation` });
    } else if (result.reason !== 'map_data_not_initialized') {
      report.findings.push({ level: 'warn', message: `${label}: state unavailable (${result.reason})` });
    }
    // Roster transitions from the raw records: joined, left, excluded (flag FF/F0) and returned.
    if (previousRoster) {
      const before = new Map(previousRoster.map(e => [e.key, e]));
      const now = new Map(roster.map(e => [e.key, e]));
      for (const [key, entry] of now) {
        const old = before.get(key);
        if (!old) report.rosterEvents.push({ at: seq(name), event: 'record_added', key, pid: entry.pid, flag: entry.flag });
        else if (old.pid !== entry.pid) report.rosterEvents.push({ at: seq(name), event: 'record_replaced', key, from: old.pid, to: entry.pid });
        else if (EXCLUDED.has(old.flag) !== EXCLUDED.has(entry.flag)) {
          // Observed meaning of the excluded flag: a record with 0 HP is a defeated unit; one that keeps its HP has left
          // that side (a recruit: the enemy record of Daros was excluded as his player record appeared).
          const excluded = EXCLUDED.has(entry.flag);
          report.rosterEvents.push({ at: seq(name), event: excluded ? 'excluded' : 'included', key, pid: entry.pid, flag_from: old.flag, flag_to: entry.flag, hp: entry.hp,
            ...(excluded ? { meaning: exclusionMeaning(entry) } : {}) });
        }
        else if ((old.flag === 0 || old.flag === 1) && (entry.flag === 0 || entry.flag === 1) && old.flag !== entry.flag) {
          // 1 = has acted this turn (seen: a priest healing without moving), back to 0 at a new turn.
          report.rosterEvents.push({ at: seq(name), event: entry.flag === 1 ? 'acted' : 'ready', key, pid: entry.pid });
        }
        else if (old.hp > 0 && entry.hp === 0) report.rosterEvents.push({ at: seq(name), event: 'hp_zero', key, pid: entry.pid, flag: entry.flag });
      }
      for (const [key, old] of before) if (!now.has(key)) report.rosterEvents.push({ at: seq(name), event: 'record_removed', key, pid: old.pid });
    }
    // A recruit: a player record appears as an enemy record with the same class, level, HP and position leaves.
    for (const added of report.rosterEvents.filter(e => e.at === seq(name) && e.event === 'record_added' && e.key.startsWith('player:'))) {
      const player = roster.find(e => e.key === added.key);
      const enemy = roster.find(e => e.side === 'enemy' && EXCLUDED.has(e.flag) && e.hp === player.hp && e.level === player.level && e.jid === player.jid && e.x === player.x && e.y === player.y);
      if (enemy) report.rosterEvents.push({ at: seq(name), event: 'recruited', player_pid: player.pid, enemy_pid: enemy.pid, enemy_key: enemy.key });
    }
    previousRoster = roster;
    previousSample = { at: seq(name), frame, state: result.state };
  }
  report.notes.push(`${report.decoded}/${report.samples} samples decoded by the real profile`);
  if (previousRoster) {
    const flags = {};
    for (const entry of previousRoster) flags[entry.flag] = (flags[entry.flag] ?? 0) + 1;
    report.notes.push(`record flags at the end: ${JSON.stringify(flags)} (0 ready, 1 acted, 255/240 excluded)`);
    report.excludedAtEnd = previousRoster.filter(e => EXCLUDED.has(e.flag)).map(e => ({ key: e.key, pid: e.pid, hp: e.hp, meaning: exclusionMeaning(e) }));
  }
  report.names = Object.fromEntries(names);
  return report;
}

function print(report) {
  console.log(`Session: ${report.dir}`);
  console.log(`${report.snapshots} snapshots, ${report.sramDumps} SRAM dumps; ${report.notes.join('; ')}`);
  console.log(`Coverage: decoded chapters [${report.coverage.decodedChapters.join(', ')}]; player zero-HP record samples ${report.coverage.playerZeroHpSamples}; player HP>0 -> 0 with flag FF transitions ${report.coverage.playerDefeatTransitions.length} (requires gameplay confirmation)`);
  for (const transition of report.coverage.playerDefeatTransitions) console.log('  player defeat candidate: ' + JSON.stringify(transition));
  for (const chapter of report.chapters) console.log(`  chapter ${chapter.chapter} (turn ${chapter.turn}, map ${chapter.map?.width}x${chapter.map?.height}) from snapshot ${chapter.at}`);
  if (report.rosterEvents.length) console.log('Roster events (raw records):');
  for (const event of report.rosterEvents) console.log('  ' + JSON.stringify(event));
  const counts = { error: 0, warn: 0 };
  for (const finding of report.findings) { counts[finding.level]++; console.log(`${finding.level.toUpperCase()}: ${finding.message}`); }
  console.log(`${counts.error} error(s), ${counts.warn} warning(s)`);
  return counts.error === 0 ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2), all = args.includes('--all'), json = args.includes('--json');
    const paths = args.filter(arg => !arg.startsWith('--'));
    if (args.some(arg => arg.startsWith('--') && !['--all', '--json'].includes(arg)) || paths.length > 1 || all && paths.length) {
      throw new Error('Usage: node game-pack-sources/fe1-jp-v1/dev/verify-session.mjs [session-directory] [--json] | --all [--json]');
    }
    let dirs = paths;
    if (!dirs.length) {
      const base = path.join(root, 'captures/scene-probe');
      const sessions = fs.existsSync(base) ? fs.readdirSync(base, { withFileTypes: true })
        .filter(entry => entry.isDirectory() && /^\d{8}-\d{6}$/.test(entry.name)).map(entry => entry.name).sort() : [];
      if (!sessions.length) throw new Error('No scene-probe sessions found. Record with scripts/start-bizhawk.ps1 -Probe first.');
      dirs = (all ? sessions : sessions.slice(-1)).map(name => path.join(base, name));
    }
    const reports = dirs.map(dir => analyze(dir));
    if (json) console.log(JSON.stringify(all ? reports : reports[0], null, 2));
    else for (const report of reports) print(report);
    process.exitCode = reports.some(report => report.findings.some(finding => finding.level === 'error')) ? 1 : 0;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
