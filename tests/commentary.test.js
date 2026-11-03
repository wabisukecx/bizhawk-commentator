import test from 'node:test';
import assert from 'node:assert/strict';
import { addsAnalysis, buildCommentaryInstructions } from '../app/prompts.js';
import { localizedTone } from '../app/tones.js';
import { Watcher } from '../app/watcher.js';
import { setLanguage } from '../app/i18n.js';

test.afterEach(() => setLanguage('ja'));

test('generic praise and defeat restatements alone are silent; grounded additions can keep their opening reaction', () => {
  for (const text of [
    'マジがガルダへいを仕留めました。きれいな決まり方でした。',
    'バーツ、見事に仕留めました。これは大きな一撃です。',
    'やった、ついに仕留めた！',
    'Maji finishes off the Garuda soldier. A clean finish.',
    'Jagen takes down Garuda soldier. What a big hit!',
    '',
  ]) assert.equal(addsAnalysis(text), false, text);
  for (const text of [
    '敵の消耗が大きい一方、味方のHPはよく残っています。',
    '敵数は減っていますが、サジの消耗はまだ残っています。',
    'やった！敵は減ったけれど、サジの消耗は残っているね。',
    'The enemy line has thinned, but Saji is still hurt.',
    'Great hit! Our losses have stayed small while the enemy line has thinned.',
  ]) assert.equal(addsAnalysis(text), true, text);
});

test('analysis instructions preserve the selected tone and allow silence, in Japanese and English', () => {
  const japanese = buildCommentaryInstructions('', { tone: localizedTone('announcer'), intensity: 'high' });
  assert.match(japanese, /直近の流れ/);
  assert.match(japanese, /補足できる意味がなければspeak=false/);
  assert.match(japanese, /落ち着いた丁寧語/);
  const english = buildCommentaryInstructions('', { tone: localizedTone('announcer', 'en'), language: 'en' });
  assert.match(english, /Your role is analysis/);
  assert.match(english, /set speak=false/);
  assert.match(english, /calm, clear, and formal/);
});

const ally = { key: 'player:0', side: 'player', character_id: 11, name: 'マジ', class_name: 'せんし', hp: 20, max_hp: 20, x: 5, y: 5 };
const enemy = { key: 'enemy:0', side: 'enemy', character_id: 133, name: 'ガルダへい', class_name: 'かいぞく', hp: 18, max_hp: 18, x: 6, y: 5 };
const fight = { id: 1, frame: 200, order_flag_raw: 0, follow_up: 0, after: { level: 1 },
  attacker: { pid: 11, name: 'マジ', class_name: 'せんし', level: 1, hp: 20, hp_after: 20, max_hp: 20 },
  defender: { pid: 133, name: 'ガルダへい', class_name: 'かいぞく', level: 1, hp: 18, hp_after: 0, max_hp: 18 } };
const snapshot = (units, log = []) => ({ game_state: { profile_id: 'fe1-jp-v1', chapter: 2, turn: 5, units },
  recent_observations: { timeline_id: 'flow:1', events: [] }, battle_log: log });

test('poll delivers fixed narration first and supplies before/after facts; an empty model addition is discarded', async t => {
  let now = 0, current = snapshot([ally, enemy]), payload, options;
  const watcher = new Watcher({ tone: 'announcer', clock: () => now, includedOnlyConfirmed: true,
    bridge: { call: async method => method === 'get_session_info' ? { bridge_ready: true } : { metadata: current }, close() {} },
    authenticate: async () => ({ plan: 'pro' }),
    generate: async (input, config) => { payload = input; options = config; return { speak: true, comment: 'マジがガルダへいを仕留めました。きれいな決まり方でした。' }; } });
  t.after(() => watcher.stop());
  await watcher.start('lively', { includedOnlyConfirmed: true });
  await watcher.poll();
  now = 2500; current = snapshot([ally], [fight]); await watcher.poll();
  assert.equal(watcher.history.length, 1);
  assert.equal(watcher.history[0].kind, 'play');
  assert.match(watcher.history[0].text, /マジがガルダへいを撃破しました/);
  now = 5000; await watcher.poll();
  assert.equal(payload.recent_flow.before.units.length, 2);
  assert.equal(payload.recent_flow.after.units.length, 1);
  assert.equal(payload.recent_narration[0].text, watcher.history[0].text);
  assert.match(options.instructions, /解説役/);
  assert.equal(watcher.history.length, 1, 'no extra subtitle for a result plus generic praise');
  assert.equal(watcher.calls.length, 1);
  assert.equal(watcher.running, true, 'silence does not stop monitoring');
});

test('a model can choose silence or add a flow comparison without changing the fixed narration', async t => {
  for (const speak of [false, true]) {
    let now = 0;
    const watcher = new Watcher({ tone: 'announcer', clock: () => now, includedOnlyConfirmed: true,
      authenticate: async () => ({ plan: 'pro' }),
      generate: async () => ({ speak, comment: speak ? '敵数は減っていますが、味方にも消耗が残っています。' : '' }) });
    t.after(() => watcher.stop());
    await watcher.start('lively', { includedOnlyConfirmed: true });
    watcher.accept(snapshot([ally, enemy]));
    now = 2500; watcher.accept(snapshot([ally], [fight])); watcher.maybePlay();
    now = 5000; await watcher.maybeGenerate();
    assert.equal(watcher.history.filter(item => item.kind === 'play').length, 1);
    assert.equal(watcher.history.filter(item => item.kind === 'comment').length, speak ? 1 : 0);
  }
});
