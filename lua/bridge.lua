-- Observation-only BizHawk bridge. Wire protocol inspired by dmang-dev/mcp-bizhawk.
-- Load this file in BizHawk's Lua Console after launching with socket options.
-- No controller input, pause, frame advance, or memory write commands are exposed.
local script_dir = (debug.getinfo(1, "S").source:sub(2):match("^(.*[/\\])")) or ""
local json = dofile(script_dir .. "json.lua")
local profiles = dofile(script_dir .. "profiles/registry.lua")
local observations = dofile(script_dir .. "observations.lua")
local readers = dofile(script_dir .. "memory-reader.lua")
local observer_session=tostring(os.time()) .. "-" .. tostring(os.clock())
local observer_generation=1
local observer_profile="unsupported"
local observer = observations.new(observer_session,"none")
local profile_error

local function read_state()
    local hash=gameinfo.getromhash()
    local profile = profiles.find(emu.getsystemid(),hash)
    if not profile then return nil,"unsupported_rom" end
    if not observations.supports(profile.observation_kind) then return nil,"unsupported_observation_schema" end
    if not memory or not memory.read_u8 then return nil,"memory_read_unavailable" end
    local reader=readers.new(memory,profile.memory_domain or "System Bus")
    local ok,state,reason=pcall(profile.read,reader.read_u8,reader)
    if not ok then return nil,"memory_read_failed: " .. tostring(state) end
    return state,reason
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
    profile_error=reason
    observer:sample(emu.framecount(),gameinfo.getromhash(),state)
    return state
end

local function available(t, key)
    return t ~= nil and t[key] ~= nil
end

local function get_info()
    local profile=profiles.find(emu.getsystemid(),gameinfo.getromhash())
    local domains=readers.new(memory,"System Bus").domains()
    return {
        bridge_version = "0.4.0",
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
    local observed=observer:get()
    result.game_logs=observed.logs or {}
    observed.logs=nil
    result.recent_observations=observed
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
    local observed=observer:get()
    result.game_logs=observed.logs or {}
    observed.logs=nil
    result.recent_observations=observed
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
