import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { HTML_LANG, interfaceLocaleFrom } from '../apps/web/i18n/locales.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WEB = join(ROOT, 'apps/web');

const DATE_SURFACES = [
  'apps/web/app/(workspace)/workspace/page.tsx',
  'apps/web/components/progress-view.tsx',
  'apps/web/components/saved-attempt-review.tsx',
];

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && /\.tsx?$/u.test(entry.name) ? [path] : [];
  });
}

function read(relative) {
  return readFileSync(join(ROOT, relative), 'utf8');
}

test('interface locale tags format calendar dates in the selected language', () => {
  const date = new Date('2026-08-12T08:00:00.000Z');
  const options = { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' };

  assert.equal(interfaceLocaleFrom('id'), 'id');
  assert.equal(interfaceLocaleFrom('en'), 'en');
  assert.equal(date.toLocaleDateString(HTML_LANG.id, options), '12 Agu 2026');
  assert.equal(date.toLocaleDateString(HTML_LANG.en, options), 'Aug 12, 2026');
});

test('user-visible calendar formatting never pins an interface locale literal', () => {
  const files = [
    ...sourceFiles(join(WEB, 'app')),
    ...sourceFiles(join(WEB, 'components')),
  ];
  const hardcodedLocale = /(?:\.toLocale(?:DateString|TimeString|String)|Intl\.DateTimeFormat)\(\s*(['"])(?:id|en)(?:-[A-Z]{2})?\1/gu;
  const offenders = [];

  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(hardcodedLocale)) {
      const line = source.slice(0, match.index).split('\n').length;
      offenders.push(`${file.slice(ROOT.length + 1)}:${line} ${match[0]}`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    'calendar copy must follow the interface locale; pass a locale resolved from useLocale()',
  );
});

test('every date-bearing client resolves a BCP-47 tag from the current interface locale', () => {
  for (const file of DATE_SURFACES) {
    const source = read(file);
    assert.match(source, /import \{ useLocale, useTranslations \} from 'next-intl';/u, file);
    assert.match(source, /import \{ HTML_LANG, interfaceLocaleFrom \} from '@\/i18n\/locales';/u, file);
    assert.match(
      source,
      /const dateLocale = HTML_LANG\[interfaceLocaleFrom\(useLocale\(\)\)\];/u,
      `${file} must derive dates from the interface locale rather than project or browser language`,
    );

    const calendarCalls = [...source.matchAll(/\.toLocale(?:DateString|TimeString|String)\(\s*([^,\n)]+)/gu)];
    assert.ok(calendarCalls.length > 0, `${file} must still contain the expected calendar formatter`);
    for (const call of calendarCalls) {
      assert.match(
        call[1],
        /^(?:dateLocale|locale)$/u,
        `${file} has a calendar formatter that does not receive the resolved locale`,
      );
    }
  }
});
