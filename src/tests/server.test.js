import { describe, it } from 'node:test';
import assert from 'node:assert';
import http from 'http';
import { createHash, randomBytes } from 'crypto';
import { createReloadServer } from '../server.js';

function connectWs(port) {
  return new Promise((resolve, reject) => {
    const key = randomBytes(16).toString('base64');

    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: '/',
      method: 'GET',
      headers: {
        Upgrade: 'websocket',
        Connection: 'Upgrade',
        'Sec-WebSocket-Key': key,
        'Sec-WebSocket-Version': '13',
      },
    });

    req.on('upgrade', (res, socket) => {
      const expected = createHash('sha1')
        .update(key + '258EAFA5-E914-47DA-95CA-5AB5DC11650A')
        .digest('base64');
      assert.strictEqual(res.headers['sec-websocket-accept'], expected);

      resolve({
        socket,
        onMessage(cb) {
          socket.on('data', (buf) => {
            if ((buf[0] & 0x0f) !== 0x01) return;
            const len = buf[1] & 0x7f;
            const offset = len < 126 ? 2 : len === 126 ? 4 : 10;
            const actualLen = len < 126 ? len : buf.readUInt16BE(2);
            const payload = buf.subarray(offset, offset + actualLen);
            cb(JSON.parse(payload.toString()));
          });
        },
        close() {
          socket.end();
        },
      });
    });

    req.on('error', reject);
    req.end();
  });
}

describe('ReloadServer', () => {
  it('should start on the given port', async () => {
    const server = createReloadServer(35770);
    const port = await server.ready;
    assert.strictEqual(port, 35770);
    assert.ok(server.reload);
    assert.ok(server.close);
    assert.ok(server.clientCount);
    await server.close();
  });

  it('should accept WebSocket connections', async () => {
    const server = createReloadServer(35771);
    await server.ready;
    const ws = await connectWs(35771);

    assert.ok(ws.socket);
    assert.ok(!ws.socket.destroyed);
    assert.strictEqual(server.clientCount(), 1);

    ws.close();
    await server.close();
  });

  it('should broadcast reload messages with changeType', async () => {
    const server = createReloadServer(35772);
    await server.ready;
    const ws = await connectWs(35772);

    const msgPromise = new Promise((resolve) => {
      ws.onMessage(resolve);
    });

    server.reload('/test/extension', 'full');

    const msg = await msgPromise;
    assert.strictEqual(msg.type, 'reload');
    assert.strictEqual(msg.dir, '/test/extension');
    assert.strictEqual(msg.changeType, 'full');

    ws.close();
    await server.close();
  });

  it('should auto-increment port on conflict', async () => {
    const server1 = createReloadServer(35773);
    await server1.ready;

    const server2 = createReloadServer(35773);
    const port2 = await server2.ready;
    assert.ok(port2 > 35773, `expected port > 35773, got ${port2}`);

    await server2.close();
    await server1.close();
  });
});
