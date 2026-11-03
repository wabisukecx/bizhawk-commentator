-- Observation-only BizHawk bridge. Wire protocol inspired by dmang-dev/mcp-bizhawk.
-- Load this file in BizHawk's Lua Console after launching with socket options.
-- No controller input, pause, frame advance, or memory write commands are exposed.
local script_dir = (debug.getinfo(1, "S").source:sub(2):match("^(.*[/\\])")) or ""
local json = dofile(script_dir .. "json.lua")
local profiles = dofile(script_dir .. "profiles/registry.lua")
local observations = dofile(script_dir .. "observations.lua")
local observer_session=tostring(os.time()) .. "-" .. tostring(os.clock())
local observer_generation=1
local observer_profile="unsupported"
local observer = observations.new(observer_session,"none")
local profile_error

-- Second nametable (960 tile IDs, 1-based) for profiles that read on-screen text.
local nt_domain, nt_base
local function read_nametable()
    if not (memory and memory.read_bytes_as_array and memory.getmemorydomainlist) then return nil end
    if not nt_domain then
        nt_domain, nt_base = "PPU Bus", 0x2000
        local list = memory.getmemorydomainlist()
        local i = list[0] ~= nil and 0 or 1
        while list[i] ~= nil do
            if list[i] == "CIRAM (nametables)" then nt_domain, nt_base = list[i], 0 end
            i = i + 1
        end
    end
    local raw = memory.read_bytes_as_array(nt_base, 0x800, nt_domain)
    local base = raw[0] ~= nil and 0 or 1
    local second, first = {}, {}
    for i = 0, 959 do
        second[i + 1] = raw[base + 0x400 + i] or 0
        first[i + 1] = raw[base + i] or 0
    end
    return second, first -- NT1 (windows, dialogue), NT0 (the PLAYER banner)
end

local function read_state()
    local hash=gameinfo.getromhash()
    local profile = profiles.find(emu.getsystemid(),hash)
    if not profile then return nil,"unsupported_rom" end
    if not observations.supports(profile.observation_kind) then return nil,"unsupported_observation_schema" end
    if not memory or not memory.read_u8 then return nil,"memory_read_unavailable" end
    local ok,state,reason=pcall(profile.read,function(address) return memory.read_u8(address,"System Bus") end,read_nametable)
    if not ok then return nil,"memory_read_failed: " .. tostring(state) end
    return state,reason
end

