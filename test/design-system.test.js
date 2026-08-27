import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [html, styles, tokens] = await Promise.all([
  readFile(new URL('public/index.html', root), 'utf8'),
  readFile(new URL('public/styles.css', root), 'utf8'),
  readFile(new URL('public/tokens.css', root), 'utf8').catch(() => ''),
]);

test('ships and imports the supplied design token system', () => {
  assert.match(styles, /^@import url\(['"]\/tokens\.css['"]\);/);
  for (const token of ['--accent: #c3f53c', '--canvas: #050706', '--surface-1: #101510', '--radius-surface: 28px', '--space-section: 8rem']) {
    assert.ok(tokens.includes(token), `missing supplied token: ${token}`);
  }
});

test('component stylesheet invents no colors or spacing variables', () => {
  assert.doesNotMatch(styles, /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i);
  const definitions = new Set([...tokens.matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1]));
  const uses = [...styles.matchAll(/var\((--[\w-]+)/g)].map((match) => match[1]);
  assert.ok(uses.length > 20, 'expected token-driven styling');
  for (const used of uses) assert.ok(definitions.has(used), `undefined or invented token: ${used}`);
});

test('implements the design typography, floating chrome, and accessibility baseline', () => {
  assert.match(html, /class="nav floating-nav/);
  assert.match(styles, /h1,\s*h2,\s*h3\s*\{[^}]*font-weight:\s*400/s);
  assert.match(styles, /:focus-visible/);
  assert.match(styles, /min-height:\s*44px/);
  assert.match(styles, /@media\s*\(max-width:\s*1024px\)/);
  assert.match(styles, /@media\s*\(max-width:\s*768px\)/);
  assert.match(styles, /prefers-reduced-motion:\s*reduce/);
  assert.doesNotMatch(html, /fonts\.googleapis|cdn\.jsdelivr/);
});
