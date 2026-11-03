import net from 'node:net';

// BizHawk comm.socketServer* uses a decimal UTF-8 byte length, then a space.
// Parse bytes rather than lines: TCP may split Japanese text or combine replies.
export function encodeFrame(payload) {
  const body = Buffer.from(payload, 'utf8');
  return Buffer.concat([Buffer.from(`${body.length} `), body]);
}

export class FrameDecoder {
  buffer = Buffer.alloc(0);
  constructor(maxBytes = 1024 * 1024) { this.maxBytes = maxBytes; }
  push(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const messages = [];
    while (this.buffer.length) {
      const sep = this.buffer.indexOf(32);
      if (sep < 0) {
        if (this.buffer.length > 10) throw new Error('Invalid frame header');
        break;
      }
      const header = this.buffer.subarray(0, sep).toString('ascii');
      if (!/^\d{1,8}$/.test(header)) throw new Error('Invalid frame length');
      const size = Number(header);
      if (size < 1 || size > this.maxBytes) throw new Error('Frame too large or empty');
      if (this.buffer.length < sep + 1 + size) break;
      messages.push(this.buffer.subarray(sep + 1, sep + 1 + size).toString('utf8').trim());
      this.buffer = this.buffer.subarray(sep + 1 + size);
    }
    return messages;
  }
}

export class Bridge {
  socket = null;
  ready = false;
  queue = [];
  active = null;
  nextId = 1;

  constructor({ port = 8766, timeoutMs = 5000 } = {}) {
    this.port = port;
    this.timeoutMs = timeoutMs;
  }

  async start() {
    this.server = net.createServer(socket => this.attach(socket));
    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.port, '127.0.0.1', resolve);
    });
    this.port = this.server.address().port;
  }

  attach(socket) {
    if (this.socket) { socket.destroy(); return; }
    this.socket = socket;
    this.ready = false;
    socket.setNoDelay(true);
    const decoder = new FrameDecoder();
    socket.on('error', () => {});
    socket.on('close', () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.ready = false;
      this.rejectPending(new Error('BizHawk disconnected. Restart bridge.lua after reconnecting.'));
    });
    socket.on('data', chunk => {
      try {
        for (const message of decoder.push(chunk)) this.handle(message);
      } catch (error) {
        this.rejectPending(error);
        socket.destroy();
      }
    });
  }

  handle(message) {
    if (message === 'READY') {
      if (this.active) throw new Error('Bridge restarted during a request');
      this.ready = true;
    } else if (message.startsWith('RESULT ')) {
      const response = JSON.parse(message.slice(7));
      if (!this.active || response.id !== this.active.id) throw new Error('Unexpected bridge response');
      const pending = this.active;
      this.active = null;
      clearTimeout(pending.timer);
      if (response.error) pending.reject(new Error(String(response.error.message ?? response.error)));
      else pending.resolve(response.result);
    } else {
      throw new Error('Unknown bridge message');
    }
    this.active = this.queue.shift() ?? null;
    this.socket.write(encodeFrame(this.active
      ? JSON.stringify({ id: this.active.id, method: this.active.method, params: this.active.params })
      : 'NONE'));
  }

  call(method, params = {}) {
    if (!this.ready || !this.socket || this.socket.destroyed) {
      return Promise.reject(new Error('BizHawk bridge is not ready. Launch EmuHawk with socket options and load lua/bridge.lua.'));
    }
    if (this.queue.length >= 16) return Promise.reject(new Error('Too many pending requests'));
    return new Promise((resolve, reject) => {
      const pending = { id: this.nextId++, method, params, resolve, reject };
      pending.timer = setTimeout(() => {
        this.queue = this.queue.filter(item => item !== pending);
        reject(new Error(`BizHawk request timed out: ${method}. Check that bridge.lua is running.`));
        if (this.active === pending) {
          // A late reply must never be associated with a new request/session.
          this.active = null;
          this.ready = false;
          this.socket?.destroy();
        }
      }, this.timeoutMs);
      this.queue.push(pending);
    });
  }

  rejectPending(error) {
    for (const pending of [...this.queue, ...(this.active ? [this.active] : [])]) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.queue = [];
    this.active = null;
  }

  async stop() {
    this.ready = false;
    this.rejectPending(new Error('Server stopped'));
    this.socket?.destroy();
    if (this.server?.listening) await new Promise(resolve => this.server.close(resolve));
  }
}
