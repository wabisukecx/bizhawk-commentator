import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { once } from 'node:events';
import { Bridge, FrameDecoder, encodeFrame } from '../src/bridge.js';

test('length framing survives every UTF-8 byte split and coalesced frames', () => {
  const decoder = new FrameDecoder();
  const messages = [];
  const input = Buffer.concat([encodeFrame('RESULT {"name":"マルス"}'), encodeFrame('READY')]);
  for (const byte of input) messages.push(...decoder.push(Buffer.from([byte])));
  assert.deepEqual(messages, ['RESULT {"name":"マルス"}', 'READY']);
  assert.throws(() => new FrameDecoder().push(Buffer.from('99999999 ')), /too large/);
});

test('bridge serializes requests and rejects pending requests on disconnect', async t => {
  const bridge = new Bridge({ port: 0, timeoutMs: 1000 });
  await bridge.start();
  t.after(() => bridge.stop());
  const socket = net.createConnection({ port: bridge.port, host: '127.0.0.1' });
  await once(socket, 'connect');
  t.after(() => socket.destroy());
  const decoder = new FrameDecoder();
  const responses = [];
  socket.on('data', chunk => responses.push(...decoder.push(chunk)));
  socket.write(encodeFrame('READY'));
  await waitFor(() => bridge.ready && responses.length);
  assert.equal(responses.shift(), 'NONE');
  const first = bridge.call('get_info');
  const second = bridge.call('get_context');
  socket.write(encodeFrame('READY'));
  await waitFor(() => responses.length);
  const command = JSON.parse(responses.shift());
  assert.equal(command.method, 'get_info');
  socket.write(encodeFrame('RESULT ' + JSON.stringify({ id: command.id, result: { name: '日本語' } })));
  assert.deepEqual(await first, { name: '日本語' });
  await waitFor(() => responses.length);
  assert.equal(JSON.parse(responses.shift()).method, 'get_context');
  const rejected = assert.rejects(second, /disconnected/);
  socket.destroy();
  await rejected;
  assert.equal(bridge.ready, false);
});

test('timed out requests cannot be dispatched on a later session', async t => {
  const bridge = new Bridge({ port: 0, timeoutMs: 30 });
  await bridge.start();
  t.after(() => bridge.stop());
  const socket = net.createConnection({ port: bridge.port, host: '127.0.0.1' });
  await once(socket, 'connect');
  t.after(() => socket.destroy());
  socket.write(encodeFrame('READY'));
  await waitFor(() => bridge.ready);
  await assert.rejects(bridge.call('get_info'), /timed out/);
  assert.equal(bridge.queue.length, 0);
});

async function waitFor(condition) {
  for (let i = 0; i < 100; i++) {
    if (condition()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('Test peer did not respond');
}
