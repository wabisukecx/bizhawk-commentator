import { t } from './i18n.js';
import { english } from './tones-en.js';

// Shared speaking styles; game-specific phrases belong to game packs.
export const tones = Object.freeze({
  "announcer": {
    "label": "アナウンサー",
    "summary": "落ち着いた丁寧語。幅広い年齢向け",
    "rate": 1,
    "pitch": 1,
    "maxChars": 45,
    "style": "スポーツ中継のアナウンサーのように、落ち着いた丁寧語で話してください。すべての文を「です」「ます」「ました」などで終え、「〜いるね」「〜だ」「〜よ」のような口語で終えないでください。"
  },
  "passion": {
    "label": "熱血実況",
    "summary": "勢いのある口調。若い層向け",
    "rate": 1.12,
    "pitch": 1.1,
    "maxChars": 40,
    "style": "熱量のあるスポーツ実況のように、くだけた口語で短く話してください。感嘆符を使ってかまいません。"
  },
  "calm": {
    "label": "ゆったり解説",
    "summary": "ゆっくり平易で穏やか。年配の方にも",
    "rate": 0.88,
    "pitch": 1,
    "maxChars": 45,
    "style": "ゆっくり穏やかな丁寧語で話してください。すべての文を「です」「ます」「ですね」などで終え、口語で終えないでください。専門用語や横文字を避け、平易で短い文にしてください。"
  },
  "companion": {
    "label": "相棒",
    "summary": "くだけた会話口調",
    "rate": 1,
    "pitch": 1,
    "maxChars": 50,
    "style": "一緒に画面を見ている相棒として、くだけた会話の口調で話してください。"
  }
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


export function localizedTone(key, language = 'ja') {
  return { ...getTone(key), ...(language === 'en' ? english[key] : {}), lang: language };
}
