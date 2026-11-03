import test from 'node:test';
import assert from 'node:assert/strict';
import { Watcher } from '../app/watcher.js';
import { tones, getTone, phrase, localizedTone } from '../app/tones.js';
import { playByPlay } from '../app/games/fe1-play.js';
import { selectCandidate } from '../app/games/fe1-analysis.js';
import { buildCommentaryInstructions } from '../app/prompts.js';

const unit = (key, side, extra = {}) => ({ key, side, character_id: 4, name: side === 'player' ? 'カイン' : undefined, class_name: side === 'player' ? 'ソシアルナイト' : 'かいぞく', hp: 18, max_hp: 18, x: 5, y: 5, ...extra });
const state = (units, extra = {}) => ({ profile_id: 'fe1-jp-v1', chapter: 1, turn: 1, units, ...extra });
const hurt = (key, side, from, to, id = 1) => ({ event_id: id, type: 'hp_changed', unit_key: key, side, from, to });

test('every tone defines every phrase key with only known placeholders', () => {
  const keys = Object.keys(tones.announcer.phrases).sort();
  for (const [id, tone] of Object.entries(tones)) {
    assert.deepEqual(Object.keys(tone.phrases).sort(), keys, id);
    for (const list of Object.values(tone.phrases)) for (const text of list) {
      assert.deepEqual([...text.matchAll(/\{(\w+)\}/g)].map(m => m[1]).filter(n => !['name', 'ally', 'lost', 'hp', 'turn', 'chapter', 'count', 'target', 'allies', 'enemies', 'worst', 'attacker', 'defender', 'dhp', 'dhp2', 'ahp', 'ahp2', 'growth', 'lv', 'from', 'to', 'user', 'hp2'].includes(n)), [], text);
      assert.ok(text.length <= tone.maxChars * 1.5, text);
    }
  }
  assert.throws(() => getTone('unknown'), /口調/);
  assert.equal(phrase(tones.announcer, 'turn', 1, { turn: 3 }), 'ターン3です。');
});

test('play-by-play states observed facts in the chosen tone and ranks critical damage first', () => {
  const s = state([unit('player:0', 'player', { hp: 3 }), unit('enemy:1', 'enemy', { x: 6 })]);
  const events = [hurt('enemy:1', 'enemy', 10, 4, 1), hurt('player:0', 'player', 10, 3, 2), { event_id: 3, type: 'turn_changed', from: 1, to: 2 }];
  const lines = playByPlay(events, s, { tone: localizedTone('passion') });
  assert.match(lines[0].text, /カイン.*3/);
  assert.equal(lines[0].priority, 6);
  assert.ok(lines.some(line => /かいぞく/.test(line.text) && /6/.test(line.text)));
  assert.notEqual(playByPlay(events, s, { tone: localizedTone('calm') })[0].text, lines[0].text);
});

test('regrouping alone is silent; with a hurt ally or nearby enemies the line carries that situation', () => {
  const move = { event_id: 1, type: 'position_changed', side: 'player', unit_key: 'player:0', from: { x: 1, y: 9 }, to: { x: 1, y: 1 } };
  const healthy = state([unit('player:0', 'player', { x: 1, y: 1 }), unit('player:1', 'player', { x: 1, y: 2, name: 'アベル' }), unit('enemy:1', 'enemy', { x: 30, y: 30 })]);
  assert.deepEqual(playByPlay([move], healthy, { tone: localizedTone('announcer') }), []);
  const hurtAlly = state([unit('player:0', 'player', { x: 1, y: 1 }), unit('player:1', 'player', { x: 1, y: 2, name: 'アベル', hp: 6 }), unit('enemy:1', 'enemy', { x: 3, y: 2 })]);
  const [line] = playByPlay([move], hurtAlly, { tone: localizedTone('announcer') });
  assert.match(line.text, /アベル.*残りHP6/); assert.match(line.text, /敵が1体/);
});

test('turn lines summarize both sides and the most worn-down ally', () => {
  const s = state([unit('player:0', 'player', { hp: 5 }), unit('player:1', 'player', { x: 6, name: 'アベル' }), unit('enemy:1', 'enemy', { x: 20 }), unit('enemy:2', 'enemy', { x: 21 })]);
  const [line] = playByPlay([{ event_id: 1, type: 'turn_changed', from: 1, to: 2 }], s, { tone: localizedTone('announcer') });
  assert.match(line.text, /ターン2/); assert.match(line.text, /味方2人、敵2体/); assert.match(line.text, /カイン、HP5/);
});

