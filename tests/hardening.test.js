import test from 'node:test';
import assert from 'node:assert/strict';
import { parseComment } from '../app/claude.js';
import { reviewComment } from '../game-pack-sources/fe1-jp-v1/app/fe1.js';
import { captureState } from '../src/context.js';

test('parseComment rejects over-long, multi-line and empty spoken captions', () => {
  assert.equal(parseComment({ structured_output: { speak: true, comment: 'あ'.repeat(180) } }).comment.length, 180);
  assert.throws(() => parseComment({ structured_output: { speak: true, comment: 'あ'.repeat(181) } }), /長すぎ/);
  assert.throws(() => parseComment({ structured_output: { speak: true, comment: '一行目\n二行目' } }), /長すぎ/);
  assert.throws(() => parseComment({ structured_output: { speak: 'yes', comment: 'x' } }), /形式/);
  assert.deepEqual(parseComment({ result: '{"speak":true,"comment":" こんにちは "}' }), { speak: true, comment: 'こんにちは' });
});

test('reviewComment blocks unsupported certainty and emotion phrases only', () => {
  for (const text of ['もう一度当てられたね', 'ここは安全だね', 'あと一撃で倒せる', '反撃されないはず', '心細そう', '敵がいないね'])
    assert.equal(reviewComment(text), false, text);
  assert.equal(reviewComment('アベルがドーガに追いついたね。'), true);
});

test('captureState returns normalized metadata without a screenshot request', async () => {
  let params;
  const bridge = { call: async (method, p) => { params = [method, p]; return { frame: 5, rom_hash: 'H', game_state: null, recent_observations: { events: {} } }; } };
  const { metadata } = await captureState(bridge);
  assert.equal(params[0], 'get_state');
  assert.equal(params[1], undefined);
  assert.deepEqual(metadata.recent_observations.events, []);
  assert.equal(metadata.profile_status, 'bridge_update_required');
  await assert.rejects(captureState({ call: async () => ({}) }), /Invalid snapshot/);
});
