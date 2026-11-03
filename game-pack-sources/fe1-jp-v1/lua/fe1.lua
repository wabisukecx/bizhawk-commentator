-- Independently implemented from factual layout documented by StanHash/fe1:
-- commit 9b2fd3a03347818a60afaf913f94c36de0d953ba, include/sram.asm,
-- include/structs/unit.asm and code/home/unit.asm. No reference ASM is bundled.
local folder = (debug.getinfo(1, "S").source:sub(2):match("^(.*[/\\])")) or ""
local text = dofile(folder .. "fe1-text.lua")
local profile = { id = "fe1-jp-v1", observation_kind = "fe1-map-v2" }
local hashes = { ["8600D1880EB311BAE0ECE197F6175228E38F6B69"] = true }
-- PID-indexed name table $DE2B verified in the supported ROM.
local names = {
    [1]="マルス",
    [2]="シーダ",
    [3]="ジェイガン",
    [4]="カイン",
    [5]="アベル",
    [6]="ドーガ",
    [7]="ゴードン",
    [8]="リカード",
    [9]="リフ",
    [10]="サジ",
    [11]="マジ",
    [12]="バーツ",
    [13]="カシム",
    [14]="オグマ",
    [15]="ダロス",
    [16]="ジュリアン",
    [17]="レナ",
    [18]="マリク",
    [19]="ナバール",
    [20]="ハーディン",
    [21]="ウルフ",
    [22]="ザガロ",
    [23]="ロシェ",
    [24]="ビラク",
    [25]="バヌトゥ",
    [26]="シーザ",
    [27]="ラディ",
    [28]="ミディア",
    [29]="カチュア",
    [30]="マリア",
    [31]="ミネルバ",
    [32]="リンダ",
    [33]="ジョルジュ",
    [34]="トムス",
    [35]="ミシェラン",
    [36]="トーマス",
    [37]="ボア",
    [38]="アラン",
    [39]="サムソン",
    [40]="ベック",
    [41]="チェイニー",
    [42]="ウェンデル",
    [43]="エスト",
    [44]="アストリア",
    [45]="マチス",
    [46]="ロジャー",
    [47]="ジェイク",
    [48]="パオラ",
    [49]="チキ",
    [50]="ロレンス",
    [51]="エリス",
    [52]="セイバー",
    [53]="ガトー"
}
-- Enemy names: the game's second name table (pointer table at $DFA4, one entry per person ID 129..197, strings
-- end with 0xEF, tile IDs as in the font). Checked in play: ID 133 is the "ガルダへい" the unit information
-- window shows for pirates, and the enemy record with ID 173 (Daros) turned into the player record with ID 15 when he joined.
local enemy_names = {
    [129]="ガザック",
    [130]="ワイラー",
    [131]="グルニアへい",
    [132]="ゴメス",
    [133]="ガルダへい",
    [134]="サムシアン",
    [135]="ナバール",
    [136]="ムラク",
    [137]="ハーマイン",
    [138]="マリオネス",
    [139]="ベンソン",
    [140]="カナリス",
    [141]="マヌー",
    [142]="ジューコフ",
    [143]="ショーゼン",
    [144]="ヒムラー",
    [145]="ギガッシュ",
    [146]="ジオル",
    [147]="ボーゼン",
    [148]="ホルスタット",
    [149]="スターロン",
    [150]="ハイマン",
    [151]="ゼムセル",
    [152]="オーダイン",
    [153]="カミュ",
    [154]="ミシェイル",
    [155]="モーゼス",
    [156]="ガーネフ",
    [157]="メディウス",
    [158]="マリア",
    [159]="ドルーアへい",
    [160]="グラへい",
    [161]="ペラティへい",
    [162]="カシミアへい",
    [163]="くろきしだん",
    [164]="カダインマージ",
    [165]="ミネルバ",
    [166]="バジリスク",
    [167]="サラマンダー",
    [168]="ナーガ",
    [169]="ガイア",
    [170]="てつきしだん",
    [171]="りゅうきしだん",
    [172]="てき",
    [173]="ダロス",
    [174]="リカード",
    [175]="マケドニアへい",
    [176]="カチュア",
    [177]="パオラ",
    [178]="エスト",
    [179]="しろきしだん",
    [180]="グラへい",
    [181]="ならずもの",
    [182]="ウェンデル",
    [183]="ラーマンへい",
    [184]="テーベマージ",
    [185]="そうへいだん",
    [186]="チキ",
    [187]="グルニアおう",
    [188]="ぞうえんぶたい",
    [189]="カシム",
    [190]="セイバー",
    [191]="ジェイク",
    [192]="ロレンス",
    [193]="チェイニー",
    [194]="ガーネフ",
    [195]="ロジャー",
    [196]="マチス",
    [197]="アストリア",
}
local classes = { "ソシアルナイト", "アーマーナイト", "ペガサスナイト", "パラディン", "ドラゴンナイト", "ようへい", "せんし", "かいぞく", "とうぞく", "ゆうしゃ", "アーチャー", "ハンター", "シューター", "ホースメン", "スナイパー", "コマンド", "マムクート", "まどうし", "そうりょ", "しさい", "ロード", "しょうぐん" }

