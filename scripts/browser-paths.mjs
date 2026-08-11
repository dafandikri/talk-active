import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, win32 } from 'node:path';

const BROWSER_NAMES = new Set([
  'chrome-headless-shell',
  'chrome-headless-shell.exe',
  'headless_shell',
  'headless_shell.exe',
  'Google Chrome',
  'Chromium',
  'chrome.exe',
  'msedge.exe',
]);

function walkForBrowser(directory, depth = 0) {
  if (!directory || !existsSync(directory) || depth > 4) return [];
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = join(directory, entry.name);
    if (entry.isFile() && BROWSER_NAMES.has(entry.name)) found.push(fullPath);
    else if (entry.isDirectory()) found.push(...walkForBrowser(fullPath, depth + 1));
  }
  return found;
}

export function browserCandidates({ platform = process.platform, env = process.env } = {}) {
  if (platform === 'win32') {
    const roots = [env.LOCALAPPDATA, env.PROGRAMFILES, env['PROGRAMFILES(X86)']].filter(Boolean);
    return roots.flatMap((root) => [
      win32.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      win32.join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    ]);
  }
  if (platform === 'darwin') {
    return [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ];
  }
  return ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
}

export function findBrowser({
  platform = process.platform,
  env = process.env,
  home = homedir(),
  exists = existsSync,
} = {}) {
  if (env.CHROME_BIN && exists(env.CHROME_BIN)) return env.CHROME_BIN;
  const installed = browserCandidates({ platform, env }).find((candidate) => exists(candidate));
  if (installed) return installed;

  const cacheRoots = platform === 'win32'
    ? [
        env.LOCALAPPDATA && win32.join(env.LOCALAPPDATA, 'ms-playwright'),
        home && win32.join(home, 'AppData', 'Local', 'ms-playwright'),
      ].filter(Boolean)
    : [join(home, 'Library/Caches/ms-playwright'), join(home, '.cache/ms-playwright')];
  return cacheRoots.flatMap((root) => walkForBrowser(root)).sort().reverse()[0] ?? null;
}
