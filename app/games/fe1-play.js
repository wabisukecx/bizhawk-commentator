// Local play-by-play: fixed wording from observed differences, no model call.
// Each line pairs the change with the situation around it; a bare change is not worth saying.
import { phrase } from '../tones.js';

const dist = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const ratio = unit => unit.max_hp ? unit.hp / unit.max_hp : 1;
// Same order as the stats window. Weapon level is a stat that grows at a level-up like the others (4 to 5, 5 to 6
// in recorded level-ups; the window calls it ぶきレベル).
const GROWTH_KEYS = ['max_hp', 'strength', 'skill', 'weapon_level', 'speed', 'luck', 'defense'];

// English sentences start with a capital (names such as "the Pirate" can open one).
const sentenceCase = text => text.replace(/(^|[.!?] )([a-z])/g, (_, lead, letter) => lead + letter.toUpperCase());

// Which fighter is ours (it alone receives experience and level-ups): matched by character ID against the map.
function playerCombatant(event, state) {
  const ours = who => state.units.some(unit => unit.side === 'player' && unit.character_id === who.pid);
  const a = ours(event.attacker), d = ours(event.defender);
  return a && !d ? event.attacker : d && !a ? event.defender : null;
}

// Replays the strikes in the game's order (the one who started the fight first, then the other, then the follow-up
// by whoever doubles; a fight stops when someone's HP reaches zero) and returns what really happened: hits and
// whether a critical landed, per fighter. The replay is accepted only when it reproduces the logged HP after the
// fight (it did for all 29 recorded non-staff fights, eight of them lethal); otherwise null.
function replayStrikes(a, d, followUp) {
  if (![a.damage, d.damage, a.hp, d.hp, a.hp_after, d.hp_after].every(Number.isFinite)) return null;
  const hp = { a: a.hp, d: d.hp };
  const out = { a: { hits: 0, crit: false }, d: { hits: 0, crit: false } };
  const strikes = [['a', false], ['d', false]];
  if (followUp === 1) strikes.push(['a', true]); else if (followUp === 2) strikes.push(['d', true]);
  for (const [who, second] of strikes) {
    if (hp.a <= 0 || hp.d <= 0) break;
    const fighter = who === 'a' ? a : d;
    if (!(second ? fighter.hit_second : fighter.hit_first)) continue;
    const crit = Boolean(second ? fighter.crit_second : fighter.crit_first);
    const damage = crit ? Math.min(120, fighter.damage * 3) : fighter.damage;
    const target = who === 'a' ? 'd' : 'a';
    hp[target] = Math.max(0, hp[target] - damage);
    out[who].hits++;
    if (crit) out[who].crit = true;
  }
  return hp.a === a.hp_after && hp.d === d.hp_after ? out : null;
}

// What happened in a fight, from the per-strike flags and the replay above.
export function analyzeBattle(event) {
  const a = event.attacker, d = event.defender, followUp = event.follow_up ?? 0;
  // A staff (healing and the like) goes through the same fight data: the user is index 0, the target index 1.
  // Known from the item flags; a target whose HP rose is treated as healed even if the flags are unknown.
  const staff = a.is_attack_item === false || d.hp_after > d.hp;
  const lethal = a.hp_after <= 0 || d.hp_after <= 0;
  const replay = replayStrikes(a, d, followUp);
  const side = (who, doubles, key) => {
    if (replay) return replay[key];
    if (lethal) return { hits: null, crit: false }; // order not confirmed by the HP, so no claim
    const second = doubles && who.hit_second;
    return { hits: (who.hit_first ? 1 : 0) + (second ? 1 : 0), crit: Boolean(who.hit_first && who.crit_first || second && who.crit_second) };
  };
  if (staff) return { staff: true, lethal: false, defeated: null, attacker: { hits: null, crit: false }, defender: { hits: null, crit: false } };
  return { staff: false, lethal, defeated: d.hp_after <= 0 ? 'defender' : a.hp_after <= 0 ? 'attacker' : null,
    attacker: side(a, followUp === 1, 'a'), defender: side(d, followUp === 2, 'd') };
}

