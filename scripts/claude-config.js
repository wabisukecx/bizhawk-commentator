import { fileURLToPath } from 'node:url';
const serverPath = fileURLToPath(new URL('../src/index.js', import.meta.url));
console.log(JSON.stringify({ mcpServers: { 'bizhawk-commentator': {
  command: process.execPath, args: [serverPath], env: { BIZHAWK_PORT: '8766' },
} } }, null, 2));
