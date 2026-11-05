import test from 'node:test';
import assert from 'node:assert/strict';
import { Watcher } from '../app/watcher.js';
import { playByPlay, localizedTone } from './helpers/fe1.js';

const chapterChange = { event_id: 1, type: 'chapter_changed', from: 2, to: 3, before_frame: 100, after_frame: 115 };
const unit = { key: 'player:0', side: 'player', character_id: 1, name: 'マルス', class_name: 'ロード', hp: 18, max_hp: 18, x: 5, y: 5 };
const state = { profile_id: 'fe1-jp-v1', chapter: 3, turn: 1, units: [unit] };

for (const language of ['ja', 'en']) {
  test(`RAM chapter preload is silent and later gameplay still narrates (${language})`, async () => {
    let now = 0, calls = 0;
    const watcher = new Watcher({ language, clock: () => now, tone: 'announcer',
      authenticate: async () => ({ plan: 'pro' }),
      generate: async () => { calls++; return { speak: false }; } });
    await watcher.start('lively', { includedOnlyConfirmed: true });
    const snapshot = (chapter, timeline, events, units = [unit]) => ({
      game_state: { ...state, chapter, units },
      recent_observations: { timeline_id: timeline, reset_reason: 'chapter_changed', events },
    });
    watcher.accept(snapshot(2, 'old', []));
    now = 30000;
    watcher.accept(snapshot(3, 'new', [chapterChange]));
    watcher.maybePlay();
    await watcher.maybeGenerate();
    now += 30000;
    watcher.accept(snapshot(3, 'new', [chapterChange]));
    watcher.maybePlay();
    await watcher.maybeGenerate();
    assert.equal(watcher.history.length, 0, 'preloading a chapter must not announce it, even after waiting');
    assert.equal(calls, 0, 'chapter preload must not trigger model commentary');
    assert.equal(watcher.timeline, 'new', 'chapter still resets the observation timeline');

    // A later, independent gameplay event remains eligible for narration.
    const healed = { ...unit, hp: 18 };
    const heal = { event_id: 2, type: 'hp_changed', side: 'player', unit_key: unit.key, from: 10, to: 18 };
    now += 30000;
    watcher.accept(snapshot(3, 'new', [chapterChange, heal], [healed]));
    watcher.maybePlay();
    assert.equal(watcher.history.length, 1);
    assert.doesNotMatch(watcher.history[0].text, /第3章|Chapter 3/i);
  });

  test(`a direct chapter event cannot produce a chapter-opening line (${language})`, () => {
    assert.deepEqual(playByPlay([chapterChange], state, { tone: localizedTone('announcer', language) }), []);
  });
}