// Returns candidate lines, most important first. The caller applies timing and de-duplication.
export function playByPlay(events, state, { tone, settled = false }) {
  const alive = state.units.filter(unit => unit.hp > 0);
  const players = alive.filter(unit => unit.side === 'player');
  const enemies = alive.filter(unit => unit.side === 'enemy');
  const enemiesNear = (unit, range = 5) => enemies.filter(enemy => dist(unit, enemy) <= range).length;
  const lines = [];
  const english = tone.lang === 'en';
  const add = (priority, topicKey, text) => {
    const trimmed = text.trim();
    lines.push({ priority, topicKey, text: english ? sentenceCase(trimmed) : trimmed });
  };
  // A unit with a name is called by it; otherwise by its class ("the Pirate" in English).
  const called = (name, className) => name ?? (className ? (english ? `the ${className}` : className) : tone.enemyLabel);
  const displayName = unit => called(unit.name, unit.class_name);
  const combatantName = who => called(who.name, who.class_name);

  const partyStatus = n => {
    const worst = players.reduce((a, b) => (a && ratio(a) <= ratio(b) ? a : b), null);
    const vars = { allies: players.length, enemies: enemies.length };
    if (!worst || ratio(worst) >= 1) return phrase(tone, 'partyAllFull', n, vars);
    return phrase(tone, 'partyStatus', n, { ...vars, worst: displayName(worst), hp: worst.hp });
  };

  const hasBattle = events.some(event => event.type === 'battle');
  for (const event of events) {
    const n = event.event_id ?? 0;
    if (event.type === 'battle') {
      const a = event.attacker, d = event.defender;
      const result = analyzeBattle(event);
      if (result.staff) {
        // Using a staff on an ally: said as healing when HP rose, otherwise only that a staff was used.
        const vars = { user: combatantName(a), target: combatantName(d), hp: d.hp, hp2: d.hp_after };
        add(8, `battle:${n}`, phrase(tone, d.hp_after > d.hp ? 'staffHeal' : 'staffUse', n, vars));
        // The user gets the experience, so a level-up belongs to the user (the target is not "ours" alone here).
        const user = state.units.some(unit => unit.side === 'player' && unit.character_id === a.pid) ? a : null;
        if (user && event.after.level > user.level) {
          const g = tone.growth;
          const growth = GROWTH_KEYS.map(key => [g.labels[key], (event.after[key] ?? 0) - user[key]]).filter(([, gain]) => gain > 0 && gain < 10)
            .map(([label, gain]) => g.gain(label, gain)).join(g.join);
          add(9, `levelup:${user.pid}`, phrase(tone, growth ? 'levelUp' : 'levelUpNone', n, { name: combatantName(user), lv: event.after.level, growth: growth ? growth + g.end : '' }));
        }
        continue;
      }
      const vars = { attacker: combatantName(a), defender: combatantName(d), dhp: d.hp, dhp2: d.hp_after, ahp: a.hp, ahp2: a.hp_after };
      // HP after the fight is computed by the game before the animation: 0 means that unit was defeated.
      let text = phrase(tone, d.hp_after <= 0 ? 'battleKill' : d.hp_after < d.hp ? 'battleHit' : 'battleMiss', n, vars);
      if (result.attacker.crit) text += phrase(tone, 'critHit', n, { attacker: vars.attacker });
      else if (result.attacker.hits === 2) text += phrase(tone, 'doubleHit', n, { attacker: vars.attacker });
      if (a.hp_after <= 0) text += phrase(tone, 'battleDown', n, vars);
      else if (a.hp_after < a.hp) text += phrase(tone, 'battleCounter', n, vars);
      if (result.defender.crit) text += phrase(tone, 'critHit', n, { attacker: vars.defender });
      else if (result.defender.hits === 2) text += phrase(tone, 'doubleHit', n, { attacker: vars.defender });
      add(8, `battle:${n}`, text);
      const mine = playerCombatant(event, state);
      if (mine && event.after.level > mine.level) {
        const g = tone.growth;
        const growth = GROWTH_KEYS.map(key => [g.labels[key], (event.after[key] ?? 0) - mine[key]]).filter(([, gain]) => gain > 0 && gain < 10)
          .map(([label, gain]) => g.gain(label, gain)).join(g.join);
        const lv = { name: combatantName(mine), lv: event.after.level, growth: growth ? growth + g.end : '' };
        add(9, `levelup:${mine.pid}`, phrase(tone, growth ? 'levelUp' : 'levelUpNone', n, lv));
      }
    } else if (event.type === 'unit_joined') {
      // Seen on the player side for the first time mid-chapter: a recruit.
      add(9.5, `join:${event.character_id}`, phrase(tone, 'joined', n, { name: called(event.name, event.class_name) }));
    } else if (event.type === 'chapter_changed') {
      add(10, 'chapter', phrase(tone, 'chapter', n, { chapter: event.to }) + partyStatus(n));
    } else if (event.type === 'turn_changed') {
      add(4, 'turn', phrase(tone, 'turn', n, { turn: event.to }) + partyStatus(n));
    } else if (event.type === 'hp_changed' && event.to > event.from) {
      const unit = state.units.find(u => u.key === event.unit_key);
      // Recovery outside a fight (staff, item, terrain); small rises are not worth a line.
      if (!unit || hasBattle || event.to - event.from < 3) continue;
      add(3.5, `heal:${unit.key}`, phrase(tone, 'heal', n, { name: displayName(unit), from: event.from, to: event.to }));
    } else if (event.type === 'hp_changed' && event.to < event.from) {
      const unit = state.units.find(u => u.key === event.unit_key);
      if (!unit) continue;
      const lost = event.from - event.to;
      const name = displayName(unit);
      // A fight reports its own damage; otherwise skip trivial changes (under 10% of max HP, or 2 or less).
      const critical = unit.side === 'player' && unit.hp > 0 && ratio(unit) <= .25;
      if (hasBattle || !critical && lost <= Math.max(2, Math.floor((unit.max_hp ?? 0) * .1))) continue;
      if (unit.side === 'enemy') {
        // HP 0 is not reported as a defeat: the observer cannot confirm one.
        add(3, `hurt:${unit.key}`, phrase(tone, 'enemyHurt', n, { name, lost }) + (unit.hp > 0 ? phrase(tone, 'enemyLeft', n, { name, hp: unit.hp }) : ''));
      } else {
        const near = enemiesNear(unit);
        const detail = near ? phrase(tone, 'nearEnemies', n, { count: near }) : '';
        if (unit.hp > 0 && ratio(unit) <= .25) add(6, `hurt:${unit.key}`, phrase(tone, 'critical', n, { name, hp: unit.hp }) + detail);
        else add(4, `hurt:${unit.key}`, phrase(tone, 'allyHurt', n, { name, lost, hp: unit.hp }) + detail);
      }
    } else if (event.type === 'position_changed' && event.side === 'enemy') {
      const unit = enemies.find(u => u.key === event.unit_key);
      if (!unit) continue;
      const target = players.map(p => ({ p, d: dist(unit, p) })).sort((x, y) => x.d - y.d)[0];
      // Only says who it is closing in on; the actual target is known when the fight starts.
      if (target && target.d <= 6) add(1.5 - target.d / 100, `emove:${unit.key}`, phrase(tone, 'enemyApproach', n, { name: displayName(unit), target: displayName(target.p) }));
    } else if (event.type === 'position_changed' && event.side === 'player') {
      const unit = players.find(u => u.key === event.unit_key);
      if (!unit) continue;
      const name = displayName(unit);
      const ally = players.find(u => u.key !== unit.key && dist(unit, u) <= 2 && dist(event.from, u) >= 4);
      const near = enemiesNear(unit);
      if (ally) {
        // Regrouping matters only when someone is hurt or enemies are close.
        const hurt = [unit, ally].filter(u => ratio(u) < 1).sort((a, b) => ratio(a) - ratio(b))[0];
        const nearAny = Math.max(near, enemiesNear(ally));
        if (!hurt && !nearAny) continue;
        add(2, `move:${unit.key}`, phrase(tone, 'beside', n, { name, ally: displayName(ally) })
          + (hurt ? phrase(tone, 'hpStatus', n, { target: displayName(hurt), hp: hurt.hp }) : '')
          + (nearAny ? phrase(tone, 'nearEnemies', n, { count: nearAny }) : ''));
      } else if (enemiesNear(unit, 4)) {
        add(1, `move:${unit.key}`, phrase(tone, 'approach', n, { name }) + phrase(tone, 'nearEnemies', n, { count: near }));
      }
    }
  }
  // When the outcome is clear, keep only turn/chapter marks and damage to our side.
  return lines.filter(line => !settled || line.priority >= 4).sort((a, b) => b.priority - a.priority);
}
