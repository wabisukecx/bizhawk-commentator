-- Explicit registration; the bridge does not interpret game-specific fields.
local folder=(debug.getinfo(1,"S").source:sub(2):match("^(.*[/\\])")) or ""
local engines=dofile(folder .. "game-packs.lua").engines
local module={}
function module.supports(kind) return engines[kind]~=nil end
function module.new(session,kind)
    if engines[kind] then return engines[kind].new(session) end
    local empty={generation=1,events={},reset_reason="unsupported_profile"}
    function empty:reset(reason)
        self.generation=self.generation+1; self.last_frame=nil; self.reset_reason=reason
    end
    function empty:sample(frame,hash)
        if self.hash and self.hash~=hash then self:reset("rom_changed") end
        if self.last_frame and frame<self.last_frame then self:reset("frame_rewound") end
        self.last_frame=frame; self.hash=hash
    end
    function empty:get()
        return {observer_session_id=session,timeline_id=session .. ":" .. self.generation,
            reset_reason=self.reset_reason,events={},events_dropped=0,state_available=false,
            checked_through_frame=self.last_frame,limitations="No supported observation engine for this profile."}
    end
    return empty
end
return module
