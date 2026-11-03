import net from 'node:net';
import { Bridge, FrameDecoder, encodeFrame } from './bridge.js';
import { captureContext, captureState, normalizeObservations } from './context.js';
import { brokerEndpoint } from './shared-client.js';
import { SERVICE_VERSION } from './version.js';
import { prepareGamePacks } from './game-packs.js';

const port = Number(process.env.BIZHAWK_PORT ?? 8766);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid BIZHAWK_PORT');
const idleMs = Number(process.env.BIZHAWK_SERVICE_IDLE_MS ?? 15000);
if (!Number.isInteger(idleMs) || idleMs < 100 || idleMs > 60000) throw new Error('Invalid service idle timeout');
await prepareGamePacks();
const bridge = new Bridge({ port });
const peers = new Set();
let idleTimer;
let stopping = false;
let startupError;
let startBridge;
const service = net.createServer(socket => {
  if (stopping) { socket.destroy(); return; }
  clearTimeout(idleTimer);
  peers.add(socket);
  socket.on('error', () => {});
  socket.on('close', () => { peers.delete(socket); scheduleIdleStop(); });
  const decoder = new FrameDecoder();
  let outstanding = 0;
  socket.on('data', chunk => {
    try {
      for (const message of decoder.push(chunk)) {
        const request = JSON.parse(message);
        if (!Number.isInteger(request.id) || ++outstanding > 16) throw new Error('Invalid shared request');
        void serve(request).then(
          result => send({ id: request.id, result }),
          error => send({ id: request.id, error: error.message }),
        ).finally(() => { outstanding--; });
      }
    } catch { socket.destroy(); }
  });
  function send(response) {
    if (!socket.destroyed) socket.write(encodeFrame(JSON.stringify(response)));
  }
});

// Exclusive named-pipe listen elects one service even when Claude starts several
// stdio adapters simultaneously. Losing children exit without binding TCP.
try {
  await new Promise((resolve, reject) => {
    service.once('error', reject);
    service.listen(brokerEndpoint(port), resolve);
  });
} catch (error) {
  if (error.code === 'EADDRINUSE') process.exit(0);
  throw error;
}
startBridge = bridge.start().catch(error => {
  startupError = error.code === 'EADDRINUSE'
    ? `Port ${port} is occupied by another program or an older BizHawk server. Close the old server and restart Claude Desktop.`
    : error.message;
});
await startBridge;
scheduleIdleStop();

async function serve(request) {
  await startBridge;
  if (request.method === 'health') return { protocol: 1, service_version: SERVICE_VERSION, broker_pid: process.pid };
  if (request.method === 'get_session_info') {
    const ready = bridge.ready;
    return {
      connected: Boolean(bridge.socket && !bridge.socket.destroyed), bridge_ready: ready,
      endpoint: `127.0.0.1:${port}`, mode: 'observe_only', service_version: SERVICE_VERSION, broker_pid: process.pid,
      ...(startupError ? { startup_error: startupError } : {}),
      ...(ready ? { emulator: await bridge.call('get_info') } : {
        next_step: `Start EmuHawk with --socket_ip=127.0.0.1 --socket_port=${port} and open lua/bridge.lua in Lua Console.`,
      }),
    };
  }
  if (startupError) throw new Error(startupError);
  if (request.method === 'get_game_context') return captureContext(bridge);
  if (request.method === 'get_game_state') return captureState(bridge);
  if (request.method === 'get_recent_events') return normalizeObservations(await bridge.call('get_recent_events'));
  throw new Error('Unknown shared observation method');
}

function scheduleIdleStop() {
  clearTimeout(idleTimer);
  if (!peers.size && !stopping) idleTimer = setTimeout(() => { void stop(); }, idleMs);
}

async function stop() {
  if (stopping) return;
  stopping = true;
  clearTimeout(idleTimer);
  for (const peer of peers) peer.destroy();
  await bridge.stop();
  await new Promise(resolve => service.close(resolve));
}
process.on('SIGTERM', () => { void stop(); });
process.on('SIGINT', () => { void stop(); });
