import { playerName } from './names.js';

export default {
  id: 'example-hp-v1', title: 'HPサンプル', titleEn: 'HP example', stateSchema: 'example-hp-events-v1',
  accepts: state => [state.hp, state.max_hp, state.stage].every(Number.isInteger) && state.hp >= 0 && state.max_hp > 0 && state.hp <= state.max_hp && state.stage > 0,
  selectCandidate(pending, state) {
    const item = pending.find(item => item.event.type === 'value_changed' && item.event.field === 'hp');
    return item ? { ...item, priority: 2, category: 'health', topicKey: `hp:${item.event.event_id}`,
      context: { focus: 'HPの変化への短い反応。原因や敵の意図は推測しない。', facts: { before: item.event.from, after: item.event.to, max_hp: state.max_hp } } } : null;
  },
  fingerprint: state => JSON.stringify([state.stage, state.hp, state.max_hp]),
  summarize: state => ({ stage: state.stage, hp: state.hp, max_hp: state.max_hp }),
  describe: (state, language = 'ja') => language === 'en' ? `Stage ${state.stage}` : `ステージ${state.stage}`,
  instructions: 'HPの変化のみが根拠です。ダメージの原因、敵の行動、回復アイテムの種類は未取得です。',
  playByPlay(events, state, { tone }) {
    const event = events.find(event => event.type === 'value_changed' && event.field === 'hp');
    if (!event) return [];
    const text = tone.lang === 'en' ? `${playerName.en}: HP ${event.from} to ${event.to}.` : `${playerName.ja}のHPが${event.from}から${event.to}になりました。`;
    return [{ text, priority: 2, topicKey: `hp:${event.event_id}` }];
  },
};
