import test from 'node:test';
import assert from 'node:assert/strict';
import { Watcher } from '../app/watcher.js';
import { createApp } from '../app/server.js';
import { tones, localizedTone, phrase, reviewTone } from '../app/tones.js';
import { english } from '../app/tones-en.js';
import { buildCommentaryInstructions } from '../app/prompts.js';
import { romanize, englishName, localizeSnapshot, OFFICIAL } from '../app/games/fe1-i18n.js';
import { mentionedUnits, reviewComment, dialogueContext } from '../app/games/fe1.js';
import { playByPlay } from '../app/games/fe1-play.js';
import { setLanguage, t } from '../app/i18n.js';

test.afterEach(() => setLanguage('ja'));

const placeholders = text => [...new Set([...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]))].sort();

function assertPlaceholderParity(japanese, translated, label) {
  assert.deepEqual(placeholders(translated), placeholders(japanese), label);
}

test('placeholder parity rejects missing and extra facts, but permits reordered and repeated names', () => {
  assert.throws(() => assertPlaceholderParity('{name}: {hp}', '{name} is hurt.'), assert.AssertionError);
  assert.throws(() => assertPlaceholderParity('{name}: {hp}', '{name}: {hp}, {lost} lost.'), assert.AssertionError);
  assertPlaceholderParity('{name}: {hp}', '{hp} HP for {name}. Watch {name}.');
});

test('every English tone has exactly the phrase keys and placeholders of the Japanese one', () => {
  const allowed = ['name', 'ally', 'lost', 'hp', 'turn', 'chapter', 'count', 'target', 'allies', 'enemies', 'worst', 'attacker', 'defender', 'dhp', 'dhp2', 'ahp', 'ahp2', 'growth', 'lv', 'from', 'to', 'user', 'hp2'];
  assert.deepEqual(Object.keys(english).sort(), Object.keys(tones).sort());
  for (const [id, tone] of Object.entries(tones)) {
    const en = english[id];
    assert.deepEqual(Object.keys(en.phrases).sort(), Object.keys(tone.phrases).sort(), id);
    for (const [key, list] of Object.entries(en.phrases)) {
      const ja = tone.phrases[key];
      assert.ok(list.length > 0 && ja.length > 0, `${id}.${key} must have phrases`);
      // phrase() chooses variants modulo each list's length. Check every possible pairing,
      // including intentional shorter variants that omit a damage amount in both languages.
      for (let variant = 0; variant < list.length * ja.length; variant++) {
        assertPlaceholderParity(ja[variant % ja.length], list[variant % list.length], `${id}.${key} variant ${variant}`);
      }
      for (const text of list) {
        const used = [...text.matchAll(/\{(\w+)\}/g)].map(m => m[1]);
        assert.deepEqual(used.filter(name => !allowed.includes(name)), [], text);
        assert.ok(!/[぀-ヿ一-鿿]/.test(text), `Japanese left in ${id}.${key}: ${text}`);
      }
    }
    assert.ok(en.label && en.summary && en.style && en.maxChars);
  }
});

test('Hepburn romanization and official names', () => {
  assert.equal(romanize('ダロス'), 'Darosu');
  assert.equal(romanize('ジェイガン'), 'Jeigan');
  assert.equal(romanize('ミネルバ'), 'Mineruba');
  assert.equal(romanize('ゴードン'), 'Godon');
  assert.equal(romanize('ジュリアン'), 'Jurian');
  assert.equal(romanize('ロッテ'), 'Rotte');
  assert.equal(romanize('ウェンデル'), 'Wenderu');
  assert.equal(romanize('ファイアー'), 'Faia');
  assert.equal(romanize('ティキ'), 'Tiki');
  assert.equal(romanize('シャーロット'), 'Sharotto');
  assert.equal(englishName(1, 'マルス'), 'Marth');
  assert.equal(englishName(15, 'ダロス'), 'Darosu', 'unlisted characters fall back to romanization');
  assert.equal(englishName(99, undefined), undefined);
  assert.ok(Object.keys(OFFICIAL).length >= 20);
});

const unit = (key, side, extra = {}) => ({ key, side, character_id: 4, name: side === 'player' ? 'カイン' : undefined, class_name: side === 'player' ? 'ソシアルナイト' : 'かいぞく', hp: 18, max_hp: 18, x: 5, y: 5, ...extra });
const snapshot = (units, extra = {}) => ({ game_state: { profile_id: 'fe1-jp-v1', chapter: 2, turn: 3, units, ...extra }, recent_observations: { timeline_id: 't', events: [] } });

