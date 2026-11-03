import { localizedTone as speakingStyle, tones as styles } from '#commentator/host';
import { phrases } from './phrases.js';

const growthLabels = {
  ja: { labels: { max_hp: 'HP', strength: '力', skill: '技', weapon_level: '武器レベル', speed: '速さ', luck: '幸運', defense: '守備' }, join: '、', end: '。', gain: (label, n) => `${label}+${n}` },
  en: { labels: { max_hp: 'HP', strength: 'Str', skill: 'Skl', weapon_level: 'WLv', speed: 'Spd', luck: 'Lck', defense: 'Def' }, join: ', ', end: '.', gain: (label, n) => `${label} +${n}` },
};

export function localizedTone(key, language = 'ja') {
  return { ...speakingStyle(key, language), phrases: phrases[language][key], growth: growthLabels[language],
    joiner: language === 'en' ? ' ' : '', enemyLabel: language === 'en' ? 'an enemy' : '敵' };
}

// Convenient data views for the pack's phrase consistency tests.
export const tones = Object.fromEntries(Object.keys(styles).map(key => [key, localizedTone(key, 'ja')]));
export const english = Object.fromEntries(Object.keys(styles).map(key => [key, localizedTone(key, 'en')]));
