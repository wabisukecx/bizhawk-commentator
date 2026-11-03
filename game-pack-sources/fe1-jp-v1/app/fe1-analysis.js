// Topic selection is deterministic. The model supplies words, not evidence.
import { unitName } from './fe1-names.js';
const dist = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const alive = state => state.units.filter(u => u.hp > 0);
const friendGap = (unit, units) => Math.min(Infinity, ...units.filter(u => u.side === 'player' && u.key !== unit.key).map(u => dist(unit, u)));
const nearEnemies = (unit, units) => units.filter(u => u.side === 'enemy' && dist(unit, u) <= 5);
const label = u => ({ key: u.key, name: unitName(u), class_name: u.class_name });

export function selectCandidate(pending, state, analysis = {}) {
  if (!pending.length) return null;
  const now = analysis.now ?? Math.max(...pending.map(p => p.receivedAt));
  const units = alive(state), before = analysis.before?.units ?? [];
  const changes = analysis.changes ?? pending;
  const topics = [];
  const add = (kind, unit, score, focus, facts, relevant, intensity = 'normal') => {
    const evidence = pending.filter(p => relevant(p.event));
    if (!evidence.length) return;
    const key = kind === 'exchange' ? `exchange:${facts.observed_losses.map(l => l.unit_key).sort().filter((v, i, a) => i === 0 || v !== a[i - 1]).join(',')}` : `${kind}:${unit?.key ?? state.chapter}`;
    if (analysis.recentTopics?.some(t => t.key === key && now - t.at < 120000)) return;
    const chosen = evidence.at(-1);
    topics.push({ ...chosen, priority: score, category: kind === 'support_rejoined' || kind === 'isolation_opened' ? 'movement' : 'change',
      topicKey: key, intensity, context: { topic: kind, focus, facts,
        limitations: '距離は地形無視。行動可否・装備・戦闘の因果と順序は不明。' } });
  };
  for (const unit of units.filter(u => u.side === 'player')) {
    const previous = before.find(u => u.key === unit.key && u.character_id === unit.character_id);
    const local = units.filter(u => dist(unit, u) <= 5);
    const losses = changes.filter(p => p.event.type === 'hp_changed' && p.event.to < p.event.from && local.some(u => u.key === p.event.unit_key))
      .map(p => ({ unit_key: p.event.unit_key, side: p.event.side, lost: p.event.from - p.event.to, event_id: p.event.event_id }));
    const ownLoss = losses.filter(l => l.unit_key === unit.key).reduce((n, l) => n + l.lost, 0);
    const allyLoss = losses.filter(l => l.side === 'player').reduce((n, l) => n + l.lost, 0);
    const enemyLoss = losses.filter(l => l.side === 'enemy').reduce((n, l) => n + l.lost, 0);
    const hpEvidence = e => e.type === 'hp_changed' && local.some(u => u.key === e.unit_key);
    if (ownLoss >= Math.max(4, (unit.max_hp ?? 20) * .25) || ownLoss > 0 && unit.hp <= (unit.max_hp ?? 0) * .35) {
      add('attrition', unit, 5, '前に出ている味方の消耗と、交代や合流という選択肢',
        { unit: { ...label(unit), hp: unit.hp, max_hp: unit.max_hp }, observed_losses: losses,
          nearby_allies: local.filter(u => u.side === 'player' && u.key !== unit.key).map(label) }, e => hpEvidence(e) && e.unit_key === unit.key,
        unit.hp <= (unit.max_hp ?? 0) * .25 || unit.character_id === 1 && unit.hp <= (unit.max_hp ?? 0) * .5 ? 'high' : 'normal');
    }
    if (enemyLoss >= 6 && allyLoss > 0 && enemyLoss >= allyLoss * 2) {
      add('exchange', unit, 4, 'この一帯では味方より敵のHP減少が大きい。個別の戦闘原因を決めず、消耗の釣り合いを話す',
        { anchor: label(unit), observed_losses: losses, allied_hp_lost: allyLoss, enemy_hp_lost: enemyLoss }, hpEvidence);
    }
    if (!previous || !pending.some(p => p.event.type === 'position_changed' && p.event.unit_key === unit.key)) continue;
    const oldUnits = before.filter(u => u.hp > 0);
    const gapBefore = friendGap(previous, oldUnits), gapNow = friendGap(unit, units);
    const joined = local.filter(u => u.side === 'player' && u.key !== unit.key && dist(unit, u) <= 2 && dist(previous, before.find(b => b.key === u.key) ?? u) >= 4);
    const pressured = joined.filter(u => nearEnemies(u, units).length || u.hp < u.max_hp);
    if (pressured.length) add('support_rejoined', unit, 3, `動いたのは${unitName(unit) ?? unit.key}。${pressured.map(u => unitName(u) ?? u.key).join('・')}のそばへ移動した。兵種に合う見どころを一つ。交代の提案は必須ではない`,
      { arriving: label(unit), joined: pressured.map(label), before_position: { x: previous.x, y: previous.y }, after_position: { x: unit.x, y: unit.y } }, e => e.type === 'position_changed' && e.unit_key === unit.key);
    if (gapBefore <= 3 && gapNow >= 4 && nearEnemies(unit, units).length) add('isolation_opened', unit, 3, '味方から新たに距離が開いた。単に敵が近いのではなく、近くの味方と足並みが外れた変化',
      { unit: label(unit), friend_distance_before: gapBefore, friend_distance_now: gapNow, nearby_enemies: nearEnemies(unit, units).map(label) }, e => e.type === 'position_changed' && e.unit_key === unit.key);
  }
  for (const enemy of units.filter(u => u.side === 'enemy' && u.max_hp && u.hp <= u.max_hp * .25)) {
    const allies = units.filter(u => u.side === 'player' && dist(u, enemy) <= 2);
    if (allies.length < 2) continue;
    add('cleanup_choice', enemy, 2, '弱った敵の近くに複数の味方。誰に経験を回すかを考える場面（倒せるかは未計算）',
      { enemy: { ...label(enemy), hp: enemy.hp, max_hp: enemy.max_hp }, nearby_allies: allies.map(u => ({ ...label(u), level: u.level, exp: u.exp, inventory: u.inventory })) },
      e => e.type === 'hp_changed' && e.unit_key === enemy.key && e.to < e.from);
  }
  return topics.sort((a, b) => b.priority - a.priority || b.receivedAt - a.receivedAt)[0] ?? null;
}
