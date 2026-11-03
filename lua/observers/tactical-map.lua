local module = {}

function module.new(session)
    local self = { session=session, generation=1, events={}, next_id=1, dropped=0, reset_reason="startup", seen_players={} }
    function self:reset(reason)
        self.generation=self.generation+1
        self.previous=nil; self.last_frame=nil; self.last_valid_frame=nil; self.events={}; self.dropped=0; self.reset_reason=reason; self.seen_players={}
    end
    function self:append(value)
        value.event_id=self.next_id; self.next_id=self.next_id+1
        self.events[#self.events+1]=value
        if #self.events>128 then table.remove(self.events,1); self.dropped=self.dropped+1 end
    end
    function self:sample(frame,hash,state)
        if self.hash and self.hash ~= hash then self:reset("rom_changed") end
        if self.last_frame and frame < self.last_frame then self:reset("frame_rewound") end
        self.hash=hash; self.last_frame=frame
        local old=self.previous
        if state and old then
            if state.chapter ~= old.state.chapter then
                self:reset("chapter_changed"); self.last_frame=frame
                self:append({type="chapter_changed",from=old.state.chapter,to=state.chapter,after_frame=frame,before_frame=old.frame})
            else
                if state.turn ~= old.state.turn then
                    self:append({type="turn_changed",from=old.state.turn,to=state.turn,after_frame=frame,before_frame=old.frame})
                end
                local before={}
                for _,unit in ipairs(old.state.units) do before[unit.key]=unit end
                for _,unit in ipairs(state.units) do
                    local prev=before[unit.key]
                    if prev and prev.character_id == unit.character_id then
                        local function emit(kind,from,to)
                            self:append({type=kind,unit_key=unit.key,name=unit.name,side=unit.side,from=from,to=to,before_frame=old.frame,after_frame=frame})
                        end
                        if unit.hp ~= prev.hp then emit("hp_changed",prev.hp,unit.hp) end
                        if unit.x ~= prev.x or unit.y ~= prev.y then emit("position_changed",{x=prev.x,y=prev.y},{x=unit.x,y=unit.y}) end
                    end
                end
            end
        end
        -- A player character never seen before in this timeline joined the party (a recruit). Characters that
        -- only dropped out of the list and came back are not new: their IDs are already remembered.
        if state then
            for _,unit in ipairs(state.units) do
                if unit.side=="player" and not self.seen_players[unit.character_id] then
                    self.seen_players[unit.character_id]=true
                    if old and state.chapter == old.state.chapter then
                        self:append({type="unit_joined",unit_key=unit.key,name=unit.name,side=unit.side,character_id=unit.character_id,
                            class_name=unit.class_name,level=unit.level,hp=unit.hp,max_hp=unit.max_hp,before_frame=old.frame,after_frame=frame})
                    end
                end
            end
        end
        self.previous=state and {frame=frame,state=state} or nil
        if state then self.last_valid_frame=frame end
    end
    function self:get()
        return {
            observer_session_id=self.session,timeline_id=self.session .. ":" .. self.generation,
            reset_reason=self.reset_reason,events=self.events,events_dropped=self.dropped,
            sampled_through_frame=self.last_valid_frame,checked_through_frame=self.last_frame,state_available=self.previous~=nil,interval_frames=15,
            limitations="Observed differences between samples; not exact action times, attacker identity, or enemy intent. Missing units are not classified as deaths. RAM map data may persist in menus."
        }
    end
    return self
end

return module
