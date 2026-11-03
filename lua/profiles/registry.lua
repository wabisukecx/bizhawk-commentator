-- Each game profile supplies id, matches(system, hash), and read(read_byte).
local folder = (debug.getinfo(1,"S").source:sub(2):match("^(.*[/\\])")) or ""
local profiles = {
    dofile(folder .. "fe1.lua")
}
local registry = {}
function registry.find(system, hash)
    for _, profile in ipairs(profiles) do
        if profile.matches(system, hash) then return profile end
    end
    return nil
end
return registry
