-- FE1-specific short-lived logs live with the profile, not in the host bridge.
local folder=(debug.getinfo(1,"S").source:sub(2):match("^(.*[/\\])")) or ""
local map=dofile(folder .. "map-observer.lua")
local engine={}
function engine.new(session)
    local self=map.new(session)
    local sample,reset,get=self.sample,self.reset,self.get
    local dialogue,phase,battles,dialogue_seq,phase_seq,battle_seq,visible,pending,pending_n,logged
    local function clear()
        dialogue={}; phase={}; battles={}; dialogue_seq=0; phase_seq=0; battle_seq=0
        visible=nil; pending=nil; pending_n=0; logged=nil
    end
    clear()
    function self:reset(reason) reset(self,reason); clear() end
    function self:sample(frame,hash,state)
        sample(self,frame,hash,state)
        local text=state and state.dialogue and state.dialogue.text
        if text and (not dialogue[#dialogue] or dialogue[#dialogue].text~=text) then
            dialogue_seq=dialogue_seq+1
            dialogue[#dialogue+1]={id=dialogue_seq,text=text,frame=frame}
            if #dialogue>16 then table.remove(dialogue,1) end
        end
        local current=state and state.phase_banner
        if current and current~=visible then
            phase_seq=phase_seq+1; phase[#phase+1]={id=phase_seq,phase=current,frame=frame}
            if #phase>16 then table.remove(phase,1) end
        end
        visible=current
        local battle=state and state.battle
        if not battle then pending=nil; pending_n=0; logged=nil; return end
        local a,d=battle.attacker,battle.defender
        local signature=table.concat({a.pid,d.pid,a.hp,d.hp,a.hp_after,d.hp_after,a.level,d.level,battle.after.level,battle.exp},":")
        if signature==logged then return end
        if signature~=pending then pending=signature; pending_n=1; return end
        pending_n=pending_n+1
        if pending_n<2 then return end
        battle_seq=battle_seq+1; battle.id=battle_seq; battle.frame=frame
        battles[#battles+1]=battle
        if #battles>8 then table.remove(battles,1) end
        logged=signature
    end
    function self:get()
        local result=get(self)
        result.logs={dialogue=dialogue,phase=phase,battle=battles}
        return result
    end
    return self
end
return engine
