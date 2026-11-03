import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { once } from 'node:events';
import { SharedClient, brokerEndpoint } from '../src/shared-client.js';
import { FrameDecoder, encodeFrame } from '../src/bridge.js';

async function existingService(t, health) {
  const probe = net.createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const sockets = new Set();
  const server = net.createServer(socket => {
    sockets.add(socket);
    socket.on('error', () => {});
    socket.on('close', () => sockets.delete(socket));
    const decoder = new FrameDecoder();
    socket.on('data', chunk => {
      for (const message of decoder.push(chunk)) {
        const request = JSON.parse(message);
        const result = request.method === 'health' ? health
          : { connected: false, bridge_ready: false, service_version: health.service_version, broker_pid: process.pid };
        socket.write(encodeFrame(JSON.stringify({ id: request.id, result })));
      }
    });
  });
  const client = new SharedClient(port);
  t.after(async () => {
    client.close();
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
  });
  server.listen(brokerEndpoint(port));
  await once(server, 'listening');
  return { client, server };
}

test('an updated client reuses a compatible 0.2.2 service without stopping existing MCP sessions', async t => {
  const { client, server } = await existingService(t, { protocol: 1, service_version: '0.2.2', broker_pid: process.pid });
  await client.start();
  const status = await client.call('get_session_info');
  assert.equal(status.service_version, '0.2.2');
  assert.equal(status.broker_pid, process.pid);
  assert.equal(status.bridge_ready, false);
  client.close();
  assert.equal(server.listening, true, 'the older broker remains available to its other clients');
});

test('unknown service versions and incompatible wire protocols still fail clearly', async t => {
  for (const health of [
    { protocol: 1, service_version: '0.2.1' },
    { protocol: 1, service_version: '99.0.0' },
    { protocol: 2, service_version: '0.3.0' },
  ]) {
    const { client } = await existingService(t, health);
    await assert.rejects(client.start(), /旧版の共有サービス|Incompatible shared/);
  }
});