test('a snapshot is localized once: names, classes, battle sides; Japanese names are kept for dialogue matching', () => {
  const source = snapshot([unit('player:0', 'player', { character_id: 6, name: 'ドーガ', class_name: 'アーマーナイト' }), unit('enemy:0', 'enemy', { character_id: 15, candidate_name: 'ダロス' }), unit('enemy:1', 'enemy', { character_id: 133 })]);
  source.battle_log = [{ id: 1, attacker: { pid: 6, name: 'ドーガ', class_name: 'アーマーナイト' }, defender: { pid: 133, class_name: 'かいぞく' } }];
  const copy = localizeSnapshot(source);
  assert.equal(copy.game_state.units[0].name, 'Draug');
  assert.equal(copy.game_state.units[0].name_ja, 'ドーガ');
  assert.equal(copy.game_state.units[0].class_name, 'Armor Knight');
  assert.equal(copy.game_state.units[1].candidate_name, 'Darosu');
  assert.equal(copy.game_state.units[2].class_name, 'Pirate');
  assert.equal(copy.battle_log[0].attacker.name, 'Draug');
  assert.equal(copy.battle_log[0].defender.class_name, 'Pirate');
  assert.equal(source.game_state.units[0].name, 'ドーガ', 'the original is not modified');
  // The dialogue is Japanese: a named unit is still found by its Japanese name and reported by its English one.
  const [daros] = mentionedUnits(['ダロスっていうかいぞくが'], copy.game_state);
  assert.equal(daros.name, 'Darosu');
  assert.equal(dialogueContext(['ダロスっていうかいぞくが'], copy.game_state).facts.mentioned_units[0].name, 'Darosu');
});

test('English play-by-play reads naturally: joined sentences, capitals, "the Pirate", growth labels', () => {
  const source = snapshot([unit('player:0', 'player', { character_id: 6, name: 'ドーガ' }), unit('enemy:0', 'enemy', { character_id: 133 })]);
  const state = localizeSnapshot(source).game_state;
  const side = (pid, name, className, hp, hpAfter, flags) => ({ pid, name, class_name: className, level: 1, hp, max_hp: 18, hp_after: hpAfter, strength: 7, skill: 3, speed: 3, luck: 1, defense: 11, damage: 8, ...flags });
  const fight = { type: 'battle', event_id: 1_000_001, follow_up: 1,
    attacker: { ...side(6, 'Draug', 'Armor Knight', 18, 17, { hit_first: true, hit_second: true }), name_ja: 'ドーガ' },
    defender: side(133, undefined, 'Pirate', 18, 2, { hit_first: true }), after: { level: 2, max_hp: 18, exp: 4, strength: 8, skill: 3, speed: 4, luck: 2, defense: 11 } };
  const lines = playByPlay([fight], state, { tone: localizedTone('announcer', 'en') });
  assert.match(lines[0].text, /^Draug reaches level 2\. Str \+1, Spd \+1, Lck \+1\.$/);
  assert.match(lines[1].text, /^Draug (attacks the Pirate, whose HP drops from 18 to 2|lands a blow on the Pirate\. HP goes from 18 to 2)\./);
  assert.match(lines[1].text, /Draug lands both strikes\./);
  assert.match(lines[1].text, /On the counter, Draug's HP goes from 18 to 17\./);
  const approach = playByPlay([{ event_id: 5, type: 'position_changed', side: 'enemy', unit_key: 'enemy:0', from: { x: 9, y: 5 }, to: { x: 6, y: 5 } }], state, { tone: localizedTone('companion', 'en') });
  assert.equal(approach[0].text, 'The Pirate is closing in on Draug.');
  const turn = playByPlay([{ event_id: 6, type: 'turn_changed', from: 2, to: 3 }], state, { tone: localizedTone('passion', 'en') });
  assert.match(turn[0].text, /^(Turn 3, here we go!|On to turn 3!) Allies 1, enemies 1!/);
});

test('English instructions name the language, the tone and the intensity; Japanese ones are unchanged', () => {
  const tone = localizedTone('passion', 'en');
  const high = buildCommentaryInstructions('NOTE', { tone, intensity: 'high', language: 'en' });
  assert.match(high, /natural English only/);
  assert.match(high, /Tone: Speak like an excited sports commentator/);
  assert.match(high, /big moment/);
  assert.match(high, /about 100 characters/);
  assert.match(high, /Game-specific notes \(written in Japanese\):\nNOTE/);
  assert.match(buildCommentaryInstructions('', { tone: localizedTone('passion', 'ja') }), /^あなたはプレイヤーと一緒に/);
  assert.match(buildCommentaryInstructions('', { tone, settled: true, language: 'en' }), /nearly decided/);
});

test('English leakage and certainty filters', () => {
  assert.equal(reviewTone('Talk about Cain joining Abel.', 'companion', 'en'), false);
  assert.equal(reviewTone('Cain just joined Abel up front.', 'companion', 'en'), true);
  assert.equal(reviewComment('The pirates are totally safe from here.'), false);
  assert.equal(reviewComment('One more hit and he is done.'), false);
  assert.equal(reviewComment('Cain stepped up beside Abel.'), true);
});

test('the watcher runs in English end to end: localized names, English text, English messages and labels', async () => {
  let now = 0;
  const generated = [];
  const watcher = new Watcher({ authenticate: async () => ({ plan: 'pro' }), includedOnlyConfirmed: true, clock: () => now, tone: 'announcer', language: 'en',
    generate: async (payload, options) => { generated.push({ payload, options }); return { speak: true, comment: 'Draug pushes forward beside Saji.' }; } });
  assert.equal(watcher.publicState().language, 'en');
  assert.equal(watcher.publicState().message, 'Start watching and I will react to changes in the game now and then.');
  assert.deepEqual(watcher.publicState().tones.map(tone => tone.label), ['Announcer', 'Hype', 'Gentle guide', 'Buddy']);
  assert.equal(watcher.publicState().speech.lang, 'en-US');
  await watcher.start('lively', { includedOnlyConfirmed: true });
  const poll = (units, events = [], log = []) => ({ ...snapshot(units), recent_observations: { timeline_id: 't', events }, battle_log: log });
  const units = [unit('player:0', 'player', { character_id: 6, name: 'ドーガ' }), unit('enemy:0', 'enemy', { character_id: 133, x: 9, y: 5 })];
  watcher.accept(poll(units));
  assert.equal(watcher.publicState().game.label, 'Chapter 2, Turn 3');
  assert.equal(watcher.publicState().game.title, 'Fire Emblem: Shadow Dragon and the Blade of Light');
  const move = { event_id: 1, type: 'position_changed', side: 'enemy', unit_key: 'enemy:0', name: undefined, from: { x: 12, y: 5 }, to: { x: 9, y: 5 } };
  now = 2500; watcher.accept(poll(units, [move]));
  now = 20000; watcher.maybePlay();
  assert.equal(watcher.history.at(-1).text, 'The Pirate is closing in on Draug.');
  assert.throws(() => watcher.setLanguage('ja'), /cannot be changed while watching/);
  watcher.stop();
  assert.equal(watcher.publicState().message, 'Stopped watching.');
  watcher.setLanguage('ja');
  assert.equal(t('stopped'), '見守りを停止しました。');
});

test('the control page can switch language while stopped and the choice is saved', async t2 => {
  let saved;
  const watcher = new Watcher({ bridge: { start: async () => {}, close: () => {}, call: async () => ({ bridge_ready: false }) }, authenticate: async () => ({ plan: 'pro' }) });
  const app = await createApp({ watcher, port: 0, savePreferences: async value => { saved = { ...saved, ...value }; } });
  t2.after(() => app.close());
  const post = (path, body) => fetch(app.url + path, { method: 'POST', headers: { Origin: app.url }, body: JSON.stringify(body) });
  const response = await post('/api/language', { language: 'en' });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).language, 'en');
  assert.equal(saved.language, 'en');
  const html = await (await fetch(app.url)).text();
  assert.match(html, /id="language"/);
  assert.match(html, /A word while you play\./);
  const bad = await post('/api/language', { language: 'fr' });
  assert.equal((await bad.json()).language, 'ja', 'unknown languages fall back to Japanese');
  await post('/api/start', { frequency: 'balanced', includedOnlyConfirmed: true, language: 'en' });
  assert.equal(watcher.running, true);
  const refused = await post('/api/language', { language: 'ja' });
  assert.equal(refused.status, 400);
  assert.match((await refused.json()).error, /cannot be changed while watching|見守り中は言語を変更できません/);
  assert.equal(watcher.running, true, 'a refused language change must not stop watching');
  await post('/api/stop', {});
});

