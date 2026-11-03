import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('Claude registration backs up and preserves existing settings, and is idempotent', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'bizhawk-config-test-'));
  try {
    const target = path.join(dir, 'config.json');
    const original = { mcpServers: { existing: { command: 'keep-this' } }, preferences: { theme: 'dark' } };
    const text = JSON.stringify(original);
    await writeFile(target, text);
    const script = fileURLToPath(new URL('../scripts/register-claude.js', import.meta.url));
    const run = () => spawnSync(process.execPath, [script, target], { encoding: 'utf8' });
    assert.equal(run().status, 0);
    const config = JSON.parse(await readFile(target, 'utf8'));
    assert.deepEqual(config.mcpServers.existing, original.mcpServers.existing);
    assert.deepEqual(config.preferences, original.preferences);
    assert.equal(config.mcpServers['bizhawk-commentator'].command, process.execPath);
    const backup = (await readdir(dir)).find(file => file.includes('.backup-'));
    assert.equal(await readFile(path.join(dir, backup), 'utf8'), text);
    assert.equal(run().status, 0);
    assert.equal((await readdir(dir)).length, 2);
    await writeFile(target, '{invalid');
    assert.notEqual(run().status, 0);
    assert.equal(await readFile(target, 'utf8'), '{invalid');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
