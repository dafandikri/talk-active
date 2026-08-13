import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(path, 'utf8');

test('the shared toast provider exposes every system feedback variant', () => {
  const component = read('apps/web/components/toast.tsx');

  for (const variant of ['positive', 'negative', 'warning', 'info']) {
    assert.match(component, new RegExp(`['"]${variant}['"]`, 'u'), `${variant} is missing from the toast contract`);
  }
  assert.match(component, /export function ToastProvider/u);
  assert.match(component, /export function useToast/u);
  assert.match(component, /data-toast-variant=\{toast\.variant\}/u);
  assert.match(component, /toast\.variant === 'negative' \? 'alert' : 'status'/u);
  assert.doesNotMatch(component, /dangerouslySetInnerHTML|innerHTML|outerHTML/u);
});

test('toast styles map variants to semantic system-state tokens', () => {
  const styles = read('src/styles.css');

  assert.match(styles, /\.toast-viewport\s*\{/u);
  for (const [variant, token] of [
    ['positive', '--accent-leaf'],
    ['negative', '--danger'],
    ['warning', '--caution'],
    ['info', '--accent-sky'],
  ]) {
    assert.match(styles, new RegExp(`\\.toast--${variant}[^}]*${token}`, 'su'), `${variant} has no semantic accent`);
  }
});

test('the root shell mounts the provider and the rubric editor consumes it', () => {
  assert.match(read('apps/web/app/layout.tsx'), /<ToastProvider>\{children\}<\/ToastProvider>/u);
  assert.match(read('apps/web/components/rubric-editor.tsx'), /useToast/u);
  assert.doesNotMatch(read('apps/web/components/rubric-editor.tsx'), /rubric-status/u);
});
