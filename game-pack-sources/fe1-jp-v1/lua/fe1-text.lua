-- Reads text windows from the second nametable. Tile IDs are indices into the game's
-- font (CHR bank 0): kana, digits, Latin. A dakuten/handakuten tile (0x0F / 0x1F) is drawn
-- one row above the character it modifies. Found by comparing recorded nametables with the
-- font tiles of the supported ROM; only confidently identified glyphs are mapped.
local module = {}

local glyph = {}
local function put(base, chars)
    local i = 0
    for _, code in utf8.codes(chars) do glyph[base + i] = utf8.char(code); i = i + 1 end
end
put(0x00, "あいうえおかきくけこさしすせそ")
put(0x10, "たちつてとなにぬねのはひふへほ")
put(0x20, "まみむめもやゆよらりるれろわをん")
put(0x30, "アイウエオカキクケコサシスセソ")
put(0x40, "タチツテトナニヌネノハヒフヘホ")
put(0x50, "マミムメモヤユヨラリルレロワヲン")
put(0x60, "0123456789ABCDEF")
put(0x70, "GHIJKLMNOPQRSTUV")
put(0x80, "WXYZゃっゅょャッュョ")
put(0x96, "ぁぃぅぇぉ")
put(0xA6, "ァィゥェォ")
glyph[0x3F] = "ー"; glyph[0x8D] = ":"; glyph[0x8E] = "、"; glyph[0x8F] = "。"; glyph[0xAD] = "/"; glyph[0xAE] = "%"
glyph[0x9C] = "？"; glyph[0x9D] = "！"; glyph[0xAB] = "「"; glyph[0xAC] = "」"; glyph[0xFF] = " "

local function pairs_map(from, to)
    local map, keys = {}, {}
    for _, code in utf8.codes(from) do keys[#keys + 1] = utf8.char(code) end
    local i = 1
    for _, code in utf8.codes(to) do map[keys[i]] = utf8.char(code); i = i + 1 end
    return map
end
local dakuten = pairs_map("かきくけこさしすせそたちつてとはひふへほカキクケコサシスセソタチツテトハヒフヘホ",
                          "がぎぐげござじずぜぞだぢづでどばびぶべぼガギグゲゴザジズゼゾダヂヅデドバビブベボ")
local handakuten = pairs_map("はひふへほハヒフヘホ", "ぱぴぷぺぽパピプペポ")

local FRAME_TL, FRAME_T, FRAME_TR, FRAME_L, FRAME_BL = 0xF5, 0xF7, 0xF6, 0xFD, 0xF9
local SPEAKER_MARK = 0x9E -- precedes the opening quote of each spoken block; the game shows no speaker name here

-- nt: 960 tile IDs (1-based), 32 columns x 30 rows. Returns every framed window with its decoded lines:
-- { row, col, lines = {...}, text, speech = boolean, known, unknown }.
function module.windows(nt)
    local function at(row, col) return nt[row * 32 + col + 1] end
    local found = {}
    for row = 0, 27 do
        for col = 0, 29 do
            if at(row, col) == FRAME_TL and at(row, col + 1) == FRAME_T then
                local right = col + 1
                while right < 31 and at(row, right) == FRAME_T do right = right + 1 end
                local bottom = row + 1
                while bottom < 30 and at(bottom, col) == FRAME_L do bottom = bottom + 1 end
                if at(row, right) == FRAME_TR and at(bottom, col) == FRAME_BL then
                    local lines, speech, known, unknown = {}, false, 0, 0
                    for y = row + 1, bottom - 1 do
                        local text = ""
                        for x = col + 1, right - 1 do
                            local tile = at(y, x)
                            if tile == SPEAKER_MARK then
                                speech = true
                            elseif tile ~= 0x0F and tile ~= 0x1F then
                                local ch = glyph[tile]
                                if ch then
                                    if ch ~= " " then known = known + 1 end
                                    local above = y - 1 > row and at(y - 1, x) or nil
                                    if above == 0x0F then ch = dakuten[ch] or ch
                                    elseif above == 0x1F then ch = handakuten[ch] or ch end
                                    text = text .. ch
                                else
                                    unknown = unknown + 1
                                    text = text .. "?"
                                end
                            else
                                text = text .. " "
                            end
                        end
                        text = text:gsub("^%s+", ""):gsub("%s+$", "")
                        if text ~= "" then lines[#lines + 1] = text end
                    end
                    if #lines > 0 then
                        found[#found + 1] = { row = row, col = col, lines = lines, text = table.concat(lines, "\n"),
                            speech = speech, known = known, unknown = unknown }
                    end
                end
            end
        end
    end
    return found
end

-- The unit information window ("name / class / レベル: N / HP:a/b"), if one is showing. It is the only on-screen
-- sign of which unit the player is looking at; the caller matches it against the roster.
function module.unit_info(nt)
    for _, window in ipairs(module.windows(nt)) do
        local lines = window.lines
        if not window.speech and #lines >= 4 and window.unknown == 0 then
            local level = lines[3]:match("^レベル:%s*(%d+)$")
            local hp, max_hp = lines[4]:match("^HP:%s*(%d+)/(%d+)$")
            if level and hp and max_hp then
                return { name = lines[1], class_text = lines[2], level = tonumber(level), hp = tonumber(hp), max_hp = tonumber(max_hp) }
            end
        end
    end
    return nil
end

-- "PLAYER" or "COMPUTER" alone in a framed window marks the start of that side's phase; returns "player",
-- "enemy" or nil. The window shows up in either nametable, so both are checked.
local banners = { PLAYER = "player", COMPUTER = "enemy" }
function module.phase_banner(...)
    for _, nt in ipairs({ ... }) do
        for _, window in ipairs(module.windows(nt)) do
            if #window.lines == 1 and not window.speech and banners[window.lines[1]] then
                return banners[window.lines[1]]
            end
        end
    end
    return nil
end

-- The speech window, if one is showing: { lines, text, status } or nil.
-- A real page has the speech marker and mostly decodable glyphs; mid-redraw frames do not.
function module.dialogue(nt)
    for _, window in ipairs(module.windows(nt)) do
        if window.speech and window.unknown * 3 <= window.known then
            return { lines = window.lines, text = window.text, status = "ram_heuristic_unverified" }
        end
    end
    return nil
end

return module
