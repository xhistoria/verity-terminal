import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { build } from 'esbuild';

const root = new URL('../', import.meta.url);
const publicDir = new URL('../public/', import.meta.url);
const distDir = new URL('../dist/', import.meta.url);
const requiredText = ['index.html', 'docs.html', 'receipt.html', 'styles.css', 'app.js', 'receipt.js'];
const requiredBinary = ['inter-variable.woff2'];
const forbidden = ['PRIVATE_KEY', 'SEED_PHRASE', 'CLOUDFLARE_API_TOKEN', 'RPC_URL='];
const reownProjectId = process.env.REOWN_PROJECT_ID || '';
const walletConnectStub = {
  name: 'walletconnect-unconfigured-stub',
  setup(context) {
    context.onResolve({ filter: /^@wagmi\/connectors\/walletConnect$/ }, () => ({ path: 'walletconnect-stub', namespace: 'verity' }));
    context.onLoad({ filter: /.*/, namespace: 'verity' }, () => ({
      contents: "export function walletConnect(){throw new Error('walletconnect_not_configured')}",
      loader: 'js',
    }));
  },
};

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });
await cp(publicDir, distDir, { recursive: true });
await rm(new URL('../dist/logic.js', import.meta.url), { force: true });
await rm(new URL('../dist/wallet-config.js', import.meta.url), { force: true });
await rm(new URL('../dist/wallet-runtime.js', import.meta.url), { force: true });
await rm(new URL('../dist/journal.js', import.meta.url), { force: true });
await build({
  entryPoints: {
    app: new URL('../public/app.js', import.meta.url).pathname,
    receipt: new URL('../public/receipt.js', import.meta.url).pathname,
  },
  outdir: new URL('../dist/', import.meta.url).pathname,
  entryNames: '[name]',
  chunkNames: 'chunks/[name]-[hash]',
  bundle: true,
  splitting: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2022'],
  minify: true,
  legalComments: 'none',
  plugins: reownProjectId ? [] : [walletConnectStub],
  define: {
    __REOWN_PROJECT_ID__: JSON.stringify(reownProjectId),
  },
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
