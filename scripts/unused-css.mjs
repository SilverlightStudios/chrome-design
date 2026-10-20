#!/usr/bin/env node
/**
 * Fails when a class in the in-page UI's styles (src/content/styles) is used nowhere in the
 * code, so dead CSS doesn't pile up. A class built in code (`ai-${name}`) counts as used when
 * its prefix is built that way.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );
const code = walk(join(root, 'src'))
  .filter((f) => /\.(tsx?|html)$/.test(f))
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n');
const built = (name) => {
  const parts = name.split('-');
  return parts.some((_, i) => i > 0 && code.includes(`${parts.slice(0, i).join('-')}-\${`));
};

const unused = [];
for (const file of walk(join(root, 'src/content/styles')).filter((f) => f.endsWith('.css'))) {
  const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const names = new Set([...css.matchAll(/\.([a-zA-Z_][\w-]*)/g)].map((m) => m[1]));
  for (const name of names)
    if (!code.includes(name) && !built(name))
      unused.push(`${file.slice(root.length + 1)}: .${name}`);
}
if (unused.length) {
  console.error(`Classes no code uses (remove them, or use them):\n${unused.join('\n')}`);
  process.exit(1);
}