test('ordinary movement away from allies and enemies produces no narration', () => {
  const s = state([unit('player:0', 'player', { x: 1, y: 1 }), unit('enemy:1', 'enemy', { x: 20, y: 20 })]);
  const move = { event_id: 1, type: 'position_changed', side: 'player', unit_key: 'player:0', from: { x: 1, y: 2 }, to: { x: 1, y: 1 } };
  assert.deepEqual(playByPlay([move], s, { tone: localizedTone('announcer') }), []);
});

test('watcher narrates locally without a model call, respects cooldown and topic suppression', async () => {
  let now = 0, generated = 0;
  const watcher = new Watcher({ authenticate: async () => ({ plan: 'pro' }), includedOnlyConfirmed: true, clock: () => now, tone: 'passion',
    generate: async () => { generated++; return { speak: false, comment: '' }; } });
  await watcher.start('balanced', { includedOnlyConfirmed: true, tone: 'calm' });
  assert.equal(watcher.tone, 'calm');
  const make = (hp, events) => ({ game_state: state([unit('player:0', 'player', { hp }), unit('enemy:1', 'enemy', { x: 6 })]), recent_observations: { timeline_id: 't', events } });
  watcher.accept(make(18, []));
  watcher.accept(make(14, [hurt('player:0', 'player', 18, 14, 1)]));
  now = 3000; watcher.maybePlay();
  assert.equal(watcher.history.length, 1);
  assert.equal(watcher.history[0].kind, 'play');
  assert.equal(generated, 0);
  watcher.accept(make(11, [hurt('player:0', 'player', 18, 14, 1), hurt('player:0', 'player', 14, 11, 2)]));
  now = 6000; watcher.maybePlay();
  assert.equal(watcher.history.length, 1, 'cooldown');
  now = 40000; watcher.accept(make(8, [hurt('player:0', 'player', 14, 11, 2), hurt('player:0', 'player', 11, 8, 3)]));
  watcher.maybePlay();
  assert.equal(watcher.history.length, 2);
  assert.equal(watcher.publicState().tone, 'calm');
  assert.equal(watcher.publicState().speech.rate, tones.calm.rate);
});

test('critical or lord damage is high intensity and the prompt carries tone and emotion allowance', () => {
  const lord = unit('player:0', 'player', { character_id: 1, hp: 8, max_hp: 20, name: 'マルス' });
  const pending = [{ event: hurt('player:0', 'player', 20, 8), receivedAt: 1 }];
  const candidate = selectCandidate(pending, state([lord]), { changes: pending, now: 5000 });
  assert.equal(candidate.intensity, 'high');
  const high = buildCommentaryInstructions('', { tone: localizedTone('passion'), intensity: 'high' });
  assert.match(high, /熱量/); assert.match(high, /山場/); assert.match(high, /40文字以内/);
  assert.doesNotMatch(buildCommentaryInstructions('', { tone: localizedTone('passion') }), /山場/);
});

test('a decided battle tones commentary down; an even or dangerous one does not', async () => {
  const players = [unit('player:0', 'player', { character_id: 1 }), unit('player:1', 'player')];
  const crowd = n => Array.from({ length: n }, (_, i) => unit(`enemy:${i}`, 'enemy', { x: 20 + i }));
  const { isSettled } = await import('../app/games/fe1.js');
  assert.equal(isSettled(state([...players, ...crowd(1)]), { peakEnemies: 8 }), true);
  assert.equal(isSettled(state([...players, ...crowd(5)]), { peakEnemies: 8 }), false, 'still many enemies');
  assert.equal(isSettled(state([...players, ...crowd(1)]), { peakEnemies: 2 }), false, 'never a real crowd');
  assert.equal(isSettled(state([unit('player:0', 'player', { character_id: 1, hp: 4 }), ...crowd(1)]), { peakEnemies: 8 }), false, 'lord in danger');
  const s = state([...players, ...crowd(1)]);
  const events = [hurt('enemy:0', 'enemy', 10, 4, 1), { event_id: 2, type: 'turn_changed', from: 1, to: 2 }];
  assert.equal(playByPlay(events, s, { tone: localizedTone('passion') }).length, 2);
  assert.deepEqual(playByPlay(events, s, { tone: localizedTone('passion'), settled: true }).map(l => l.topicKey), ['turn']);
  const note = buildCommentaryInstructions('', { tone: localizedTone('passion'), settled: true });
  assert.match(note, /大勢はほぼ決して/);
  assert.doesNotMatch(buildCommentaryInstructions('', { tone: localizedTone('passion'), intensity: 'high', settled: true }), /大勢はほぼ決して/);
});

