// App messages in Japanese and English. The language is one app-wide setting (the control page chooses it,
// and it also decides the commentary, the instructions given to Claude and the speech voice).
export const languages = Object.freeze({ ja: { label: '日本語' }, en: { label: 'English' } });
let current = 'ja';

export function normalizeLanguage(value) { return Object.hasOwn(languages, value) ? value : 'ja'; }
export function setLanguage(value) { current = normalizeLanguage(value); }
export function getLanguage() { return current; }

const catalog = {
  idle: { ja: '見守りを開始すると、ゲームの変化に時々反応します。', en: 'Start watching and I will react to changes in the game now and then.' },
  badFrequency: { ja: '発言頻度を選び直してください。', en: 'Please choose how often to speak again.' },
  confirmUsage: { ja: 'サブスク内で使うため、Claudeの「設定 → 使用量」で追加使用量をオフにしたことを確認してください。', en: 'To stay within your subscription, confirm that extra usage is turned off in Claude under Settings > Usage.' },
  watching: { ja: '見守り中。新しい動きがあったら、時々コメントします。', en: 'Watching. I will comment now and then when something new happens.' },
  stopped: { ja: '見守りを停止しました。', en: 'Stopped watching.' },
  waitingBizHawk: { ja: 'BizHawkの接続を待っています。', en: 'Waiting for BizHawk to connect.' },
  disconnectedStop: { ja: '接続が切れたため停止しました。接続を確認して、もう一度開始してください。', en: 'Stopped because the connection was lost. Check the connection and start again.' },
  checkBizHawk: { ja: 'BizHawkへの接続を確認してください。', en: 'Please check the connection to BizHawk.' },
  waitingMap: { ja: 'RAMを読み取れるマップ画面を待っています。', en: 'Waiting for a map screen whose RAM can be read.' },
  unsupportedGame: { ja: 'このゲームの自動コメントはまだ対応していません。', en: 'Automatic commentary is not supported for this game yet.' },
  waitingChange: { ja: '見守り中。ここからの新しい変化を待っています。', en: 'Watching. Waiting for new changes from here.' },
  hourlyLimit: { ja: 'このアプリの1時間あたりの回数上限に達しました。時間を置いて再開してください。', en: 'Reached this app\'s hourly limit. Wait a while and start again.' },
  thinking: { ja: '変化を見て、ひとこと考えています。', en: 'Thinking of something to say about that.' },
  staleReply: { ja: '状況が変わったので、古くなったコメントは表示しませんでした。', en: 'The situation changed, so the outdated comment was not shown.' },
  quietWhileIdle: { ja: '見守り中。変化がない間は静かにしています。', en: 'Watching. Quiet while nothing changes.' },
  controlPageClosed: { ja: '操作画面が閉じられたため、見守りを停止しました。', en: 'The control page was closed, so watching stopped.' },
  localOnly: { ja: 'このPCのローカル画面から操作してください。', en: 'Please use the local page on this PC.' },
  sameOriginOnly: { ja: 'この画面から操作してください。', en: 'Please use this page.' },
  busySwitching: { ja: '切り替え中です。少し待ってください。', en: 'Switching. Please wait a moment.' },
  inputTooLong: { ja: '入力が長すぎます。', en: 'The input is too long.' },
  notFound: { ja: '見つかりません。', en: 'Not found.' },
  badPort: { ja: 'ポート番号を確認してください。', en: 'Please check the port numbers.' },
  cannotChangeWhileRunning: { ja: '見守り中は言語を変更できません。', en: 'The language cannot be changed while watching.' },
  claudeTimeout: { ja: 'Claudeの応答が時間内に完了しませんでした。見守りを停止しました。', en: 'Claude did not answer in time. Watching stopped.' },
  generationAborted: { ja: '生成を中止しました。', en: 'Generation was cancelled.' },
  claudeTooLong: { ja: 'Claudeの応答が長すぎます。', en: 'Claude\'s answer was too long.' },
  claudeFailed: { ja: 'Claude Codeの実行に失敗しました。ログイン状態や利用上限を確認してください。', en: 'Claude Code failed to run. Check that you are logged in and have not hit a usage limit.' },
  claudeUnreadable: { ja: 'Claude Codeから応答を読み取れませんでした。', en: 'Could not read a response from Claude Code.' },
  loginRequired: { ja: 'Claudeのサブスクでのログインが必要です。PowerShellで claude auth login を実行してください。', en: 'You need to be logged in with a Claude subscription. Run claude auth login in PowerShell.' },
  claudeIncomplete: { ja: 'Claudeが処理を完了できませんでした。利用上限やログイン状態を確認してください。', en: 'Claude could not finish. Check your usage limit and login.' },
  badCaptionFormat: { ja: '字幕の形式を読み取れませんでした。', en: 'Could not read the caption format.' },
  captionTooLong: { ja: '字幕が長すぎます。', en: 'The caption is too long.' },
  captionEmpty: { ja: '字幕が空でした。', en: 'The caption was empty.' },
  modelNotConfirmed: { ja: '{label}の利用を応答情報から確認できなかったため停止しました。', en: 'Stopped because use of {label} could not be confirmed from the response.' },
  badModel: { ja: 'AIモデルを選び直してください。', en: 'Please choose the AI model again.' },
  badTone: { ja: '口調を選び直してください。', en: 'Please choose the tone again.' },
  chapterTurn: { ja: '第{chapter}章・ターン{turn}', en: 'Chapter {chapter}, Turn {turn}' },
};

export function t(key, vars = {}, language = current) {
  const entry = catalog[key];
  if (!entry) throw new Error(`Unknown message key: ${key}`);
  return entry[language].replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? ''));
}
