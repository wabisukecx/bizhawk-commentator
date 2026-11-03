-- The Node service prepares this index before BizHawk connects. No ZIP code runs in BizHawk.
local folder = (debug.getinfo(1, "S").source:sub(2):match("^(.*[/\\])")) or ""
local index = folder .. "../runtime/game-packs/index.lua"
local ok, definitions = pcall(dofile, index)
if not ok then
    local reason = tostring(definitions)
    if reason:match("ENOENT") or reason:match("cannot open") or reason:match("No such file") then return { profiles={}, engines={} } end
    error("Invalid game pack index: " .. reason)
end
assert(type(definitions)=="table", "Invalid game pack index")
local result = { profiles={}, engines={} }

local function load_pack(definition)
    local root = definition.root:gsub("\\", "/") .. "/"
    local environment = {
        assert=assert, error=error, ipairs=ipairs, pairs=pairs, next=next, pcall=pcall,
        select=select, tonumber=tonumber, tostring=tostring, type=type,
        setmetatable=setmetatable, getmetatable=getmetatable,
        debug={getinfo=debug.getinfo}
    }
    for _, name in ipairs({"math", "string", "table", "utf8"}) do
        environment[name]={}
        for key, value in pairs(_G[name] or {}) do environment[name][key]=value end
    end
    -- Only the supplied read callback reaches emulator memory. Helpers may load files inside this pack.
    -- JavaScript adapters run as trusted local code; this limited Lua environment is not a JS sandbox.
    function environment.dofile(filename)
        filename=filename:gsub("\\", "/")
        assert(filename:sub(1,#root)==root, "Pack helper is outside its directory")
        for part in filename:gmatch("[^/]+") do assert(part~=".." and part~=".", "Invalid pack helper path") end
        local chunk, reason = loadfile(filename, "t", environment)
        assert(chunk, reason)
        return chunk()
    end
    local profile=environment.dofile(definition.profile)
    assert(type(profile)=="table" and profile.id==definition.id and profile.observation_kind==definition.kind and type(profile.read)=="function", "Pack profile identity/schema mismatch")
    -- The manifest, rather than arbitrary profile code, decides which ROM is interpreted.
    local hashes={}
    for _, hash in ipairs(definition.hashes) do hashes[hash]=true end
    profile.matches=function(system, hash) return system==definition.system and hashes[string.upper(hash or "")] == true end
    profile.memory_domain=definition.domain
    result.profiles[#result.profiles+1]=profile
    if definition.observer then
        local engine=environment.dofile(definition.observer)
        assert(type(engine)=="table" and type(engine.new)=="function", "Invalid pack observation engine")
        result.engines[definition.kind]=engine
    end
end

for _, definition in ipairs(definitions) do load_pack(definition) end
return result
