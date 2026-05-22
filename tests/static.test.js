import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('app shell links runtime data and PWA metadata', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  const sw = await readFile(new URL('../sw.js', import.meta.url), 'utf8');

  assert.match(html, /manifest\.webmanifest/);
  assert.match(html, /id="notify-enabled"/);
  assert.match(html, /list="goal-options"/);
  assert.match(html, /id="build-ref"/);
  assert.match(app, /data\/cleaning-plan\.yml/);
  assert.match(app, /api\.sunrise-sunset\.org/);
  assert.match(app, /data-done=/);
  assert.match(app, /task-expiration/);
  assert.match(app, /CACHE_VERSION = '([^']+)'/);
  assert.match(sw, /cleaning-plan\.yml/);
  assert.match(sw, /CACHE_VERSION/);
});
