import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, ListPromptsRequestSchema, GetPromptRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { SharedClient } from './shared-client.js';
import { commentaryInstructions } from './context.js';

const port = Number(process.env.BIZHAWK_PORT ?? 8766);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('BIZHAWK_PORT must be 1–65535');
const shared = new SharedClient(port);
await shared.start();
const server = new Server({ name: 'bizhawk-commentator', version: '0.3.0' }, {
  capabilities: { tools: {}, prompts: {} },
  instructions: commentaryInstructions,
});

const emptyInput = { type: 'object', properties: {}, additionalProperties: false };
const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false };
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [
  { name: 'get_session_info', description: 'BizHawkとの接続状態と、接続時はROM・システム・利用可能な取得機能を返します。未接続でも呼べます。', inputSchema: emptyInput, annotations },
  { name: 'get_game_context', description: '現在のゲーム画面をPNG画像として、同じLua処理内で取得したROM情報・フレーム番号と一緒に返します。対応ROMではRAM由来のHP・座標・章・ターン、最近の観測差分も含みます。未対応の版・未初期化の場面では画像だけに戻ります。ゲーム入力や一時停止はしません。', inputSchema: emptyInput, annotations },
  { name: 'get_recent_events', description: 'Luaスクリプトが約15エミュレーションフレームごとに記録したHP・座標・章・ターンの差分を最大128件返します。セーブステート読込や巻戻しでは履歴を区切ります。攻撃者や敵の意図、サンプル間の一瞬の変化は特定しません。画像が必要ならget_game_contextを使ってください。', inputSchema: emptyInput, annotations },
] }));
server.setRequestHandler(CallToolRequestSchema, async request => {
  try {
    if (Object.keys(request.params.arguments ?? {}).length) throw new Error('This tool takes no arguments');
    if (request.params.name === 'get_session_info') {
      const data = await shared.call('get_session_info');
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
    if (request.params.name === 'get_game_context') {
      const context = await shared.call('get_game_context');
      return { content: [
        { type: 'text', text: JSON.stringify(context.metadata, null, 2) },
        context.image,
        { type: 'text', text: commentaryInstructions },
      ] };
    }
    if (request.params.name === 'get_recent_events') {
      const events = await shared.call('get_recent_events');
      return { content: [{ type: 'text', text: JSON.stringify(events, null, 2) }] };
    }
    throw new Error('Unknown tool');
  } catch (error) {
    return { isError: true, content: [{ type: 'text', text: error.message }] };
  }
});
server.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: [
  { name: 'commentate', description: '画面とRAM情報を裏付けに、相棒として気になったことを日本語で1〜2文話す' },
] }));
server.setRequestHandler(GetPromptRequestSchema, async request => {
  if (request.params.name !== 'commentate') throw new Error('Unknown prompt');
  return { messages: [{ role: 'user', content: { type: 'text', text: commentaryInstructions + '\nget_game_contextを呼び、今の場面で気になったことを相棒として1〜2文話してください。数値の一覧や進行の催促は不要です。' } }] };
});

let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  shared.close();
  await server.close();
}
process.stdin.on('end', () => { void shutdown(); });
process.on('SIGINT', () => { void shutdown(); });
process.on('SIGTERM', () => { void shutdown(); });
await server.connect(new StdioServerTransport());
process.stderr.write(`[bizhawk-commentator] Ready. BizHawk target: 127.0.0.1:${port}\n`);