test('reviewTone rejects leaked notes everywhere and casual endings in formal tones only', async () => {
  const { reviewTone } = await import('../app/tones.js');
  assert.equal(reviewTone('マルスが合流組に寄った見どころ。回復や戦闘結果は断定しない。', 'companion'), false);
  assert.equal(reviewTone('既出のサジ合流を繰り返さず、前衛の並びを話す。', 'passion'), false);
  assert.equal(reviewTone('カインの後ろにドーガとオグマがいるね。', 'announcer'), false);
  assert.equal(reviewTone('カインの後ろにドーガとオグマがいますね。心強い布陣です。', 'announcer'), true);
  assert.equal(reviewTone('カインの後ろにドーガとオグマがいるね。', 'companion'), true);
  assert.equal(reviewTone('ドーガが前に出ましたね。', 'calm'), true);
});

test('menus and battle animations keep the commentator quiet; a stuck menu is ignored after 3 minutes', async () => {
  const { scene } = await import('../app/games/fe1.js');
  assert.equal(scene({ scene: { menu_mode_raw: 0, fight_class_raw: 0x55 } }), 'map');
  assert.equal(scene({ scene: { menu_mode_raw: 0x0C, fight_class_raw: 0x55 } }), 'menu');
  assert.equal(scene({ scene: { menu_mode_raw: 0, fight_class_raw: 7 } }), 'battle');
  assert.equal(scene({ scene: { menu_mode_raw: 0x0C, fight_class_raw: 7 } }), 'battle');
  assert.equal(scene({}), 'map');

  let now = 0, generated = 0;
  const watcher = new Watcher({ authenticate: async () => ({ plan: 'pro' }), includedOnlyConfirmed: true, clock: () => now, tone: 'announcer',
    generate: async () => { generated++; return { speak: false, comment: '' }; } });
  await watcher.start('lively', { includedOnlyConfirmed: true });
  const make = (hp, events, hints) => ({ game_state: { ...state([unit('player:0', 'player', { hp }), unit('enemy:1', 'enemy', { x: 6 })]), scene: hints }, recent_observations: { timeline_id: 't', events } });
  const map = { menu_mode_raw: 0, fight_class_raw: 0x55 };
  watcher.accept(make(18, [], map));
  watcher.accept(make(10, [hurt('player:0', 'player', 18, 10, 1)], { menu_mode_raw: 0, fight_class_raw: 7 }));
  now = 5000; watcher.maybePlay(); await watcher.maybeGenerate();
  assert.equal(watcher.history.length, 0, 'silent during battle');
  watcher.accept(make(10, [hurt('player:0', 'player', 18, 10, 1)], map));
  now = 10000; watcher.maybePlay();
  assert.equal(watcher.history.length, 1, 'the queued damage is narrated once the battle ends');
  const menu = { menu_mode_raw: 0x0C, fight_class_raw: 0x55 };
  watcher.accept(make(10, [hurt('player:0', 'player', 18, 10, 1), { event_id: 2, type: 'turn_changed', from: 1, to: 2 }], menu));
  now = 60000; watcher.maybePlay();
  assert.equal(watcher.history.length, 1, 'silent while a menu is open');
  now = 250000; watcher.accept(make(10, [{ event_id: 3, type: 'turn_changed', from: 2, to: 3 }], menu));
  watcher.maybePlay();
  assert.equal(watcher.history.length, 2, 'a menu stuck for over 3 minutes no longer silences commentary');
});

test('reviewTone rejects self-addressed notes such as "... を短く話す。" but not spoken lines', async () => {
  const { reviewTone } = await import('../app/tones.js');
  for (const note of ['カインがオグマの横に並んだ。騎馬の機動力が前線に加わった点を短く話す。', 'ドーガの合流を一言で伝える。', 'サジの話題に触れる。'])
    assert.equal(reviewTone(note, 'companion'), false, note);
  for (const line of ['カインがオグマの横に並んだね。騎馬が前線に加わると頼もしいよ。', 'ダロスっていう海賊が王子に会いたがってたらしいね。', 'ドーガがサジに追いついたよ。'])
    assert.equal(reviewTone(line, 'companion'), true, line);
});
