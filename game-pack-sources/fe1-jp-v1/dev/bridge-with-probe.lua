-- Loads the scene probe, then the normal bridge, from a single --lua argument.
-- The probe only registers a frame callback and returns; the bridge then runs its loop.
local folder = (debug.getinfo(1, "S").source:sub(2):match("^(.*[/\\])")) or ""
local ok, err = pcall(dofile, folder .. "scene-probe.lua")
if not ok then console.log("[scene-probe] failed to start: " .. tostring(err)) end
dofile(folder .. "../../../lua/bridge.lua")
