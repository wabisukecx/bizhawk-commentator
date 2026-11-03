-- A scalar-state example: no tactical map or FE-specific unit schema is required.
local engine={}
function engine.new(session)
    local self={generation=1,events={},next_id=1,dropped=0,reset_reason="startup"}
    function self:reset(reason)
        self.generation=self.generation+1; self.previous=nil; self.last_frame=nil
        self.last_valid_frame=nil; self.events={}; self.dropped=0; self.reset_reason=reason
    end
    function self:sample(frame,hash,state)
        if self.hash and self.hash~=hash then self:reset("rom_changed") end
        if self.last_frame and frame<self.last_frame then self:reset("frame_rewound") end
        local old=self.previous
        if state and old and state.stage~=old.state.stage then self:reset("stage_changed"); old=nil end
        if state and old then
            for _,field in ipairs({"hp","max_hp"}) do
                if state[field]~=old.state[field] then
                    self.events[#self.events+1]={event_id=self.next_id,type="value_changed",field=field,
                        from=old.state[field],to=state[field],before_frame=old.frame,after_frame=frame}
                    self.next_id=self.next_id+1
                    if #self.events>128 then table.remove(self.events,1); self.dropped=self.dropped+1 end
                end
            end
        end
        self.hash=hash; self.last_frame=frame; self.previous=state and {state=state,frame=frame} or nil
        if state then self.last_valid_frame=frame end
    end
    function self:get()
        return {observer_session_id=session,timeline_id=session .. ":" .. self.generation,
            events=self.events,events_dropped=self.dropped,reset_reason=self.reset_reason,
            checked_through_frame=self.last_frame,sampled_through_frame=self.last_valid_frame,
            state_available=self.previous~=nil,interval_frames=15,
            limitations="Sampled HP changes do not identify their cause."}
    end
    return self
end
return engine
