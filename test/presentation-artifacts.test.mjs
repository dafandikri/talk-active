import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import test from 'node:test';
import { inflateRawSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PPTX = join(ROOT, 'docs/presentation/Talk-Active_RISTEK_Finals_2026.pptx');
const PDF = join(ROOT, 'docs/presentation/Talk-Active_RISTEK_Finals_2026.pdf');
const SCRIPT = join(ROOT, 'docs/presentation/PITCH-SCRIPT.md');
const QA_BANK = join(ROOT, 'docs/presentation/Q&A-BANK.md');

function pptxEntries(path) {
  const archive = readFileSync(path);
  const minimumEocdSize = 22;
  const searchStart = Math.max(0, archive.length - 65_557);
  let eocd = -1;
  for (let offset = archive.length - minimumEocdSize; offset >= searchStart; offset -= 1) {
    if (archive.readUInt32LE(offset) === 0x06054b50) {
      eocd = offset;
      break;
    }
  }
  assert.notEqual(eocd, -1, 'PPTX ZIP directory is missing');

  const entryCount = archive.readUInt16LE(eocd + 10);
  let centralOffset = archive.readUInt32LE(eocd + 16);
  const entries = new Map();

  for (let index = 0; index < entryCount; index += 1) {
    assert.equal(archive.readUInt32LE(centralOffset), 0x02014b50, 'PPTX ZIP directory is corrupt');
    const flags = archive.readUInt16LE(centralOffset + 8);
    const method = archive.readUInt16LE(centralOffset + 10);
    const compressedSize = archive.readUInt32LE(centralOffset + 20);
    const nameLength = archive.readUInt16LE(centralOffset + 28);
    const extraLength = archive.readUInt16LE(centralOffset + 30);
    const commentLength = archive.readUInt16LE(centralOffset + 32);
    const localOffset = archive.readUInt32LE(centralOffset + 42);
    const name = archive.subarray(centralOffset + 46, centralOffset + 46 + nameLength).toString('utf8');
    assert.equal(flags & 1, 0, `${name} is encrypted`);

    const localNameLength = archive.readUInt16LE(localOffset + 26);
    const localExtraLength = archive.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = archive.subarray(dataOffset, dataOffset + compressedSize);
    const content = method === 0 ? compressed : method === 8 ? inflateRawSync(compressed) : null;
    assert.ok(content, `${name} uses unsupported ZIP compression method ${method}`);
    entries.set(name, content);

    centralOffset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

test('final PPTX carries the verified pitch, links, notes, and ten-slide structure', () => {
  assert.equal(existsSync(PPTX), true, 'final PPTX is missing');
  assert.ok(statSync(PPTX).size > 500_000, 'final PPTX is unexpectedly small');
  const entries = pptxEntries(PPTX);
  const slides = [...entries.keys()].filter((name) => /^ppt\/slides\/slide\d+\.xml$/u.test(name));
  const notes = [...entries.keys()].filter((name) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/u.test(name));
  assert.equal(slides.length, 10, 'final deck must contain exactly ten slides');
  assert.equal(notes.length, 10, 'every slide must retain timed speaker notes');

  const slideXml = slides.map((name) => entries.get(name).toString('utf8')).join('\n');
  const noteXml = notes.map((name) => entries.get(name).toString('utf8')).join('\n');
  const relationships = [...entries.entries()]
    .filter(([name]) => /^ppt\/slides\/_rels\/slide\d+\.xml\.rels$/u.test(name))
    .map(([, content]) => content.toString('utf8'))
    .join('\n');

  assert.match(slideXml, /<a:t>150\+<\/a:t>/u);
  assert.match(slideXml, /<a:t>18<\/a:t>/u);
  assert.match(slideXml, /<a:t>16<\/a:t>/u);
  assert.doesNotMatch(slideXml, /<a:t>(?:147|17)<\/a:t>/u, 'stale gate counts returned to the deck');
  assert.match(relationships, /https:\/\/talk-active-id\.vercel\.app/u);
  assert.match(relationships, /https:\/\/github\.com\/dafandikri\/talk-active/u);
  assert.match(noteXml, /more than 150 automated tests/iu);
  assert.match(noteXml, /HARD STOP/iu);
  assert.doesNotMatch(
    noteXml,
    /<a:t>(?:Click to add[^<]*|Slide Number|Footer)<\/a:t>/iu,
    'an inherited placeholder is visible',
  );
});

test('final PDF is a ten-page, unencrypted 16:9 export', () => {
  assert.equal(existsSync(PDF), true, 'final PDF is missing');
  const pdf = readFileSync(PDF);
  assert.ok(pdf.subarray(0, 5).equals(Buffer.from('%PDF-')), 'final PDF signature is invalid');
  assert.ok(pdf.length > 500_000, 'final PDF is unexpectedly small');
  const text = pdf.toString('latin1');
  assert.equal((text.match(/\/Type\/Page\/Parent/gu) ?? []).length, 10, 'final PDF must contain ten pages');
  assert.match(text, /\/MediaBox\[0 0 960\.\d+ 540\]/u, 'final PDF is not 16:9');
  assert.doesNotMatch(text, /\/Encrypt\b/u, 'final PDF must not require a password');
});

test('pitch script and Q&A bank stay synchronized with the submission evidence', () => {
  const script = readFileSync(SCRIPT, 'utf8');
  const qaBank = readFileSync(QA_BANK, 'utf8');
  assert.match(script, /more than 150 automated tests, 18 real-browser checks, and a 16-stage demo gate/iu);
  assert.match(script, /Recovery line if semantic analysis does not return/iu);
  assert.match(script, /Hard stop\. Do not add an improvised closing/iu);
  assert.doesNotMatch(`${script}\n${qaBank}`, /147 (?:automated )?tests|17 real-browser checks/iu);
  assert.ok((qaBank.match(/^### \d+\./gmu) ?? []).length >= 30, 'Q&A bank lost required breadth');
});