-- Speech windows can be on screen for only a second or two, shorter than the app's polling
-- interval, so distinct pages seen at the sampling cadence are kept for the app to collect.
local dialogue_log, dialogue_seq = {}, 0
local function note_dialogue(text)
    local last = dialogue_log[#dialogue_log]
    if last and last.text == text then return end
    dialogue_seq = dialogue_seq + 1
    dialogue_log[#dialogue_log + 1] = { id = dialogue_seq, text = text, frame = emu.framecount() }
    if #dialogue_log > 16 then table.remove(dialogue_log, 1) end
end

-- The turn banner ("PLAYER" / "COMPUTER" in a small window) is on screen for about a second, so each
-- appearance is logged for the app to collect, like dialogue pages.
local phase_log, phase_seq, phase_visible = {}, 0, nil
local function note_phase(phase)
    if phase and phase ~= phase_visible then
        phase_seq = phase_seq + 1
        phase_log[#phase_log + 1] = { id = phase_seq, phase = phase, frame = emu.framecount() }
        if #phase_log > 16 then table.remove(phase_log, 1) end
    end
    phase_visible = phase
end

-- A fight is logged once, after two identical consecutive samples (so a half-written struct is skipped).
local battle_log, battle_seq, battle_pending, battle_pending_n, battle_logged = {}, 0, nil, 0, nil
local function note_battle(battle)
    if not battle then battle_pending, battle_pending_n, battle_logged = nil, 0, nil; return end
    local a, d = battle.attacker, battle.defender
    local signature = table.concat({ a.pid, d.pid, a.hp, d.hp, a.hp_after, d.hp_after, a.level, d.level, battle.after.level, battle.exp }, ":")
    if signature == battle_logged then return end
    if signature ~= battle_pending then battle_pending, battle_pending_n = signature, 1; return end
    battle_pending_n = battle_pending_n + 1
    if battle_pending_n < 2 then return end
    battle_seq = battle_seq + 1
    battle.id = battle_seq; battle.frame = emu.framecount()
    battle_log[#battle_log + 1] = battle
    if #battle_log > 8 then table.remove(battle_log, 1) end
    battle_logged = signature
end

local function sample()
    local profile=profiles.find(emu.getsystemid(),gameinfo.getromhash())
    local identity=profile and profile.id or "unsupported"
    if identity~=observer_profile then
        observer_generation=observer_generation+1
        observer=observations.new(observer_session .. "-" .. observer_generation,profile and profile.observation_kind or "none")
        observer_profile=identity
    end
    local state,reason=read_state()
    if state and state.dialogue and state.dialogue.text then note_dialogue(state.dialogue.text) end
    note_battle(state and state.battle or nil)
    note_phase(state and state.phase_banner or nil)
    profile_error=reason
    observer:sample(emu.framecount(),gameinfo.getromhash(),state)
    return state
end

local function available(t, key)
    return t ~= nil and t[key] ~= nil
end

local function get_info()
    local profile=profiles.find(emu.getsystemid(),gameinfo.getromhash())
    local domains = {}
    if available(memory, "getmemorydomainlist") then
        local raw = memory.getmemorydomainlist()
        local i = raw[0] ~= nil and 0 or 1
        while raw[i] ~= nil do
            domains[#domains + 1] = raw[i]
            i = i + 1
        end
    end
    return {
        bridge_version = "0.2.2",
        system = emu.getsystemid(),
        rom_name = gameinfo.getromname(),
        rom_hash = gameinfo.getromhash(),
        frame = emu.framecount(),
        paused = available(client, "ispaused") and client.ispaused() or false,
        memory_domains = domains,
        capabilities = { screenshot = available(client, "screenshot"), game_profile = profile~=nil and observations.supports(profile.observation_kind), recent_observations = true }
    }
end

local function get_context(params)
    if emu.getsystemid() == "NULL" then error("No ROM loaded. Open a game in BizHawk first.") end
    if not available(client, "screenshot") then error("client.screenshot is unavailable on this build") end
    if type(params.screenshot_path) ~= "string" then error("screenshot_path is required") end
    local result = get_info()
    result.game_state=sample()
    result.profile_status=profile_error or "supported"
    result.recent_observations=observer:get()
    result.dialogue_log=dialogue_log
    result.battle_log=battle_log
    result.phase_log=phase_log
    -- No yield between metadata and capture. The game continues after this tick.
    client.screenshot(params.screenshot_path)
    result.frame_after_capture = emu.framecount()
    result.width = client.bufferwidth()
    result.height = client.bufferheight()
    return result
end

-- Same data as get_context without the screenshot, for frequent polling.
local function get_state()
    if emu.getsystemid() == "NULL" then error("No ROM loaded. Open a game in BizHawk first.") end
    local result = get_info()
    result.game_state=sample()
    result.profile_status=profile_error or "supported"
    result.recent_observations=observer:get()
    result.dialogue_log=dialogue_log
    result.battle_log=battle_log
    result.phase_log=phase_log
    result.frame_after_capture = emu.framecount()
    return result
end

local function get_events()
    sample()
    local result=observer:get()
    result.profile_status=profile_error or "supported"
    return result
end
local handlers = { get_info = get_info, get_context = get_context, get_state = get_state, get_recent_events = get_events }

local function reply(incoming)
    local parsed, command = pcall(json.decode, incoming)
    if not parsed or type(command) ~= "table" then error("Invalid command JSON") end
    local handler = handlers[command.method]
    if not handler then
        return { id = command.id, error = { message = "Unknown observation method" } }
    end
    local ok, result = pcall(handler, command.params or {})
    if ok then return { id = command.id, result = result } end
    return { id = command.id, error = { message = tostring(result) } }
end

if not available(comm, "socketServerSend") or not available(comm, "socketServerResponse") then
    error("Launch EmuHawk with --socket_ip=127.0.0.1 --socket_port=8766")
end
if available(comm, "socketServerSetTimeout") then comm.socketServerSetTimeout(5) end
console.log("[bizhawk-commentator] observation bridge starting")
if available(event,"onloadstate") then
    event.onloadstate(function() observer:reset("savestate_loaded") end,"bizhawk-commentator-state-load")
end
comm.socketServerSend("READY")
while true do
    local frame=emu.framecount()
    if not observer.last_frame or frame < observer.last_frame or frame-observer.last_frame>=15 or gameinfo.getromhash() ~= observer.hash then sample() end
    local ok, incoming = pcall(comm.socketServerResponse)
    if not ok then error("Socket disconnected. Reconnect and restart bridge.lua: " .. tostring(incoming)) end
    if incoming and #incoming > 0 then
        local outgoing = "READY"
        if incoming ~= "NONE" then outgoing = "RESULT " .. json.encode(reply(incoming)) end
        if comm.socketServerSend(outgoing) < 0 then error("Socket send failed. Restart bridge.lua after reconnecting.") end
    end
    -- Unlike frameadvance(), yield lets the player keep the emulator paused.
    emu.yield()
end
