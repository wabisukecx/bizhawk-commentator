import { readFile, writeFile, copyFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const configPath = process.argv[2] ?? path.join(process.env.APPDATA, 'Claude', 'claude_desktop_config.json');
const entry = {
  command: process.execPath,
  args: [fileURLToPath(new URL('../src/index.js', import.meta.url))],
  env: { BIZHAWK_PORT: '8766' },
};
let config = {};
let exists = true;
try { config = JSON.parse((await readFile(configPath, 'utf8')).replace(/^\uFEFF/, '')); }
catch (error) { if (error.code === 'ENOENT') exists = false; else throw error; }
if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Invalid Claude configuration');
if (config.mcpServers !== undefined && (!config.mcpServers || typeof config.mcpServers !== 'object' || Array.isArray(config.mcpServers))) {
  throw new Error('Invalid mcpServers configuration');
}
if (JSON.stringify(config.mcpServers?.['bizhawk-commentator']) === JSON.stringify(entry)) {
  console.log('BizHawk Commentator is already registered.');
} else {
  if (exists) {
    const backup = `${configPath}.backup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    await copyFile(configPath, backup);
    console.log(`Backup: ${backup}`);
  }
  config.mcpServers = { ...config.mcpServers, 'bizhawk-commentator': entry };
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
  console.log(`Registered: ${configPath}`);
}
