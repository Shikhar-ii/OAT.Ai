import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

if (existsSync('.env')) process.loadEnvFile('.env');

const root = fileURLToPath(new URL('../dist/', import.meta.url));
const port = Number(process.env.PORT || 3000);
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
  '.webp': 'image/webp',
  '.txt': 'text/plain; charset=utf-8',
};

createServer(async (request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }

  try {
    const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = resolve(root, '.' + (path === '/' ? '/index.html' : path));
    if (!file.startsWith(resolve(root) + sep)) {
      response.writeHead(404).end('Not found');
      return;
    }

    const bytes = await readFile(file);
    response.writeHead(200, {
      'Content-Type': mime[extname(file)] || 'application/octet-stream',
      'Content-Length': bytes.length,
      'Cache-Control': 'no-cache',
    }).end(request.method === 'HEAD' ? undefined : bytes);
  } catch (error) {
    if (error instanceof URIError) response.writeHead(400).end('Invalid path');
    else if (error.code === 'ENOENT' || error.code === 'EISDIR') response.writeHead(404).end('Not found');
    else response.writeHead(500).end('Unable to load file');
  }
}).listen(port, '127.0.0.1', () => {
  console.log('OAT AI Inventory is available at http://127.0.0.1:' + port);
});