function profile.matches(system, hash)
    return system == "NES" and hashes[string.upper(hash or "")] == true
end

function profile.read(read, read_nametable)
    -- Screen tile access is NES/FE1-specific. The host supplies only generic read-only memory functions.
    if type(read_nametable)=="table" then
        local memory=read_nametable
        read_nametable=function()
            local domain,base="PPU Bus",0x2000
            for _,name in ipairs(memory.domains()) do if name=="CIRAM (nametables)" then domain=name; base=0 end end
            local raw=memory.read_bytes(base,0x800,domain)
            if not raw then return nil end
            local second,first={},{}
            for index=1,960 do second[index]=raw[0x400+index]; first[index]=raw[index] end
            return second,first
        end
    end
    -- Both nametables, read once per sample: NT1 holds windows and dialogue, NT0 the turn banner.
    local nt, nt0
    if read_nametable then
        local ok, second, first = pcall(read_nametable)
        if ok then nt, nt0 = second, first end
    end
    local chapter, turn = read(0x7674), read(0x7675)
    local max_y, max_x = read(0x7676), read(0x7677)
    if chapter < 1 or chapter > 25 or turn < 1 or max_x < 1 or max_x > 31 or max_y < 1 or max_y > 31 then
        return nil, "map_data_not_initialized"
    end
    local units = {}
    local rejected = 0
    local function inventory(addr)
        local items,complete={},true
        for slot=0,3 do
            local id=read(addr+0x13+slot)
            if id~=0 then
                local item={slot=slot,item_id=id,uses=read(addr+0x17+slot),metadata_verified=false}
                if id>=1 and id<=92 then
                    -- Inventory IDs are one-based; the fixed-bank item tables
                    -- and battle code index IDs minus one.
                    local index=id-1
                    local flags=read(0xd9c3+index)
                    local ranges={}
                    if math.floor(flags/2)%2==1 then ranges[#ranges+1]=1 end
                    if math.floor(flags/4)%2==1 then ranges[#ranges+1]=2 end
                    item.metadata_verified=true
                    item.is_attack_item=math.floor(flags/8)%2==1
                    item.ranges=#ranges>0 and ranges or nil
                    item.might=read(0xd657+index)
                    item.weight=read(0xd70f+index)
                    item.required_weapon_level_raw=read(0xd6b3+index)
                else complete=false end
                items[#items+1]=item
            end
        end
        return #items>0 and items or nil,complete
    end
    local function roster(base, count, side)
        for slot = 0, count - 1 do
            local addr = base + slot * 27
            local pid = read(addr)
            if pid == 0 then break end
            local flag = read(addr + 0x12)
            if flag ~= 0xff and flag ~= 0xf0 then
                local class_id, level = read(addr+1), read(addr+2)
                local hp, max_hp = read(addr+3), read(addr+4)
                local y, x = read(addr+0x10), read(addr+0x11)
                if class_id >= 1 and class_id <= 24 and level >= 1 and level <= 20 and max_hp > 0 and max_hp <= 99 and hp <= max_hp and x <= max_x and y <= max_y then
                    local items,complete=inventory(addr)
                    units[#units+1] = {
                        key=side .. ":" .. slot, side=side, slot=slot, character_id=pid,
                        name=side == "player" and names[pid] or side == "enemy" and enemy_names[pid] or nil,
                        class_id=class_id, class_name=classes[class_id], level=level,
                        hp=hp, max_hp=max_hp, exp=side=="player" and read(addr+5) or nil,
                        strength=read(addr+7), skill=read(addr+8), weapon_level=read(addr+9),
                        speed=read(addr+10), luck=read(addr+11), defense=read(addr+12),
                        movement=read(addr+13), resistance=read(addr+15), x=x, y=y,
                        inventory=items,inventory_complete=complete,
                        terrain_tile_raw=read(addr+6),deployment_flags_raw=flag,acted=(flag==1),
                        source_address=string.format("0x%04X",addr)
                    }
                else rejected = rejected + 1 end
            end
        end
    end
    roster(0x6a90,54,"player")
    roster(0x7078,20,"enemy")
    if #units == 0 then return nil, "no_valid_map_units" end
    return {
        profile_id=profile.id, source="ram", domain="System Bus", chapter=chapter, turn=turn,
        map={width=max_x+1,height=max_y+1}, coordinate_system="zero_based_map_tiles",
        state_scope="loaded_map_data_may_persist_in_dialogs_or_menus",
        phase=nil, selected_unit=nil, units=units, rejected_records=rejected,
        -- Raw scene hints found by recording one play session (dev/scene-probe.lua):
        -- $0026 was non-zero while a unit menu was open, and $0306 held a valid class ID (1-24)
        -- only during battle animations. Heuristics from a single session; not verified.
        -- Dialogue text decoded from the second nametable (nil when no speech window is showing).
        dialogue=(function()
            if not nt then return nil end
            local decoded_ok,decoded=pcall(text.dialogue,nt)
            return decoded_ok and decoded or nil
        end)(),
        -- Whose phase just started: the game flashes a small window reading PLAYER or COMPUTER (the enemy).
        phase_banner=(function()
            if not nt then return nil end
            local ok,phase=pcall(text.phase_banner,nt,nt0)
            return ok and phase or nil
        end)(),
        -- Fight data. The game computes a whole fight at once (index 0 = attacker, 1 = defender), so the
        -- result (HP after, experience, level-up stats) is readable as soon as the fight starts.
        -- Layout from StanHash/fe1 (cc65 variables.inc: wFight*); checked against recorded fights.
        battle=(function()
            -- Bit 3 of the item flags marks an attack item; staffs and other effect items are not. The fight data holds the
            -- item's table index itself (the game looks it up as ItemInfo.Unk_D9C3[id]; IID_HEAL = 53 is the heal staff),
            -- unlike inventories, which store index + 1. nil if the index is outside the 92-entry table.
            local function attack_item(id)
                if id<0 or id>91 then return nil end
                return math.floor(read(0xd9c3+id)/8)%2==1
            end
            local function who(i)
                return { item_id=read(0x320+i), is_attack_item=attack_item(read(0x320+i)), pid=read(0x304+i), jid=read(0x306+i), class_name=classes[read(0x306+i)],
                    name=names[read(0x304+i)] or enemy_names[read(0x304+i)], level=read(0x308+i), hp=read(0x30A+i), max_hp=read(0x30C+i),
                    hp_after=read(0x334+i), strength=read(0x312+i), skill=read(0x314+i), weapon_level=read(0x316+i),
                    speed=read(0x318+i), luck=read(0x31A+i), defense=read(0x31C+i),
                    -- Per-strike results rolled up front: first strike / follow-up strike (RollFightHits, crits triple damage).
                    damage=read(0x33C+i), hit_first=read(0x344+i)~=0, hit_second=read(0x346+i)~=0,
                    crit_first=read(0x34B+i)~=0, crit_second=read(0x34D+i)~=0 }
            end
            local attacker, defender = who(0), who(1)
            if attacker.jid<1 or attacker.jid>24 or defender.jid<1 or defender.jid>24 then return nil end
            if attacker.level<1 or defender.level<1 or attacker.max_hp<1 or defender.max_hp<1 then return nil end
            -- follow_up: 1 = attacker strikes twice, 2 = defender strikes twice, 0 = neither. The strike order
            -- ($0302) is recorded raw only; its meaning is not verified.
            return { attacker=attacker, defender=defender, exp=read(0x30E), exp_gained=read(0x30F),
                follow_up=read(0x348), order_flag_raw=read(0x302),
                after={ level=read(0x329), max_hp=read(0x32A), exp=read(0x32B), strength=read(0x32C), skill=read(0x32D),
                    weapon_level=read(0x32E), speed=read(0x32F), luck=read(0x330), defense=read(0x331) },
                status="ram_layout_from_disassembly" }
        end)(),
        -- Text of the unit information window, if open: which unit the player is looking at (matched in the app).
        unit_info=(function()
            if not nt then return nil end
            local info_ok,info=pcall(text.unit_info,nt)
            return info_ok and info or nil
        end)(),
        scene={menu_mode_raw=read(0x26),fight_class_raw=read(0x306),status="ram_heuristic_unverified"},
        equipment_status="carried_items_only_equipped_and_usability_unverified",
        terrain_status="raw_tile_only_terrain_effects_unverified",action_status="acted_flag_seen_once_in_recording"
    }
end

return profile
