import net from 'node:net';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir, userInfo } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FrameDecoder, encodeFrame } from './bridge.js';
import { SERVICE_VERSION } from './version.js';

export function brokerEndpoint(port) {
  const identity = `${userInfo().username}:${fileURLToPath(new URL('.', import.meta.url)).toLowerCase()}:${port}`;
  const hash = createHash('sha256').update(identity).digest('hex').slice(0, 24);
  const name = `bizhawk-commentator-v1-${hash}`;
  if (process.platform === 'win32') return `\\\\.\\pipe\\${name}`;
  if (process.platform === 'linux') return `\0${name}`;
  return path.join(tmpdir(), `${name}.sock`);
}

export class SharedClient {
  pending = new Map();
  nextId = 1;

  constructor(port) { this.port = port; }

  async start() {
    const endpoint = brokerEndpoint(this.port);
    let spawnError;
    let launched = false;
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      try {
        this.socket = await connect(endpoint);
        this.attach();
        const health = await this.call('health');
        if (health.protocol !== 1) throw new Error('Incompatible shared BizHawk service');
        if (health.service_version !== SERVICE_VERSION) {
          throw new Error(`旧版の共有サービス(${health.service_version})が動作中です。Claude DesktopとCommentatorをすべて終了し、15秒待ってから起動し直してください。`);
        }
        return;
      } catch (error) {
        if (this.socket) { this.close(); throw error; }
        if (!['ENOENT', 'ECONNREFUSED', 'EPIPE'].includes(error.code)) throw error;
        if (!launched) {
          launched = true;
          const child = spawn(process.execPath, [fileURLToPath(new URL('./shared-service.js', import.meta.url))], {
            env: { ...process.env, BIZHAWK_PORT: String(this.port) },
            detached: true, windowsHide: true, stdio: 'ignore',
          });
          child.on('error', error => { spawnError = error; });
          child.unref();
        }
        if (spawnError) throw spawnError;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }
    throw new Error('Could not connect to the shared BizHawk service within 10 seconds');
  }

  attach() {
    const decoder = new FrameDecoder(16 * 1024 * 1024);
    this.socket.on('data', chunk => {
      try {
        for (const message of decoder.push(chunk)) {
          const response = JSON.parse(message);
          const pending = this.pending.get(response.id);
          if (!pending) continue;
          this.pending.delete(response.id);
          clearTimeout(pending.timer);
          if (response.error) pending.reject(new Error(response.error));
          else pending.resolve(response.result);
        }
      } catch (error) { this.rejectPending(error); this.socket.destroy(); }
    });
    this.socket.on('close', () => this.rejectPending(new Error('Shared BizHawk service disconnected. Restart this MCP connection.')));
  }

  call(method) {
    if (!this.socket || this.socket.destroyed) return Promise.reject(new Error('Shared BizHawk service is not connected'));
    if (this.pending.size >= 16) return Promise.reject(new Error('Too many pending shared requests'));
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Shared request timed out: ${method}`));
      }, 10_000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.write(encodeFrame(JSON.stringify({ id, method })));
    });
  }

  rejectPending(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  close() {
    this.rejectPending(new Error('MCP connection closed'));
    this.socket?.destroy();
  }
}

function connect(endpoint) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(endpoint);
    // Keep an error handler installed across the handoff to SharedClient.
    socket.on('error', () => {});
    const timer = setTimeout(() => { socket.destroy(); reject(new Error('Shared service connection timed out')); }, 2000);
    socket.once('error', error => { clearTimeout(timer); socket.destroy(); reject(error); });
    socket.once('connect', () => { clearTimeout(timer); resolve(socket); });
  });
}
