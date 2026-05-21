import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const manifest = JSON.parse(await readFile(new URL('../manifest.webmanifest', import.meta.url), 'utf8'));
const workflow = await readFile(new URL('../.github/workflows/pages.yml', import.meta.url), 'utf8');

test('page has mobile, PWA, and accessible landmark basics', () => {
  assert.match(html, /<meta name="viewport"/);
  assert.match(html, /<link rel="manifest"/);
  assert.match(html, /<main>/);
  assert.match(html, /<h1>Cleaning Coach<\/h1>/);
  assert.match(html, /aria-live="polite"/);
});

test('manifest supports installable standalone PWA', () => {
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, './');
  assert.ok(manifest.icons.length > 0);
});

test('pages workflow validates PRs and cache-busts service worker on deploy build', () => {
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /npm test/);
  assert.match(workflow, /sed -i "s\/__BUILD_VERSION__\/\$\{GITHUB_SHA\}\/g" _site\/sw.js/);
});
