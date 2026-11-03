import { playerNames, enemyNames, battleName } from './fe1-names.js';

// English names for the Japanese Famicom game. Only names that are well established in the official English
// releases are listed; every other character falls back to a Hepburn romanization of the Japanese name.
// OFFICIAL is keyed by the game's character ID (the same IDs as the name table in lua/profiles/fe1.lua).
export const OFFICIAL = Object.freeze({
  1: 'Marth', 2: 'Caeda', 3: 'Jagen', 4: 'Cain', 5: 'Abel', 6: 'Draug', 7: 'Gordin', 12: 'Barst', 14: 'Ogma',
  16: 'Julian', 17: 'Lena', 18: 'Merric', 19: 'Navarre', 20: 'Hardin', 29: 'Catria', 30: 'Maria',
  31: 'Minerva', 32: 'Linde', 43: 'Est', 48: 'Palla', 49: 'Tiki',
});

export const CLASSES = Object.freeze({
  'ソシアルナイト': 'Cavalier', 'アーマーナイト': 'Armor Knight', 'ペガサスナイト': 'Pegasus Knight', 'パラディン': 'Paladin',
  'ドラゴンナイト': 'Dracoknight', 'ようへい': 'Mercenary', 'せんし': 'Fighter', 'かいぞく': 'Pirate', 'とうぞく': 'Thief',
  'ゆうしゃ': 'Hero', 'アーチャー': 'Archer', 'ハンター': 'Hunter', 'シューター': 'Shooter', 'ホースメン': 'Horseman',
  'スナイパー': 'Sniper', 'コマンド': 'Commando', 'マムクート': 'Manakete', 'まどうし': 'Mage', 'そうりょ': 'Priest',
  'しさい': 'Bishop', 'ロード': 'Lord', 'しょうぐん': 'General',
});

const KANA = {
  ア: 'a', イ: 'i', ウ: 'u', エ: 'e', オ: 'o', カ: 'ka', キ: 'ki', ク: 'ku', ケ: 'ke', コ: 'ko', サ: 'sa', シ: 'shi', ス: 'su', セ: 'se', ソ: 'so',
  タ: 'ta', チ: 'chi', ツ: 'tsu', テ: 'te', ト: 'to', ナ: 'na', ニ: 'ni', ヌ: 'nu', ネ: 'ne', ノ: 'no', ハ: 'ha', ヒ: 'hi', フ: 'fu', ヘ: 'he', ホ: 'ho',
  マ: 'ma', ミ: 'mi', ム: 'mu', メ: 'me', モ: 'mo', ヤ: 'ya', ユ: 'yu', ヨ: 'yo', ラ: 'ra', リ: 'ri', ル: 'ru', レ: 're', ロ: 'ro', ワ: 'wa', ヲ: 'o', ン: 'n',
  ガ: 'ga', ギ: 'gi', グ: 'gu', ゲ: 'ge', ゴ: 'go', ザ: 'za', ジ: 'ji', ズ: 'zu', ゼ: 'ze', ゾ: 'zo', ダ: 'da', ヂ: 'ji', ヅ: 'zu', デ: 'de', ド: 'do',
  バ: 'ba', ビ: 'bi', ブ: 'bu', ベ: 'be', ボ: 'bo', パ: 'pa', ピ: 'pi', プ: 'pu', ペ: 'pe', ポ: 'po', ヴ: 'vu',
};
const SMALL_Y = { ャ: 'a', ュ: 'u', ョ: 'o' };
const SMALL_VOWEL = { ァ: 'a', ィ: 'i', ゥ: 'u', ェ: 'e', ォ: 'o' };

