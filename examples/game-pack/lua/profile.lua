local folder=(debug.getinfo(1,"S").source:sub(2):match("^(.*[/\\])")) or ""
local layout=dofile(folder .. "layout.lua")
local profile={id="example-hp-v1", observation_kind="example-hp-events-v1"}
function profile.read(read)
    local hp, max_hp, stage=read(layout.hp), read(layout.max_hp), read(layout.stage)
    if max_hp<1 or hp>max_hp or stage<1 then return nil,"map_data_not_initialized" end
    return {profile_id=profile.id, source="ram", hp=hp, max_hp=max_hp, stage=stage}
end
return profile
