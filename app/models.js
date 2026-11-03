import { t } from './i18n.js';
export const models = Object.freeze({
  sonnet: { label: 'Sonnet', cliName: 'sonnet', effort: 'low' },
  haiku: { label: 'Haiku', cliName: 'haiku', effort: 'low' },
});

export function normalizeModel(key) { return key === 'haiku-5-5' ? 'haiku' : key; }

export function getModel(key) {
  key = normalizeModel(key);
  if (typeof key !== 'string' || !Object.hasOwn(models, key)) throw new Error(t('badModel'));
  return models[key];
}
