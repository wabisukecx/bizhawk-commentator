import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { once } from 'node:events';
import { writeFile, access } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { FrameDecoder, encodeFrame } from '../src/bridge.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII=', 'base64');

test('concurrent MCP processes share one bridge, survive owner exit, return PNGs and clean up', async t => {
  const probe = net.createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const clients = Array.from({ length: 3 }, (_, i) => new Client({ name: `test-${i}`, version: '1.0' }));
  let client = clients[0];
  const transports = clients.map(() => new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL('../src/index.js', import.meta.url))],
    env: { ...process.env, BIZHAWK_PORT: String(port), BIZHAWK_SERVICE_IDLE_MS: '200' },
    stderr: 'pipe',
  }));
  let stderr = '';
  transports.forEach(transport => transport.stderr.on('data', data => { stderr += data; }));
  t.after(() => Promise.all(clients.map(item => item.close())));
  await Promise.all(clients.map((item, i) => item.connect(transports[i])));
  const allSessions = await Promise.all(clients.map(item => item.callTool({ name: 'get_session_info' })));
  const brokerPids = allSessions.map(item => JSON.parse(item.content[0].text).broker_pid);
  assert.equal(new Set(brokerPids).size, 1, 'All three processes must share one broker');
  assert.equal((await client.listTools()).tools.length, 3);
  const session = await client.callTool({ name: 'get_session_info' });
  assert.equal(JSON.parse(session.content[0].text).bridge_ready, false);
  const offline = await client.callTool({ name: 'get_game_context' });
  assert.equal(offline.isError, true);
  assert.match(offline.content[0].text, /not ready/);

  const socket = net.createConnection({ port, host: '127.0.0.1' });
  await once(socket, 'connect');
  t.after(() => socket.destroy());
  const decoder = new FrameDecoder();
  let capturePath;
  let badImage = false;
  let peerError;
  // The production server destroys its TCP socket during MCP shutdown.
  // Windows can report ECONNRESET on the simulated peer at that point.
  socket.on('error', error => { peerError = error; });
  const info = {
    frame: 123, frame_after_capture: 123, rom_name: 'テスト', rom_hash: 'test-hash', system: 'NES',
    game_state: { profile_id: 'transport-fixture', phase: 'custom-turn', units: [{ key: 'entity:0', hp: 18, x: 25, y: 6 }] },
    game_logs: { custom: [{ id: 1, value: 'record' }] },
    profile_status: 'supported', recent_observations: { events: {}, timeline_id: 'test:1' },
  };
  socket.on('data', async chunk => {
    try {
      for (const message of decoder.push(chunk)) {
        let response = 'READY';
        if (message !== 'NONE') {
          const command = JSON.parse(message);
          if (command.method === 'get_context') {
            capturePath = command.params.screenshot_path;
            await writeFile(capturePath, badImage ? Buffer.from('invalid') : png);
          }
          response = 'RESULT ' + JSON.stringify({ id: command.id, result: command.method === 'get_recent_events' ? { events: [], timeline_id: 'test:1' } : info });
        }
        setTimeout(() => { if (!socket.destroyed) socket.write(encodeFrame(response)); }, 5);
      }
    } catch (error) { peerError = error; socket.destroy(); }
  });
  socket.write(encodeFrame('READY'));
  // The first tool may reach the server before TCP READY: retry only readiness.
  let ready;
  for (let i = 0; i < 20; i++) {
    ready = await client.callTool({ name: 'get_session_info' });
    if (JSON.parse(ready.content[0].text).bridge_ready) break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(JSON.parse(ready.content[0].text).emulator.rom_name, 'テスト');
  const result = await client.callTool({ name: 'get_game_context' });
  assert.notEqual(result.isError, true, JSON.stringify(result));
  assert.equal(JSON.parse(result.content[0].text).frame, 123);
  const metadata = JSON.parse(result.content[0].text);
  assert.equal(metadata.game_state.units[0].hp, 18);
  assert.equal(metadata.game_state.phase, 'custom-turn', 'the host must not overwrite game-specific state');
  assert.deepEqual(metadata.game_logs, info.game_logs);
  assert.deepEqual(metadata.recent_observations.events, []);
  assert.ok(!metadata.limitations.includes('image_only'));
  assert.equal(result.content[1].type, 'image');
  assert.deepEqual(Buffer.from(result.content[1].data, 'base64'), png);
  await assert.rejects(access(capturePath), { code: 'ENOENT' });
  const concurrent = await Promise.all(clients.map(item => item.callTool({ name: 'get_game_context' })));
  assert.ok(concurrent.every(item => !item.isError && item.content[1].data === png.toString('base64')));
  const captures = concurrent.map(item => JSON.parse(item.content[0].text).observation_id);
  assert.equal(new Set(captures).size, 3);
  // Closing the first adapter must not stop the broker or emulator connection.
  await client.close();
  client = clients[1];
  const surviving = await client.callTool({ name: 'get_session_info' });
  assert.equal(JSON.parse(surviving.content[0].text).broker_pid, brokerPids[0]);
  assert.equal(JSON.parse(surviving.content[0].text).bridge_ready, true);
  badImage = true;
  assert.equal((await client.callTool({ name: 'get_game_context' })).isError, true);
  await assert.rejects(access(capturePath), { code: 'ENOENT' });
  assert.equal((await client.callTool({ name: 'get_game_context', arguments: { path: 'arbitrary' } })).isError, true);
  assert.equal((await client.callTool({ name: 'write_memory' })).isError, true);
  assert.match((await client.getPrompt({ name: 'commentate' })).messages[0].content.text, /get_game_context/);
  const events = await client.callTool({ name: 'get_recent_events' });
  assert.deepEqual(JSON.parse(events.content[0].text).events, []);
  assert.equal(peerError, undefined);
  await Promise.all(clients.map(item => item.close()));
  // Once every adapter closes, the shared service exits after its idle grace.
  await new Promise(resolve => setTimeout(resolve, 500));
  const after = net.createServer();
  await new Promise((resolve, reject) => { after.once('error', reject); after.listen(port, '127.0.0.1', resolve); });
  await new Promise(resolve => after.close(resolve));
  assert.match(stderr, /Ready/);
  assert.doesNotMatch(stderr, /EADDRINUSE/);
});

test('an unrelated occupied TCP port is reported as a tool error without crashing MCP', async t => {
  const occupied = net.createServer();
  occupied.listen(0, '127.0.0.1');
  await once(occupied, 'listening');
  t.after(() => new Promise(resolve => occupied.close(resolve)));
  const client = new Client({ name: 'occupied-port-test', version: '1.0' });
  t.after(() => client.close());
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL('../src/index.js', import.meta.url))],
    env: { ...process.env, BIZHAWK_PORT: String(occupied.address().port), BIZHAWK_SERVICE_IDLE_MS: '200' },
    stderr: 'pipe',
  }));
  assert.equal((await client.listTools()).tools.length, 3);
  const status = await client.callTool({ name: 'get_session_info' });
  assert.match(JSON.parse(status.content[0].text).startup_error, /occupied/);
  const capture = await client.callTool({ name: 'get_game_context' });
  assert.equal(capture.isError, true);
  assert.match(capture.content[0].text, /occupied/);
});
