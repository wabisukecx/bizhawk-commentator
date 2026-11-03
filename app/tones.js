import { t } from './i18n.js';
import { english } from './tones-en.js';
// A tone is data: LLM style instructions, fixed play-by-play wording, and speech hints.
// Play-by-play wording is written here, never generated, so a tone cannot change the facts.
export const tones = Object.freeze({
  announcer: {
    label: 'アナウンサー', summary: '落ち着いた丁寧語。幅広い年齢向け',
    rate: 1.0, pitch: 1.0, maxChars: 45,
    style: 'スポーツ中継のアナウンサーのように、落ち着いた丁寧語で話してください。すべての文を「です」「ます」「ました」などで終え、「〜いるね」「〜だ」「〜よ」のような口語で終えないでください。',
    phrases: {
      approach: ['{name}、敵に近づきます。', '{name}が前に出ました。'],
      beside: ['{name}、{ally}のそばに入りました。', '{name}が{ally}と合流です。'],
      allyHurt: ['{name}、{lost}のダメージ。残りHP{hp}です。', '{name}にダメージです。残りHP{hp}。'],
      critical: ['{name}、残りHP{hp}。これは厳しい状況です。', '{name}のHPが{hp}まで減りました。注意が必要です。'],
      enemyHurt: ['{name}にダメージ。{lost}減りました。', '{name}のHPが{lost}減少しました。'],
      turn: ['ターン{turn}に入ります。', 'ターン{turn}です。'],
      chapter: ['第{chapter}章、開始です。', '第{chapter}章が始まりました。'],
      critHit: ['{attacker}の必殺の一撃です。'],
      doubleHit: ['{attacker}の連続攻撃が、二度とも当たりました。'],
      heal: ['{name}のHPが{from}から{to}に回復しました。'],
      joined: ['{name}が仲間に加わりました。', '{name}が新たに仲間になりました。'],
      staffHeal: ['{user}が{target}を回復。HPは{hp}から{hp2}になりました。'],
      staffUse: ['{user}が{target}に杖を使いました。'],
      battleHit: ['{attacker}が{defender}を攻撃。{defender}のHPは{dhp}から{dhp2}になりました。', '{attacker}の攻撃が{defender}に当たりました。HPは{dhp}から{dhp2}です。'],
      battleKill: ['{attacker}が{defender}を撃破しました。'],
      battleMiss: ['{attacker}が{defender}を攻撃しましたが、ダメージはありませんでした。'],
      battleCounter: ['反撃で、{attacker}のHPは{ahp}から{ahp2}になりました。'],
      battleDown: ['{attacker}は反撃を受けて倒れました。'],
      levelUp: ['{name}がレベル{lv}に上がりました。{growth}'],
      levelUpNone: ['{name}がレベル{lv}に上がりましたが、能力の上昇はありませんでした。'],
      enemyApproach: ['{name}が{target}に近づいています。'],
      nearEnemies: ['周囲に敵が{count}体います。', '近くに敵が{count}体。'],
      hpStatus: ['{target}は残りHP{hp}です。'],
      enemyLeft: ['{name}は残りHP{hp}です。'],
      partyStatus: ['味方{allies}人、敵{enemies}体。最も消耗しているのは{worst}、HP{hp}です。'],
      partyAllFull: ['味方{allies}人、敵{enemies}体。全員、HPは満タンです。'],
    },
  },
  passion: {
    label: '熱血実況', summary: '勢いのある口調。若い層向け',
    rate: 1.12, pitch: 1.1, maxChars: 40,
    style: '熱量のあるスポーツ実況のように、くだけた口語で短く話してください。感嘆符を使ってかまいません。',
    phrases: {
      approach: ['{name}、突っ込んでいくぞ！', '{name}が前に出た！'],
      beside: ['{name}、{ally}と合流だ！', '{name}が{ally}のそばへ！'],
      allyHurt: ['{name}、{lost}ダメージ！残りHP{hp}！', '{name}が食らった！残り{hp}！'],
      critical: ['{name}、残りHP{hp}！これはまずい！', '{name}、ピンチだ！HPは{hp}！'],
      enemyHurt: ['{name}に入った！{lost}削れた！', '{name}、{lost}ダメージだ！'],
      turn: ['ターン{turn}、いくぞ！', 'さあターン{turn}だ！'],
      chapter: ['第{chapter}章、スタートだ！', 'いよいよ第{chapter}章！'],
      critHit: ['{attacker}の必殺の一撃だ！'],
      doubleHit: ['{attacker}、連続攻撃が二発とも入った！'],
      heal: ['{name}が回復した！HPは{from}から{to}！'],
      joined: ['{name}が仲間になった！', '新しい仲間、{name}が加わった！'],
      staffHeal: ['{user}が{target}を回復！HPは{hp}から{hp2}！'],
      staffUse: ['{user}が{target}に杖を使った！'],
      battleHit: ['{attacker}の一撃が{defender}に入った！HPは{dhp}から{dhp2}！', '{attacker}が{defender}を攻撃！{dhp}から{dhp2}に削った！'],
      battleKill: ['{attacker}が{defender}を倒した！'],
      battleMiss: ['{attacker}の攻撃、{defender}にダメージなし！'],
      battleCounter: ['反撃を食らった！{attacker}のHPは{ahp}から{ahp2}！'],
      battleDown: ['{attacker}、反撃で倒れた！'],
      levelUp: ['{name}がレベル{lv}にアップ！{growth}'],
      levelUpNone: ['{name}がレベル{lv}に上がった！でも能力は変わらず！'],
      enemyApproach: ['{name}が{target}に迫ってくる！'],
      nearEnemies: ['敵が{count}体、すぐ近くだ！'],
      hpStatus: ['{target}、残りHP{hp}だ！'],
      enemyLeft: ['{name}、残りHP{hp}！'],
      partyStatus: ['味方{allies}人に敵{enemies}体！一番キツいのは{worst}、HP{hp}！'],
      partyAllFull: ['味方{allies}人に敵{enemies}体！全員、元気いっぱいだ！'],
    },
  },
  calm: {
    label: 'ゆったり解説', summary: 'ゆっくり平易で穏やか。年配の方にも',
    rate: 0.88, pitch: 1.0, maxChars: 45,
    style: 'ゆっくり穏やかな丁寧語で話してください。すべての文を「です」「ます」「ですね」などで終え、口語で終えないでください。専門用語や横文字を避け、平易で短い文にしてください。',
    phrases: {
      approach: ['{name}が、敵に近づきますね。', '{name}が、前に出ましたね。'],
      beside: ['{name}が、{ally}のそばに来ましたね。', '{name}と{ally}が、近くになりました。'],
      allyHurt: ['{name}が、{lost}ダメージを受けました。残りは{hp}ですね。', '{name}に、ダメージがありました。残りHPは{hp}です。'],
      critical: ['{name}の、HPが{hp}になりました。少し危ない状態ですね。', '{name}は、残りHP{hp}です。かなり減りましたね。'],
      enemyHurt: ['{name}に、ダメージがありました。{lost}減りましたね。', '{name}の、HPが減りました。'],
      turn: ['ターン{turn}になりました。', '{turn}ターン目に入りますね。'],
      chapter: ['第{chapter}章が、始まりますよ。', '第{chapter}章の、はじまりです。'],
      critHit: ['{attacker}の、必殺の一撃でした。'],
      doubleHit: ['{attacker}の、連続攻撃が二回とも当たりましたね。'],
      heal: ['{name}のHPが、{from}から{to}に回復しましたね。'],
      joined: ['{name}が、仲間に加わりましたね。'],
      staffHeal: ['{user}が、{target}を回復しました。HPが{hp}から{hp2}になりましたね。'],
      staffUse: ['{user}が、{target}に杖を使いました。'],
      battleHit: ['{attacker}が、{defender}を攻撃しました。HPが{dhp}から{dhp2}になりましたね。'],
      battleKill: ['{attacker}が、{defender}を倒しましたね。'],
      battleMiss: ['{attacker}が攻撃しましたが、{defender}にダメージはありませんでした。'],
      battleCounter: ['反撃で、{attacker}のHPが{ahp}から{ahp2}になりました。'],
      battleDown: ['{attacker}は、反撃で倒れてしまいました。'],
      levelUp: ['{name}が、レベル{lv}に上がりましたよ。{growth}'],
      levelUpNone: ['{name}が、レベル{lv}に上がりました。能力は変わりませんでしたね。'],
      enemyApproach: ['{name}が、{target}に近づいていますね。'],
      nearEnemies: ['近くに、敵が{count}体いますよ。'],
      hpStatus: ['{target}の、残りHPは{hp}です。'],
      enemyLeft: ['{name}の、残りHPは{hp}ですね。'],
      partyStatus: ['味方は{allies}人、敵は{enemies}体です。一番傷んでいるのは、{worst}で、HPは{hp}ですね。'],
      partyAllFull: ['味方は{allies}人、敵は{enemies}体です。みなさん、HPは満タンですよ。'],
    },
  },
  companion: {
    label: '相棒', summary: 'くだけた会話口調',
    rate: 1.0, pitch: 1.0, maxChars: 50,
    style: '一緒に画面を見ている相棒として、くだけた会話の口調で話してください。',
    phrases: {
      approach: ['{name}、敵に近づいたね。', '{name}が前に出たね。'],
      beside: ['{name}、{ally}に追いついたね。', '{name}が{ally}のそばに来たね。'],
      allyHurt: ['{name}、{lost}減ったね。残り{hp}。', '{name}がダメージを受けたね。残りHP{hp}。'],
      critical: ['{name}、HP{hp}まで減ったよ。ちょっと危ないね。', '{name}の残りHPが{hp}だよ。かなり減ったね。'],
      enemyHurt: ['{name}にダメージ。{lost}減ったね。', '{name}のHPが{lost}減ったよ。'],
      turn: ['ターン{turn}だね。', 'ターン{turn}に入ったよ。'],
      chapter: ['第{chapter}章が始まるね。', '第{chapter}章、始まったよ。'],
      critHit: ['{attacker}の必殺の一撃だよ。'],
      doubleHit: ['{attacker}の連続攻撃、二回とも当たったよ。'],
      heal: ['{name}のHPが{from}から{to}に回復したよ。'],
      joined: ['{name}が仲間になったよ。', '{name}が仲間に加わったね。'],
      staffHeal: ['{user}が{target}を回復したよ。HPが{hp}から{hp2}になったよ。'],
      staffUse: ['{user}が{target}に杖を使ったよ。'],
      battleHit: ['{attacker}が{defender}を攻撃。HPが{dhp}から{dhp2}になったよ。'],
      battleKill: ['{attacker}が{defender}を倒したよ。'],
      battleMiss: ['{attacker}の攻撃は、{defender}にダメージなしだったよ。'],
      battleCounter: ['反撃で{attacker}のHPが{ahp}から{ahp2}になったよ。'],
      battleDown: ['{attacker}は反撃で倒れちゃったよ。'],
      levelUp: ['{name}がレベル{lv}に上がったよ。{growth}'],
      levelUpNone: ['{name}がレベル{lv}に上がったけど、能力は変わらなかったよ。'],
      enemyApproach: ['{name}が{target}に近づいてるよ。'],
      nearEnemies: ['近くに敵が{count}体いるよ。'],
      hpStatus: ['{target}は残りHP{hp}だよ。'],
      enemyLeft: ['{name}は残りHP{hp}だね。'],
      partyStatus: ['味方{allies}人に敵{enemies}体。一番傷んでるのは{worst}で、HP{hp}。'],
      partyAllFull: ['味方{allies}人に敵{enemies}体。みんなHPは満タンだよ。'],
    },
  },
});

