#!/usr/bin/env node
import {
  copyFileSync,
  mkdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const ROOT = dirname(dirname(SCRIPT_PATH));

// This is the complete public product surface. Server-only semantic modules,
// tests, event records, proposal evidence, and agent instructions stay in the
// build context only when required and never enter Vercel's static output.
export const PUBLIC_RUNTIME_FILES = Object.freeze([
  'index.html',
  'brief.html',
  'booth.html',
  'src/app.mjs',
  'src/analyzer.mjs',
  'src/analysis-progress.mjs',
  'src/tokens.css',
  'src/styles.css',
  'src/landing.css',
  'src/booth.css',
  'src/assets/LOGO.png',
  'src/assets/LOGO-dashboard.png',
  'src/assets/LOGO & TAGLINE.png',
  'src/assets/macaw-mascot-3d.webp',
  'src/assets/rehearsal-loop-arrow.svg',
  'src/assets/talk-active-production-qr.svg',
  'src/assets/ristek-hackathon-2026-logo.png',
]);

function inside(parent, candidate) {
  const pathFromParent = relative(parent, candidate);
  return pathFromParent !== ''
    && pathFromParent !== '..'
    && !pathFromParent.startsWith(`..${sep}`)
    && !isAbsolute(pathFromParent);
}

export function buildPublic({ root = ROOT, output = join(ROOT, 'public') } = {}) {
  const sourceRoot = resolve(root);
  const outputRoot = resolve(output);
  if (!inside(sourceRoot, outputRoot)) {
    throw new Error('Public build output must be a dedicated directory inside the project root.');
  }

  rmSync(outputRoot, { recursive: true, force: true });
  mkdirSync(outputRoot, { recursive: true });

  let bytes = 0;
  for (const runtimePath of PUBLIC_RUNTIME_FILES) {
    const source = resolve(sourceRoot, runtimePath);
    if (!inside(sourceRoot, source)) throw new Error(`Invalid runtime path: ${runtimePath}`);
    const destination = resolve(outputRoot, runtimePath);
    if (!inside(outputRoot, destination)) throw new Error(`Invalid output path: ${runtimePath}`);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(source, destination);
    bytes += statSync(destination).size;
  }

  return { files: PUBLIC_RUNTIME_FILES.length, bytes, output: outputRoot };
}

const isDirectRun = process.argv[1]
  && fileURLToPath(import.meta.url) === fileURLToPath(new URL(`file://${process.argv[1]}`));

if (isDirectRun) {
  try {
    const result = buildPublic();
    process.stdout.write([
      'public-build:',
      '  status: ready',
      `  files: ${result.files}`,
      `  bytes: ${result.bytes}`,
      `  output: ${JSON.stringify(result.output)}`,
    ].join('\n') + '\n');
  } catch (error) {
    process.stdout.write([
      'public-build:',
      '  status: failed',
      `  reason: ${JSON.stringify(error.message)}`,
    ].join('\n') + '\n');
    process.exitCode = 1;
  }
}
