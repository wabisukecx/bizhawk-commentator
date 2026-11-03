-- Development tool: records RAM and nametables while you play, to find which values
-- distinguish scenes (map, menu, battle, village/dialogue) and where on-screen text lives.
-- Read-only: no input, no writes, no screenshots (so no on-screen notices).
-- Open it in a SECOND Lua Console script slot; it can run beside lua/bridge.lua.
-- Output in captures/scene-probe/<session>/ :
--   snap_<seq>_<frame>.bin  = CPU RAM 0x0000-0x07FF (2 KiB) + nametables (2 KiB)
--   sram_<seq>_<frame>.bin  = save RAM 0x6A90-0x77FF (units, map, chapter/turn), every SRAM_EVERY snapshots;
--                             scripts/dev/verify-session.mjs replays these through the real profile
local INTERVAL = 60          -- one snapshot about every second
local SRAM_EVERY = 5         -- unit/map data about every 5 seconds
local MAX_SECONDS = 3600     -- stop after one hour of wall-clock time
local SRAM_START, SRAM_END = 0x6A90, 0x77FF

local script_dir = (debug.getinfo(1, "S").source:sub(2):match("^(.*[/\\])")) or ""
local root = script_dir .. "../../captures/scene-probe/"
local session = os.date("%Y%m%d-%H%M%S")
local dir = root .. session .. "/"
os.execute('mkdir "' .. (root:gsub("/", "\\")) .. '" 2>nul')
os.execute('mkdir "' .. (dir:gsub("/", "\\")) .. '" 2>nul')

local function has_domain(name)
    local list = memory.getmemorydomainlist()
    for i = 0, #list do if list[i] == name then return true end end
    return false
end

-- Nametables: prefer the dedicated domain; otherwise read through the PPU bus.
local nt_domain, nt_base = "CIRAM (nametables)", 0x0000
if not has_domain(nt_domain) then nt_domain, nt_base = "PPU Bus", 0x2000 end

local function read_string(address, length, domain)
    local raw = memory.read_bytes_as_array(address, length, domain)
    local base = raw[0] ~= nil and 0 or 1
    local parts = {}
    for i = 0, length - 1, 256 do
        parts[#parts + 1] = string.char(table.unpack(raw, base + i, base + i + 255))
    end
    return table.concat(parts)
end

local function save(name, data)
    local file = io.open(dir .. name, "wb")
    if file then file:write(data); file:close() end
end

local count, last_frame, started = 0, nil, os.time()
console.log("[scene-probe] recording to " .. dir .. " (nametables: " .. nt_domain .. ")")

-- Frame numbers jump on savestate loads, so pace by frames since the last snapshot, not by absolute frame.
local function tick()
    if os.time() - started > MAX_SECONDS then
        console.log("[scene-probe] finished")
        event.unregisterbyname("scene-probe")
        return
    end
    local frame = emu.framecount()
    if last_frame and frame >= last_frame and frame - last_frame < INTERVAL then return end
    last_frame = frame
    count = count + 1
    save(string.format("snap_%05d_%07d.bin", count, frame),
        read_string(0x0000, 0x0800, "System Bus") .. read_string(nt_base, 0x0800, nt_domain))
    if count % SRAM_EVERY == 1 then
        -- Length is padded to a multiple of 256 by read_string's chunking, so read whole 256-byte pages.
        local length = math.ceil((SRAM_END - SRAM_START + 1) / 256) * 256
        save(string.format("sram_%05d_%07d.bin", count, frame), read_string(SRAM_START, length, "System Bus"))
    end
end

event.onframeend(tick, "scene-probe")
