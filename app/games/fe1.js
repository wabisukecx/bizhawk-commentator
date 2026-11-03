export function distance(a, b) { return Math.abs(a.x - b.x) + Math.abs(a.y - b.y); }

export { selectCandidate } from './fe1-analysis.js';
export { playByPlay } from './fe1-play.js';
import { playByPlay, analyzeBattle } from './fe1-play.js';
import { selectCandidate } from './fe1-analysis.js';
import { unitName } from './fe1-names.js';
import { localizeSnapshot } from './fe1-i18n.js';
import { t } from '../i18n.js';

export function fingerprint(state, key) {
  if (!state) return '';
  const anchor = state.units.find(unit => unit.key === key);
  const units = anchor ? state.units.filter(unit => unit.key === key || distance(anchor, unit) <= 6) : state.units;
  return JSON.stringify([state.chapter, state.turn, units.map(unit => [unit.key, unit.character_id, unit.hp, unit.x, unit.y, unit.inventory, unit.level, unit.exp])]);
}

export function compactState(state) {
  return { chapter: state.chapter, turn: state.turn, units: state.units.map(unit => ({
    key: unit.key, name: unitName(unit), side: unit.side, class_name: unit.class_name,
    hp: unit.hp, max_hp: unit.max_hp, x: unit.x, y: unit.y,
    level: unit.level, exp: unit.exp, strength: unit.strength, defense: unit.defense,
    movement: unit.movement, inventory: unit.inventory, inventory_complete: unit.inventory_complete,
  })) };
}

export const gameInstructions = `対象は初代ファイアーエムブレムです。
context.focusが今回の話題、context.factsが根拠です。位置やHPを読み上げるだけでなく、この変化で生まれた選択肢や局面の意味を一つだけ話してください。意味を裏付けられなければspeak=false。
字幕はくだけた日本語で1〜2文。数値の報告や「確認してから決めたい」といった定型の助言で文字数を埋めません。未検証事項は断定を避けるための内部制約であり、毎回の免責文にしません。
今回は淡々とした報告より、少し盛り上がる観戦コメントを求められています。「位置の報告→選択肢の説明」の型を崩し、見どころへの短い反応を先に出してください。合流には「おっ、ここでゴードンも来た！」、有利な消耗には「海賊のほうが大きく削れている！」、大きなHP減少には「ジェイガン、かなり削られた！」のように喜び・緊張の強弱を言葉にします。単なる小移動を大事件扱いせず、連続した歓声や感嘆符の連発も避けます。キャラクターの心情、架空の活躍、勝利は創作しません。
「交代も考えやすくなった」「誰に経験を回すかが考えどころ」で毎回締めません。already_saidを見て、言葉だけでなく着眼点も変えます。変化そのものが見どころなら、短い反応で終えてよいです。新しい意味がなければ黙ります。
話し方の例（根拠が一致する場合だけ）: 合流「おっ、ゴードンも追いついた！ アベルのそばに弓役が加わったね。」 消耗の釣り合い「海賊のほうが大きく削れている！ こちらの消耗を小さく抑えた、いい流れだね。」 低HP「ジェイガン、かなり削られたね。ここは残りの体力が気になるところ。」 毎回この文型に寄せず、実際の根拠を優先してください。
味方にnameがあればリフ、オグマなどの個人名で呼び、「そうりょ」「ようへい」だけで済ませません。名前はgame.unitsとcontext.factsから取り、未取得の名前は推測しません。
合流で動いた人物はcontext.facts.arrivingです。joinedは合流相手であり、主語を入れ替えて「相手が来た」と言ってはいけません。誰が移動したかを区別できない文にするなら「マルスとリフが並んだ」のように配置だけを述べます。
合流は兵種・所持品に合う関係だけを話します。弓役や僧侶の合流を一律に前衛交代と言わず、杖の所持と使用可能を混同しません。命令口調で攻略を押し付けません。
不明な装備を話題にした「杖を持っているか分からないけど」のような但し書きは禁止です。その材料がなければ別の観測事実を話し、話が成立しなければ黙ってください。「そうりょが隣だから心強い」だけでは回復や安全を裏付けません。
複数の差分は同じ戦闘の因果を証明しません。攻撃者・命中回数・反撃・行動順序を推測で確定しないでください。「もう一度当てられた」などは禁止です。
「気になる」「敵が近い」だけで終えないでください。前の発言と同じ意味なら黙ってください。毎回心配する役にはなりません。心情を想像しません。
距離は地形を無視したマンハッタン距離。敵の移動経路、行動済み、装備中か、武器の使用可否、地形効果は未検証です。所持武器のrangesは武器自体の射程で、現在攻撃できることは保証しません。
「安全」「敵がいない」「あと一撃」「反撃されない」「倒せる」と断言しません。命中率・与ダメージ計算は未実装です。
RAMのマップ情報はメニュー中にも残ります。見えなくなったユニットを死亡・撃破と断定しません。`;

