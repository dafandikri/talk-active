#!/usr/bin/env node
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const DEFAULT_ROOT = dirname(dirname(SCRIPT_PATH));
const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
};

function responseHeaders(contentType) {
  return {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'",
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  };
}

function publicPath(urlValue) {
  const pathname = decodeURIComponent(new URL(urlValue, 'http://localhost').pathname);
  if (pathname === '/') return 'index.html';
  const normalized = normalize(pathname).replace(/^[/\\]+/u, '');
  if (normalized === 'index.html' || normalized.startsWith('src/')) return normalized;
  return null;
}

export function createServer(root = DEFAULT_ROOT) {
  return createHttpServer((request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { ...responseHeaders('text/plain; charset=utf-8'), Allow: 'GET, HEAD' });
      response.end('Method not allowed');
      return;
    }

    let relativePath;
    try {
      relativePath = publicPath(request.url ?? '/');
    } catch {
      relativePath = null;
    }

    if (!relativePath) {
      response.writeHead(404, responseHeaders('text/plain; charset=utf-8'));
      response.end('Not found');
      return;
    }

    const filePath = join(root, relativePath);
    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
      response.writeHead(404, responseHeaders('text/plain; charset=utf-8'));
      response.end('Not found');
      return;
    }

    const contentType = MIME_TYPES[extname(filePath)] ?? 'application/octet-stream';
    response.writeHead(200, responseHeaders(contentType));
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    createReadStream(filePath).pipe(response);
  });
}

function parsePort(args) {
  const index = args.indexOf('--port');
  const candidate = index >= 0 ? args[index + 1] : process.env.LANCAR_PORT ?? '4173';
  const port = Number(candidate);
  if (!Number.isInteger(port) || port < 0 || port > 65535) return null;
  return port;
}

function quoted(value) {
  return JSON.stringify(String(value));
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(new URL(`file://${process.argv[1]}`));
if (isDirectRun) {
  const port = parsePort(process.argv.slice(2));
  if (port === null) {
    process.stdout.write(`error: ${quoted('invalid --port value')}\nhelp: ${quoted('node scripts/serve.mjs --port <0-65535>')}\n`);
    process.exitCode = 2;
  } else {
    const server = createServer();
    server.on('error', (error) => {
      process.stdout.write(`error: ${quoted(error.message)}\nhelp: ${quoted('Choose another port with --port <number>')}\n`);
      process.exitCode = 1;
    });
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      const actualPort = typeof address === 'object' && address ? address.port : port;
      process.stdout.write([
        'server:',
        '  status: listening',
        `  url: ${quoted(`http://127.0.0.1:${actualPort}`)}`,
        `  privacy: ${quoted('serves only index.html and src/*')}`,
      ].join('\n') + '\n');
    });
  }
}