// Hepburn romanization of katakana (long-vowel marks are dropped, a small tsu doubles the next consonant).
export function romanize(kana) {
  // Hiragana names (くろきしだん) are read as their katakana equivalents.
  const chars = [...kana].map(ch => (ch >= 'ぁ' && ch <= 'ゖ' ? String.fromCharCode(ch.charCodeAt(0) + 0x60) : ch));
  let out = '', double = false;
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (ch === 'ッ') { double = true; continue; }
    if (ch === 'ー') continue;
    let part = KANA[ch];
    if (part === undefined) { out += ch; continue; }
    const next = chars[i + 1];
    if (SMALL_Y[next] && part.endsWith('i')) {
      const stem = part === 'shi' ? 'sh' : part === 'chi' ? 'ch' : part === 'ji' ? 'j' : part.slice(0, -1) + 'y';
      part = stem + SMALL_Y[next]; i++;
    } else if (SMALL_VOWEL[next] && part === 'u') {
      part = 'w' + SMALL_VOWEL[next]; i++; // ウィ wi, ウェ we, ウォ wo
    } else if (SMALL_VOWEL[next] && part.length > 1) {
      part = part.slice(0, -1) + SMALL_VOWEL[next]; i++;
    }
    if (double) { out += part[0] === 'c' ? 't' : part[0]; double = false; }
    out += part;
  }
  return out.charAt(0).toUpperCase() + out.slice(1);
}

// Enemy-side names (the game's second name table, IDs 129-197): characters that are also in our army share the
// English name; a few bosses are well known; "…へい" is a soldier of that country ("Garuda soldier").
const OFFICIAL_ENEMY = { 'ガザック': 'Gazzak', 'ゴメス': 'Gomez', 'ミシェイル': 'Michalis', 'ガーネフ': 'Gharnef', 'メディウス': 'Medeus' };
const OFFICIAL_BY_JAPANESE = Object.freeze({
  ...Object.fromEntries(Object.entries(OFFICIAL).map(([pid, english]) => [playerNames[pid], english])),
  ...OFFICIAL_ENEMY,
});

function fallbackName(japanese) {
  if (japanese.length > 2 && japanese.endsWith('へい')) return `${romanize(japanese.slice(0, -2))} soldier`;
  return romanize(japanese);
}

export const englishName = (pid, japanese) => OFFICIAL[pid] ?? (japanese ? OFFICIAL_BY_JAPANESE[japanese] ?? fallbackName(japanese) : undefined);
export const englishClass = japanese => CLASSES[japanese] ?? japanese;

// A copy of a bridge snapshot with names and classes in English. The Japanese name is kept in
// name_ja / candidate_name_ja so dialogue text (always Japanese) can still be matched against it.
export function localizeSnapshot(snapshot) {
  const copy = structuredClone(snapshot);
  const byKey = new Map();
  const unit = u => {
    u.localized = true;
    const japanese = u.name ?? (u.side === 'player' ? playerNames[u.character_id] : enemyNames[u.character_id]);
    if (japanese) { u.name_ja = japanese; u.name = englishName(u.character_id, japanese); }
    if (u.candidate_name) { u.candidate_name_ja = u.candidate_name; u.candidate_name = englishName(u.character_id, u.candidate_name); }
    if (u.class_name) { u.class_name_ja = u.class_name; u.class_name = englishClass(u.class_name); }
    byKey.set(u.key, u.name ?? u.candidate_name);
  };
  const who = w => {
    const japanese = w.name_ja ?? battleName(w);
    if (japanese) { w.name_ja = japanese; w.name = englishName(w.pid, japanese); }
    w.localized = true;
    if (w.class_name) { w.class_name_ja = w.class_name; w.class_name = englishClass(w.class_name); }
  };
  copy.game_state?.units?.forEach(unit);
  if (copy.game_state?.battle) { who(copy.game_state.battle.attacker); who(copy.game_state.battle.defender); }
  for (const entry of copy.battle_log ?? []) { who(entry.attacker); who(entry.defender); }
  for (const event of copy.recent_observations?.events ?? []) {
    if (event.unit_key && byKey.has(event.unit_key)) event.name = byKey.get(event.unit_key);
  }
  return copy;
}
