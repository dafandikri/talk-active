import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MIN_HEADROOM_DAYS,
  classifyKey,
  parseExpires,
  parseKeyList,
  summarise,
} from '../scripts/gateway-key.mjs';

// The exact table `vercel ai-gateway api-keys list` printed on 20 August 2026.
// Kept verbatim so a CLI format change fails here rather than silently
// reporting "no keys" and passing the gate for the wrong reason.
const LIST_OUTPUT = `Vercel CLI 58.9.0 (Node.js 26.0.0)
Fetching API keys
> API keys [1s]
  id                                                  name                       key        budget    spend        refresh    created
  SqnLKamBOd7iibjzlM05GKmv5fyJ98Z3Go4wnNkx1nxoNXqd    talk-active-2026           …09WB8E    $5        $0.004971    none       8/20/2026
  bXpOO7GUAp3wvoYL00sdqW8PnFaDr4C4bBwhVKTFDvrnIrHJ    talk-active-finals-2026    …1ESCHD    $5        $1.035574    none       8/12/2026
`;

const NOW = new Date('2026-08-20T12:00:00+07:00');

test('the key list is read as rows, not as prose', () => {
  const keys = parseKeyList(LIST_OUTPUT);
  assert.equal(keys.length, 2);
  assert.deepEqual(keys[0], {
    id: 'SqnLKamBOd7iibjzlM05GKmv5fyJ98Z3Go4wnNkx1nxoNXqd',
    name: 'talk-active-2026',
  });
  assert.equal(keys[1].name, 'talk-active-finals-2026');
});

test('a list with no key rows is reported as empty rather than guessed at', () => {
  const empty = `Vercel CLI 58.9.0 (Node.js 26.0.0)
Fetching API keys
> API keys [1s]
  id                                                  name                       key        budget    spend        refresh    created
`;
  assert.deepEqual(parseKeyList(empty), []);
});

test('an expiry is read as never, as a date, or not at all', () => {
  assert.equal(parseExpires('  name  x\n  expires       never\n'), null);

  const dated = parseExpires('  expires       8/19/2026, 2:19:44 AM\n');
  assert.ok(dated instanceof Date);
  assert.equal(dated.getFullYear(), 2026);
  assert.equal(dated.getMonth(), 7); // August is zero-indexed
  assert.equal(dated.getDate(), 19);
});

// Format drift is the failure this whole script exists to prevent, so an
// unreadable expiry must never be treated as a healthy one.
test('an unreadable expiry throws instead of passing', () => {
  assert.throws(
    () => parseExpires('  expires       sometime next Tuesday\n'),
    /could not be read/iu,
  );
  assert.throws(() => parseExpires('  name   talk-active-2026\n'), /no expiry/iu);
});

test('a key that never expires is healthy', () => {
  assert.deepEqual(
    classifyKey({ id: 'a', name: 'k', expires: null }, NOW),
    { id: 'a', name: 'k', status: 'healthy', daysLeft: null },
  );
});

test('a key past its expiry is expired', () => {
  const result = classifyKey(
    { id: 'a', name: 'k', expires: new Date('2026-08-19T02:19:44+07:00') },
    NOW,
  );
  assert.equal(result.status, 'expired');
  assert.ok(result.daysLeft < 0);
});

test('a key inside the headroom window is expiring, not healthy', () => {
  const soon = new Date(NOW.getTime() + (MIN_HEADROOM_DAYS - 1) * 86_400_000);
  assert.equal(classifyKey({ id: 'a', name: 'k', expires: soon }, NOW).status, 'expiring');

  const later = new Date(NOW.getTime() + (MIN_HEADROOM_DAYS + 1) * 86_400_000);
  assert.equal(classifyKey({ id: 'a', name: 'k', expires: later }, NOW).status, 'healthy');
});

test('one healthy key is enough, so a retired expired key does not fail the gate', () => {
  const summary = summarise([
    { id: 'a', name: 'talk-active-2026', status: 'healthy', daysLeft: null },
    { id: 'b', name: 'talk-active-finals-2026', status: 'expired', daysLeft: -1 },
  ]);
  assert.equal(summary.ok, true);
  assert.equal(summary.healthy, 1);
});

// The exact state that took production semantic-dark on 19 August 2026.
test('no healthy key fails the gate', () => {
  const summary = summarise([
    { id: 'b', name: 'talk-active-finals-2026', status: 'expired', daysLeft: -1 },
  ]);
  assert.equal(summary.ok, false);
});

test('having no keys at all fails rather than vacuously passing', () => {
  assert.equal(summarise([]).ok, false);
});
