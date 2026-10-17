import { createServer, request } from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { dist, publicPath } from './build-manifest.mjs';

const port = Number(process.env.PORT || 5173);
const relay = new URL(process.env.DFM_RELAY_URL || 'http://127.0.0.1:9001');
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT.');
if (relay.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(relay.hostname) ||
    relay.username || relay.password || relay.pathname !== '/' || relay.search || relay.hash)
  throw new Error('DFM_RELAY_URL must be a local HTTP origin, such as http://127.0.0.1:9001.');
const root = await realpath(dist);
const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
  try {
    let name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\//, '');
    if (name === 'share' || name.startsWith('share/')) name = name.slice(6);
    name = name || 'index.html';
    if (!publicPath(name) && name !== 'build-manifest.json') { res.writeHead(404); res.end(); return; }
    const file = await realpath(resolve(root, name));
    if (!file.startsWith(root + sep)) { res.writeHead(404); res.end(); return; }
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': (mime[extname(name)] || 'text/plain') + '; charset=utf-8', 'Content-Length': body.length });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch (error) {
    res.writeHead(error.code === 'ENOENT' ? 404 : 400);
    res.end();
  }
});

server.on('upgrade', (req, socket, head) => {
  socket.on('error', () => socket.destroy());
  let parsed;
  try { parsed = new URL(req.url, 'http://localhost'); }
  catch { socket.destroy(); return; }
  if (parsed.pathname !== '/ws' || req.headers.upgrade?.toLowerCase() !== 'websocket') {
    socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
    return;
  }
  const target = new URL('/ws', relay);
  target.search = parsed.search;
  const upstream = request(target, { headers: { ...req.headers, host: relay.host } });
  upstream.setTimeout(5000, () => upstream.destroy(new Error('Relay handshake timed out.')));
  socket.on('close', () => upstream.destroy());
  upstream.on('error', () => socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\nStart the local Python relay.'));
  upstream.on('response', response => {
    response.resume();
    socket.end(`HTTP/1.1 ${response.statusCode} Relay rejected connection\r\nConnection: close\r\n\r\n`);
  });
  upstream.on('upgrade', (response, peer, buffered) => {
    peer.setTimeout(0);
    peer.on('error', () => socket.destroy());
    peer.on('close', () => socket.destroy());
    socket.on('close', () => peer.destroy());
    let headers = 'HTTP/1.1 101 Switching Protocols\r\n';
    for (let i = 0; i < response.rawHeaders.length; i += 2)
      headers += response.rawHeaders[i] + ': ' + response.rawHeaders[i + 1] + '\r\n';
    socket.write(headers + '\r\n');
    if (buffered.length) socket.write(buffered);
    if (head.length) peer.write(head);
    peer.pipe(socket).pipe(peer);
  });
  upstream.end();
});
server.listen(port, '127.0.0.1', () => {
  console.log(`Preview: http://127.0.0.1:${port}/`);
  console.log(`Local WebSocket relay: ${relay.origin} (set DFM_RELAY_URL to change its port).`);
});
