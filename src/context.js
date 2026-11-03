import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const commentaryInstructions = `あなたは一緒にゲームを見る日本語の相棒です。
普段の返答は自然な会話の1〜2文。今の場面で気になったことや小さな発見を一つだけ話してください。
HP・座標・EXP・フレーム番号は判断の裏付けに使い、頼まれない限り一覧や報告書の形で読み上げないでください。
数値、詳しい説明、比較、攻略を質問された場合は、その質問に必要な具体的な内容を答えてください。
プレイヤーが考えたり操作を止めたりしていても、経過フレームや変化がないことだけを理由に進行を促さないでください。
攻略の提案や先回りは求められたときに。過去の履歴を毎回繰り返さず、今回の質問や新しい変化に反応してください。
親しみは自然な口調で表現してください。配置・HP・動きだけから、キャラクターの感情、性格、意図や内面を想像して付け足さないでください。
例えば、味方から離れた配置を「心細そう」「寂しそう」「勇敢だ」と表現せず、「ほかの味方から少し離れたね」のように観測できることを話してください。感情に触れるのは、実際の台詞や明示された設定が根拠になる場合だけです。
このMCPチャットでは、ツールを呼び出した時点の情報を取得します。別の字幕アプリは見守り開始中に自動コメントを生成しますが、このチャット自身からの常時監視や自動通知を約束しないでください。
「動きがあったら声をかけます」「見張っておきます」など、常時監視や自動通知を約束しないでください。次回の確認に触れるなら「次に画面を確認したとき、あの辺りも見てみるね」のように、次のツール取得が必要なことが伝わる言い方にしてください。
画面や取得データで確認できた事実と推測を区別してください。分からない因果関係は断定せず、必要なら短く自然な言い方で伝えてください。
未取得のHP、敵の思考ルール、命中率などを作らないでください。ネタバレは求められた場合だけ。
画像は取得時点の静止画です。取得後の進行を決めつけないでください。静止画であることの定型的な注意書きは毎回付けず、時点の違いが回答に影響するときに説明してください。
game_stateがある場合はRAMから取得したHP・座標などを画像の読取りより優先してください。
RAMのマップ情報は会話やメニュー中にも残るため、画像と照合して現在の場面を判断してください。
recent_observationsはゲームパックの観測結果です。取得項目と制約に従って解釈し、記録されていない出来事や因果関係を補わないでください。
observer_session_idやtimeline_idが変わったら、過去の履歴と混ぜないでください。このMCPサーバー自体は音声を出力しません。自動字幕アプリはブラウザの音声合成で読み上げます。
「なぜその敵が狙ったか」は画像だけでは断定できません。
ゲーム固有の名前や数値は、取得したデータにあるものだけを使ってください。`;

export function normalizeObservations(value) {
  if (!value) return null;
  // BizHawk Lua's JSON helper encodes an empty table as {}, including empty lists.
  const events = Array.isArray(value.events) ? value.events
    : value.events && typeof value.events === 'object' && Object.keys(value.events).length === 0 ? [] : null;
  if (!events) throw new Error('Invalid observation history from BizHawk');
  return { ...value, events };
}

function buildMetadata(snapshot, requestedAt) {
  return {
    observation_id: randomUUID(),
    requested_at: requestedAt,
    received_at: new Date().toISOString(),
    ...snapshot,
    game_state: snapshot.game_state ?? null,
    profile_status: snapshot.profile_status ?? 'bridge_update_required',
    recent_observations: normalizeObservations(snapshot.recent_observations),
    game_logs: snapshot.game_logs ?? {},
    limitations: snapshot.game_state
      ? ['sampled_event_history', 'game_profile_interpretation']
      : ['image_only', 'no_validated_state_for_current_scene'],
  };
}

// Screenshot-free variant used by the subtitle app's frequent polling.
export async function captureState(bridge) {
  const requestedAt = new Date().toISOString();
  const snapshot = await bridge.call('get_state');
  if (!snapshot || !Number.isInteger(snapshot.frame) || !snapshot.rom_hash) {
    throw new Error('Invalid snapshot metadata received from BizHawk');
  }
  return { metadata: buildMetadata(snapshot, requestedAt) };
}

export async function captureContext(bridge) {
  const dir = await mkdtemp(path.join(tmpdir(), 'bizhawk-commentator-'));
  const screenshotPath = path.join(dir, 'screen.png');
  const requestedAt = new Date().toISOString();
  try {
    const snapshot = await bridge.call('get_context', { screenshot_path: screenshotPath });
    if (!snapshot || !Number.isInteger(snapshot.frame) || !snapshot.rom_hash) {
      throw new Error('Invalid snapshot metadata received from BizHawk');
    }
    if (snapshot.frame_after_capture !== snapshot.frame) {
      throw new Error('The game advanced during capture; please request a fresh context');
    }
    const info = await stat(screenshotPath);
    if (info.size > 8 * 1024 * 1024) throw new Error('Screenshot exceeds 8 MiB');
    const png = await readFile(screenshotPath);
    if (!png.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
      throw new Error('BizHawk did not produce a PNG screenshot');
    }
    return {
      metadata: buildMetadata(snapshot, requestedAt),
      image: { type: 'image', mimeType: 'image/png', data: png.toString('base64') },
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
