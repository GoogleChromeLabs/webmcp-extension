/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import http from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { createHash, randomUUID } from 'node:crypto';

/**
 * The server `npm run dev` uses to tell the extension to reload or send it build
 * errors (see extension/devReload.ts). A WebSocket, since its traffic keeps the
 * service worker alive past the 30 second idle timeout.
 */

const RFC6455_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const CLOSE_FRAME = Buffer.from([0x88, 0]);

function textFrame(text: string): Buffer {
  const payload = Buffer.from(text);
  let header: Buffer;
  if (payload.length < 126) {
    header = Buffer.from([0x81, payload.length]);
  } else if (payload.length < 0x10000) {
    header = Buffer.from([0x81, 126, 0, 0]);
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.from([0x81, 127, 0, 0, 0, 0, 0, 0, 0, 0]);
    header.writeBigUInt64BE(BigInt(payload.length), 2);
  }
  return Buffer.concat([header, payload]);
}

const RELOAD_FRAMES = Buffer.concat([textFrame('reload'), CLOSE_FRAME]);

export interface ReloadServer {
  url: string;
  reload: () => void;
  reportErrors: (errors: string) => void;
  close: () => void;
}

/**
 * The URL carries an id for this `npm run dev`, which is built into the
 * service worker. A worker built by an earlier `npm run dev` is told to reload
 * once this one has finished a clean build, so it picks up the new files.
 */
export function startReloadServer(port: number): Promise<ReloadServer> {
  const buildId = randomUUID();
  const sockets = new Set<Socket>();
  let built = false;
  let errors = '';
  const server = http.createServer((_req, res) => res.writeHead(426).end());

  server.on('upgrade', (req, socket: Socket) => {
    socket.on('error', () => socket.destroy());
    const key = req.headers['sec-websocket-key'];
    if (!req.headers.origin?.startsWith('chrome-extension://') || !key) {
      socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      return;
    }
    const accept = createHash('sha1').update(key + RFC6455_GUID).digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    );
    // Reading the keepalive messages lets the socket notice when the worker goes away.
    socket.resume();
    socket.on('close', () => sockets.delete(socket));
    const stale = new URL(req.url ?? '/', 'http://localhost').searchParams.get('build') !== buildId;
    if (stale && built) {
      socket.end(RELOAD_FRAMES);
      return;
    }
    sockets.add(socket);
    if (errors) socket.write(textFrame(errors));
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const { port: listening } = server.address() as AddressInfo;
      resolve({
        url: `ws://127.0.0.1:${listening}/?build=${buildId}`,
        reload: () => {
          built = true;
          errors = '';
          for (const socket of sockets) socket.end(RELOAD_FRAMES);
        },
        reportErrors: (text) => {
          errors = text;
          for (const socket of sockets) socket.write(textFrame(errors));
        },
        close: () => {
          for (const socket of sockets) socket.destroy();
          server.close();
        },
      });
    });
  });
}