// Conservative backstop; this is not a complete verifier of free-form text.
export function reviewComment(text) {
  // English claims the commentary must not make (certainty about safety, kills and hit counts).
  if (/\b(?:totally|completely|perfectly) safe\b|\bno enemies (?:left|nearby|around)\b|\bone more hit\b|\bcan(?:not|'t) be countered\b|\b(?:will|is going to) (?:definitely|surely) (?:kill|win)\b|\bhit (?:him|her|them|it) again\b/i.test(text)) return false;
  return !/(もう一度|再び).{0,8}(当てられ|被弾|攻撃された)|安全|敵[はがも]いない|あと[一1１]撃|反撃され(?:ない|ず)|確実に倒せ|必ず倒せ|心細/.test(text);
}

// The battle is effectively decided in our favour: few enemies remain from a real crowd,
// the party is healthy, and the lord is not in danger. Used only to tone commentary down.
// 'battle' | 'menu' | 'map', from RAM hints seen in one recorded session (unverified heuristics).
export function scene(state) {
  const hints = state?.scene;
  if (!hints) return 'map';
  if (hints.fight_class_raw >= 1 && hints.fight_class_raw <= 24) return 'battle';
  return hints.menu_mode_raw ? 'menu' : 'map';
}

// Dialogue pages decoded by the Lua profile; the speaker is not identified, so it is described generically.
export function dialogue(state) {
  return typeof state?.dialogue?.text === 'string' && state.dialogue.text ? { text: state.dialogue.text } : null;
}

const compass = (dx, dy) => [dy ? `${dy < 0 ? '北' : '南'}に${Math.abs(dy)}マス` : '', dx ? `${dx > 0 ? '東' : '西'}に${Math.abs(dx)}マス` : ''].filter(Boolean).join('、') || '同じ位置';

// Units on the map whose name appears in the conversation. Player names are verified; an enemy's
// name is only a candidate from its character ID. Distance is Manhattan and ignores terrain.
export function mentionedUnits(pages, state) {
  const text = pages.join('');
  const units = state?.units?.filter(unit => unit.hp > 0) ?? [];
  const found = [];
  for (const unit of units) {
    const name = unit.name ?? unit.candidate_name;
    // Dialogue is always Japanese, so match the Japanese name even when names are shown in English.
    const japanese = unit.name_ja ?? unit.candidate_name_ja ?? name;
    if (!name || !text.includes(japanese) || found.some(item => item.name === name)) continue;
    const others = units.filter(other => other.key !== unit.key);
    const nearest = side => others.filter(other => other.side === side)
      .map(other => ({ name: other.name ?? other.class_name, distance: distance(unit, other), direction: compass(other.x - unit.x, other.y - unit.y) }))
      .sort((a, b) => a.distance - b.distance).slice(0, 3);
    found.push({ name, side: unit.side, name_status: unit.name ? 'verified' : 'candidate_from_character_id', class_name: unit.class_name,
      hp: unit.hp, max_hp: unit.max_hp, position: { x: unit.x, y: unit.y },
      nearest_allies: nearest('player'), nearest_enemies: nearest('enemy') });
  }
  return found;
}

// The speech window scrolls line by line, so consecutive pages overlap. Join them into one sequence of lines;
// a line that is only the beginning of another (still being typed) counts as the same line.
export function mergePages(pages) {
  const same = (a, b) => a.startsWith(b) || b.startsWith(a);
  const merged = [];
  for (const page of pages) {
    const lines = page.split(String.fromCharCode(10)).filter(Boolean);
    let overlap = 0;
    for (let k = Math.min(merged.length, lines.length); k > 0; k--) {
      if (merged.slice(-k).every((line, i) => same(line, lines[i]))) { overlap = k; break; }
    }
    for (let i = 0; i < overlap; i++) {
      const at = merged.length - overlap + i;
      if (lines[i].length > merged[at].length) merged[at] = lines[i];
    }
    merged.push(...lines.slice(overlap));
  }
  return merged;
}

export function dialogueContext(pages, state) {
  const lines = mergePages(pages);
  const mentioned = mentionedUnits(lines, state);
  return {
    topic: 'village_dialogue',
    focus: '村などでの会話。台詞から分かった事実やヒントを、一緒に見ている相手に一言で伝える。話者は特定できないので「村の人」などと呼び、台詞をそのまま読み上げない。'
      + (mentioned.length ? 'mentioned_unitsは台詞に名前が出た人物の現在位置。会話の内容に結びつけて、近くにいる味方との位置関係を一言添えてよい。' : '位置が分かる人物は出ていないので、位置には触れない。'),
    facts: { speaker: '不明（村人など）', lines, ...(mentioned.length ? { mentioned_units: mentioned } : {}) },
    limitations: '文字は画面のタイルから復元したもの。漢字や一部の記号は読めず、?が混ざることがある。距離は地形を無視した直線的なマス数で、行き来できるかは不明。名前の一致はIDによる推定で、direction は「その人物から見た相手の向き」。',
  };
}

// Which unit the player is looking at: the information window shows level and HP, which are matched against
// the roster (names too when several units share them). Null when nothing matches exactly one unit.
export function selectedUnit(state) {
  const info = state?.unit_info;
  if (!info) return null;
  const same = state.units.filter(unit => unit.hp === info.hp && unit.max_hp === info.max_hp && unit.level === info.level);
  const named = same.filter(unit => [unit.name_ja ?? unit.name, unit.class_name_ja ?? unit.class_name].includes(info.name));
  const unit = same.length === 1 ? same[0] : named.length === 1 ? named[0] : null;
  return unit ? { key: unit.key, name: unit.name ?? unit.class_name, side: unit.side, class_name: unit.class_name, level: unit.level, hp: unit.hp, max_hp: unit.max_hp, status: 'matched_info_window' } : null;
}

// A new party member: worth a spoken reaction on top of the fixed line.
export function recruitHighlight(event, state) {
  const name = event.name ?? event.class_name ?? 'unit';
  const unit = state?.units?.find(u => u.key === event.unit_key);
  return { key: `join:${event.character_id}`, context: {
    topic: 'recruit',
    focus: `${name}が新しく仲間に加わった場面。仲間が増えた喜びを実況者として一言だけ話す。誰が何をしたか（会話や条件）は不明なので、加入の理由は推測しない。`,
    facts: { name, class_name: unit?.class_name ?? event.class_name, level: event.level, hp: event.hp, max_hp: event.max_hp },
    limitations: '加入の事実だけが根拠。感情はキャラクターではなく実況者自身のもの。',
  } };
}

// The fight data always lists our unit first (index 0), whoever started the fight. A fight between one of ours and
// an enemy that the enemy started is turned around so that the attacker comes first (and who strikes twice follows
// the fighter). A staff user (both fighters ours) is index 0 by design and never swapped. Whether the enemy started
// it comes from $0302, or from the phase for logs that lack it; unknown means "ours".
export function orientBattle(entry, state, phase) {
  // $0302 (order_flag_raw) is 1 exactly when the enemy started the fight: it matched the PLAYER/COMPUTER banner
  // on all 8 fights shown during an enemy phase and was 0 on every fight of ours (31 recorded). Older logs
  // without the value fall back to the phase.
  const enemyStarted = typeof entry.order_flag_raw === 'number' ? entry.order_flag_raw !== 0 : phase === 'enemy';
  if (!enemyStarted) return entry;
  const ours = who => state.units.some(unit => unit.side === 'player' && unit.character_id === who.pid);
  if (!(ours(entry.attacker) && !ours(entry.defender))) return entry;
  const followUp = entry.follow_up === 1 ? 2 : entry.follow_up === 2 ? 1 : 0;
  return { ...entry, attacker: entry.defender, defender: entry.attacker, follow_up: followUp, initiated_by: 'enemy' };
}

// A fight worth a spoken reaction on top of the fixed narration: someone was defeated, or a critical hit landed.
export function battleHighlight(entry, state) {
  const result = analyzeBattle(entry);
  if (result.staff) return null;
  const critBy = result.attacker.crit ? entry.attacker : result.defender.crit ? entry.defender : null;
  if (!result.defeated && !critBy) return null;
  const name = who => who.name ?? who.class_name ?? '敵';
  const ours = who => state.units.some(unit => unit.side === 'player' && unit.character_id === who.pid);
  const down = result.defeated === 'defender' ? entry.defender : result.defeated === 'attacker' ? entry.attacker : null;
  return { key: `highlight:${entry.id}`, context: {
    topic: 'battle_highlight',
    focus: (down ? `${name(down)}が倒れた` : '') + (down && critBy ? '。' : '') + (critBy ? `${name(critBy)}の必殺の一撃が決まった` : '')
      + '場面。結果の数字はすでに実況が伝えているので繰り返さず、この瞬間への実況者の反応を一言だけ話す。',
    facts: { attacker: name(entry.attacker), defender: name(entry.defender),
      ...(down ? { defeated: name(down), defeated_is_ours: ours(down) } : {}),
      ...(critBy ? { critical_by: name(critBy), critical_by_is_ours: ours(critBy) } : {}),
      hp_before: { attacker: entry.attacker.hp, defender: entry.defender.hp }, hp_after: { attacker: entry.attacker.hp_after, defender: entry.defender.hp_after } },
    limitations: '攻撃の順序は不明。HPと必殺の有無だけが根拠。感情はキャラクターではなく実況者自身のもの。',
  } };
}

export function isSettled(state, { peakEnemies = 0 } = {}) {
  if (!state || peakEnemies < 4) return false;
  const alive = state.units.filter(unit => unit.hp > 0);
  const enemies = alive.filter(unit => unit.side === 'enemy').length;
  const players = alive.filter(unit => unit.side === 'player' && unit.max_hp);
  if (!players.length || enemies > Math.ceil(peakEnemies * .25)) return false;
  const ratios = players.map(unit => unit.hp / unit.max_hp);
  const lord = players.find(unit => unit.character_id === 1);
  return ratios.reduce((a, b) => a + b, 0) / ratios.length >= .5 && !(lord && lord.hp / lord.max_hp < .35);
}

export const fe1 = Object.freeze({
  id: 'fe1-jp-v1',
  title: 'ファイアーエムブレム 暗黒竜と光の剣',
  stateSchema: 'tactical-map-v1',
  accepts: state => Array.isArray(state.units) && state.units.every(unit =>
    typeof unit.key === 'string' && ['player', 'enemy'].includes(unit.side) &&
    [unit.x, unit.y, unit.hp].every(Number.isFinite)),
  selectCandidate,
  playByPlay,
  isSettled,
  orientBattle,
  selectedUnit,
  recruitHighlight,
  battleHighlight,
  dialogue,
  dialogueContext,
  scene,
  enemyCount: state => state.units.filter(unit => unit.side === 'enemy' && unit.hp > 0).length,
  fingerprint: state => fingerprint(state),
  summarize: state => ({ title: 'ファイアーエムブレム 暗黒竜と光の剣', ...compactState(state) }),
  titleEn: 'Fire Emblem: Shadow Dragon and the Blade of Light',
  describe: (state, language = 'ja') => t('chapterTurn', { chapter: state.chapter, turn: state.turn }, language),
  localize: localizeSnapshot,
  baselineEvents: observed => observed.reset_reason === 'chapter_changed'
    ? observed.events.filter(event => event.type === 'chapter_changed') : [],
  instructions: gameInstructions,
  reviewComment,
});