const formalEnding = /(です|ます|ました|でした|ません|ください|でしょう)(か|ね|よ|よね)?$/;
// Notes the model wrote to itself ("... を短く話す。") instead of lines to say aloud.
const leakedNote = /断定しない|繰り返さず|見どころ|(話す|伝える|述べる|語る|触れる|言及する|紹介する|説明する)。?$|(短く|簡潔に|一言で)(話|伝|述べ|触れ)/;

// Backstop for free-form text: reject internal-note leakage everywhere, and plain-form endings in formal tones.
const leakedNoteEn = /\b(?:do not|don't) (?:repeat|claim|state|assert)\b|^(?:talk|speak|mention|describe|comment|note|explain) (?:about|on|that|how)\b|\b(?:in|with) (?:one|a) (?:short )?(?:sentence|line)\.?$/i;

export function reviewTone(text, key, language = 'ja') {
  if (language === 'en') return !leakedNoteEn.test(text.trim());
  if (leakedNote.test(text)) return false;
  if (key !== 'announcer' && key !== 'calm') return true;
  return text.split(/[。！？]/).map(sentence => sentence.trim()).filter(Boolean).every(sentence => formalEnding.test(sentence));
}

export const defaultTone = 'announcer';

export function getTone(key) {
  if (typeof key !== 'string' || !Object.hasOwn(tones, key)) throw new Error(t('badTone'));
  return tones[key];
}

export function phrase(tone, key, variant, vars = {}) {
  const list = tone.phrases[key];
  // The joiner lets phrases be concatenated (English needs a space); callers trim the finished text.
  return list[Math.abs(variant) % list.length].replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? '')) + (tone.joiner ?? '');
}

const growthLabels = {
  ja: { labels: { max_hp: 'HP', strength: '力', skill: '技', weapon_level: '武器レベル', speed: '速さ', luck: '幸運', defense: '守備' }, join: '、', end: '。', gain: (label, n) => `${label}+${n}` },
  en: { labels: { max_hp: 'HP', strength: 'Str', skill: 'Skl', weapon_level: 'WLv', speed: 'Spd', luck: 'Lck', defense: 'Def' }, join: ', ', end: '.', gain: (label, n) => `${label} +${n}` },
};

// A tone resolved for one language: wording, style, length limit, and how text is joined.
export function localizedTone(key, language = 'ja') {
  const base = getTone(key);
  if (language === 'en') {
    return { ...base, ...english[key], lang: 'en', joiner: ' ', enemyLabel: 'an enemy', growth: growthLabels.en };
  }
  return { ...base, lang: 'ja', joiner: '', enemyLabel: '敵', growth: growthLabels.ja };
}
