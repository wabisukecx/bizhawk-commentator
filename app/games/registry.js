import { fe1 } from './fe1.js';

/**
 * A game adapter owns its state validation, candidate priorities, context
 * summary, stale-response fingerprint, display label and commentary hints.
 * The watcher owns only polling, lifecycle, timing, quotas and subtitles.
 * Registration is explicit. No ROM discovery, downloading or automatic mapping.
 */
export function createGameRegistry(adapters) {
  const entries = new Map();
  for (const adapter of adapters) {
    if (!adapter.id || entries.has(adapter.id)) throw new Error('Duplicate or missing game adapter ID');
    for (const method of ['accepts', 'selectCandidate', 'fingerprint', 'summarize', 'describe']) {
      if (typeof adapter[method] !== 'function') throw new Error(`Game adapter is missing ${method}`);
    }
    entries.set(adapter.id, adapter);
  }
  return { resolve(state) {
    if (!state) return null;
    const adapter = entries.get(state.profile_id);
    return adapter && adapter.accepts(state) ? adapter : null;
  } };
}

const games = createGameRegistry([fe1]);
export const getGameAdapter = state => games.resolve(state);
