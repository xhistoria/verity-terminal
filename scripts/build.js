import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { build } from 'esbuild';

const root = new URL('../', import.meta.url);
const publicDir = new URL('../public/', import.meta.url);
const distDir = new URL('../dist/', import.meta.url);
const requiredText = ['index.html', 'styles.css', 'app.js'];
const requiredBinary = ['inter-variable.woff2'];
const forbidden = ['PRIVATE_KEY', 'SEED_PHRASE', 'CLOUDFLARE_API_TOKEN', 'RPC_URL='];

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });
await cp(publicDir, distDir, { recursive: true });
await rm(new URL('../dist/logic.js', import.meta.url), { force: true });
await build({
  entryPoints: [new URL('../public/app.js', import.meta.url).pathname],
  outfile: new URL('../dist/app.js', import.meta.url).pathname,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2022'],
  minify: true,
  legalComments: 'none',
});

const manifest = {};
for (const file of requiredText) {
  const content = await readFile(new URL(`../dist/${file}`, import.meta.url), 'utf8');
  for (const marker of forbidden) {
    if (content.includes(marker)) throw new Error(`forbidden_public_marker:${marker}`);
  }
  manifest[file] = Buffer.byteLength(content);
}
for (const file of requiredBinary) {
  manifest[file] = (await stat(new URL(`../dist/${file}`, import.meta.url))).size;
}
await writeFile(join(new URL('.', root).pathname, 'dist', 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Built ${Object.keys(manifest).length} public assets with bundled calldata validation.`);
