import { createServer } from 'http';
import { createHash } from 'crypto';

const WS_MAGIC = '258EAFA5-E914-47DA-95CA-5AB5DC11650A';

/**
 * Minimal WebSocket server using raw HTTP upgrade.
 * Zero dependencies -- implements RFC 6455 handshake and framing.
 */
export function createReloadServer(port = 35729, { maxRetries = 10 } = {}) {
  const clients = new Set();
  let actualPort = port;

  const server = createServer((req, res) => {
    res.writeHead(404);
    res.end();
  });

  server.on('upgrade', (req, socket, head) => {
    const key = req.headers['sec-websocket-key'];
    if (!key) {
      socket.destroy();
      return;
    }

    const accept = createHash('sha1')
      .update(key + WS_MAGIC)
      .digest('base64');

    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n` +
        '\r\n',
    );

    if (head && head.length > 0) {
      socket.unshift(head);
    }

    clients.add(socket);

    socket.on('data', (buf) => {
      if (buf.length < 2) return;
      const opcode = buf[0] & 0x0f;

      if (opcode === 0x08) {
        const closeFrame = Buffer.alloc(2);
        closeFrame[0] = 0x88;
        closeFrame[1] = 0x00;
        socket.write(closeFrame);
        socket.end();
        return;
      }

      if (opcode === 0x09) {
        const pong = Buffer.from(buf);
        pong[0] = (pong[0] & 0xf0) | 0x0a;
        socket.write(pong);
      }
    });

    socket.on('close', () => {
      clients.delete(socket);
    });

    socket.on('error', () => {
      clients.delete(socket);
    });
  });

  // try to listen, auto-increment port on conflict
  const ready = new Promise((resolve, reject) => {
    let attempts = 0;

    function tryListen() {
      server.once('error', (err) => {
        if (err.code === 'EADDRINUSE' && attempts < maxRetries) {
          attempts++;
          actualPort++;
          tryListen();
        } else {
          reject(err);
        }
      });
      server.listen(actualPort, () => resolve(actualPort));
    }

    tryListen();
  });

  function sendFrame(socket, data) {
    const payload = Buffer.from(data);
    const len = payload.length;
    let header;

    if (len < 126) {
      header = Buffer.alloc(2);
      header[0] = 0x81;
      header[1] = len;
    } else if (len < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x81;
      header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x81;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }

    socket.write(Buffer.concat([header, payload]));
  }

  function broadcast(msg) {
    const data = JSON.stringify(msg);
    for (const client of clients) {
      if (!client.destroyed) {
        sendFrame(client, data);
      }
    }
  }

  function reload(extensionDir, changeType) {
    broadcast({ type: 'reload', dir: extensionDir, changeType });
  }

  function close() {
    return new Promise((resolve) => {
      for (const client of clients) {
        client.destroy();
      }
      clients.clear();
      server.close(() => resolve());
    });
  }

  function getPort() {
    return actualPort;
  }

  function clientCount() {
    return clients.size;
  }

  return { reload, close, ready, getPort, clientCount, server };
}
