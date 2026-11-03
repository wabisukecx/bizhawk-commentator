import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
const client = new Client({ name: 'bizhawk-connection-check', version: '0.1.0' });
try {
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL('../src/index.js', import.meta.url))],
    env: { ...process.env },
  }));
  let session = await client.callTool({ name: 'get_session_info' });
  if (process.argv.includes('--wait')) {
    console.log('Waiting up to 60 seconds. Launch BizHawk with the socket options and lua/bridge.lua now.');
    const deadline = Date.now() + 60_000;
    while (!session.isError && !JSON.parse(session.content[0].text).bridge_ready && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 500));
      session = await client.callTool({ name: 'get_session_info' });
    }
  }
  console.log(JSON.stringify(session, null, 2));
  if (process.argv.includes('--capture')) {
    const result = await client.callTool({ name: 'get_game_context' });
    console.log(JSON.stringify({ ...result, content: result.content.map(item => item.type === 'image' ? { ...item, data: `[PNG base64: ${item.data.length} characters]` } : item) }, null, 2));
    if (result.isError) process.exitCode = 1;
  }
} finally {
  await client.close();
}
