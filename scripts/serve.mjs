#!/usr/bin/env node
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { dirname, extname, join, posix } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const DEFAULT_ROOT = dirname(dirname(SCRIPT_PATH));
const LOCAL_ENV_PATH = join(DEFAULT_ROOT, '.env.local');

// Keep `pnpm dev` aligned with Vercel Development without adding a runtime
// dependency. Existing shell variables win, and an absent file is the normal
// deterministic/offline configuration.
if (existsSync(LOCAL_ENV_PATH) && typeof process.loadEnvFile === 'function') {
  process.loadEnvFile(LOCAL_ENV_PATH);
}

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.webp': 'image/webp',
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
  // URL paths always use `/`, even on Windows. Fold encoded backslashes before
  // POSIX normalization so `src\\app.mjs` works without letting
  // `src\\..\\..\\secret` escape the allow-list.
  const normalized = posix.normalize(pathname.replace(/\\/gu, '/')).replace(/^\/+/u, '');
  if (
    normalized === 'index.html'
    || normalized === 'brief.html'
    || normalized === 'booth.html'
    || normalized.startsWith('src/')
  ) return normalized;
  return null;
}

export function createServer(root = DEFAULT_ROOT) {
  return createHttpServer((request, response) => {
    // API endpoints are served locally by the same handlers Vercel runs, so
    // local development and production behave identically. Everything else
    // below stays a read-only static server.
    let pathname = '/';
    try {
      pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    } catch {
      pathname = '/';
    }
    const apiModule = pathname === '/api/analyze'
      ? '../api/analyze.mjs'
      : pathname === '/api/import-rubric' ? '../api/import-rubric.mjs' : null;
    if (apiModule) {
      import(apiModule)
        .then((module) => module.default(request, response))
        .catch(() => {
          response.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
          response.end(JSON.stringify({ error: 'api_unavailable', message: 'API endpoint failed to load.' }));
        });
      return;
    }

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
  const candidate = index >= 0 ? args[index + 1] : process.env.TALK_ACTIVE_PORT ?? '4173';
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
        `  privacy: ${quoted('serves only index.html, brief.html, booth.html, and src/*')}`,
      ].join('\n') + '\n');
    });
  }
}
