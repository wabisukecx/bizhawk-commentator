-- Read-only emulator access shared by all game packs. Array results are normalized to 1-based lists.
local module={}
function module.new(memory,default_domain)
    local reader={}
    function reader.read_u8(address,domain) return memory.read_u8(address,domain or default_domain) end
    function reader.domains()
        if not memory or not memory.getmemorydomainlist then return {} end
        local raw=memory.getmemorydomainlist(); local result={}; local index=raw[0]~=nil and 0 or 1
        while raw[index]~=nil do result[#result+1]=raw[index]; index=index+1 end
        return result
    end
    function reader.read_bytes(address,length,domain)
        if not memory or not memory.read_bytes_as_array then return nil end
        local raw=memory.read_bytes_as_array(address,length,domain or default_domain)
        local base=raw[0]~=nil and 0 or 1; local result={}
        for index=0,length-1 do result[index+1]=raw[base+index] or 0 end
        return result
    end
    return reader
end
return module