test('enemy names: the game\'s own names are used, in English as official, shared, or romanized "soldier" names', () => {
  assert.equal(englishName(129, 'ガザック'), 'Gazzak');
  assert.equal(englishName(133, 'ガルダへい'), 'Garuda soldier');
  assert.equal(englishName(131, 'グルニアへい'), 'Gurunia soldier');
  assert.equal(englishName(176, 'カチュア'), 'Catria', 'a character who is also in our army keeps one English name');
  assert.equal(englishName(154, 'ミシェイル'), 'Michalis');
  assert.equal(englishName(163, 'くろきしだん'), 'Kurokishidan');
  const source = snapshot([unit('player:0', 'player', { character_id: 4, name: 'カイン' }), unit('enemy:0', 'enemy', { character_id: 133, name: 'ガルダへい', class_name: 'かいぞく' })]);
  const converted = localizeSnapshot(source).game_state.units[1];
  assert.equal(converted.name, 'Garuda soldier');
  assert.equal(converted.name_ja, 'ガルダへい');
  assert.equal(converted.class_name, 'Pirate');
  // The dialogue is Japanese: "ガルダへい" in a conversation still matches the units by their Japanese name.
  const [found] = mentionedUnits(['ガルダへいがこっちにきたぞ'], localizeSnapshot(source).game_state);
  assert.equal(found.name, 'Garuda soldier');
});
