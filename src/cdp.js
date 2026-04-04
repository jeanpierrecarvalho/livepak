import http from 'http';
import crypto from 'crypto';

/**
 * Makes a JSON request to Chrome's DevTools HTTP API.
 */
export function cdpGet(port, urlPath) {
  return new Promise((resolve, reject) => {
    http
      .get(`http://127.0.0.1:${port}${urlPath}`, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try { resolve(JSON.parse(data)); } catch { resolve(data); }
        });
      })
      .on('error', reject);
  });
}

/**
 * Creates a persistent CDP WebSocket session to a target.
 * Returns { send(method, params), close() } where send returns a promise.
 */
export function cdpConnect(wsDebugUrl) {
  return new Promise((resolve, reject) => {
    const url = new URL(wsDebugUrl);
    const key = crypto.randomBytes(16).toString('base64');

    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'GET',
      headers: {
        Upgrade: 'websocket',
        Connection: 'Upgrade',
        'Sec-WebSocket-Key': key,
        'Sec-WebSocket-Version': '13',
      },
    });

    req.on('upgrade', (_, socket) => {
      let idCounter = 0;
      let buffer = Buffer.alloc(0);
      const pending = new Map();

      socket.on('data', (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        // parse all complete frames
        while (buffer.length >= 2) {
          const len = buffer[1] & 0x7f;
          let offset = 2;
          let actualLen = len;
          if (len === 126) {
            if (buffer.length < 4) break;
            actualLen = buffer.readUInt16BE(2);
            offset = 4;
          } else if (len === 127) {
            if (buffer.length < 10) break;
            actualLen = Number(buffer.readBigUInt64BE(2));
            offset = 10;
          }
          if (buffer.length < offset + actualLen) break;

          const data = buffer.subarray(offset, offset + actualLen).toString();
          buffer = buffer.subarray(offset + actualLen);

          try {
            const parsed = JSON.parse(data);
            if (parsed.id && pending.has(parsed.id)) {
              pending.get(parsed.id)(parsed);
              pending.delete(parsed.id);
            }
          } catch {}
        }
      });

      socket.on('error', () => {});

      function sendFrame(data) {
        const payload = Buffer.from(data);
        const mask = crypto.randomBytes(4);
        const masked = Buffer.alloc(payload.length);
        for (let i = 0; i < payload.length; i++) {
          masked[i] = payload[i] ^ mask[i % 4];
        }
        let header;
        if (payload.length < 126) {
          header = Buffer.alloc(2);
          header[0] = 0x81;
          header[1] = payload.length | 0x80;
        } else {
          header = Buffer.alloc(4);
          header[0] = 0x81;
          header[1] = 126 | 0x80;
          header.writeUInt16BE(payload.length, 2);
        }
        socket.write(Buffer.concat([header, mask, masked]));
      }

      function send(method, params = {}) {
        const id = ++idCounter;
        return new Promise((res) => {
          pending.set(id, res);
          sendFrame(JSON.stringify({ id, method, params }));
          setTimeout(() => {
            if (pending.has(id)) {
              pending.delete(id);
              res({ error: { message: 'timeout' } });
            }
          }, 10000);
        });
      }

      function close() {
        socket.end();
      }

      resolve({ send, close });
    });

    req.on('error', reject);
    req.end();
  });
}
