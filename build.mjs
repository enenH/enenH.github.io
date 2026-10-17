import { build } from 'esbuild';
import { mkdir, copyFile, readFile, writeFile, rm, lstat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { root, dist, staticFiles, sha256, sourceHash, validateNodes } from './tools/build-manifest.mjs';

validateNodes(JSON.parse(await readFile(resolve(root, 'nodes.json'), 'utf8')));
const inputHash = await sourceHash();
// This is the only generated directory removed by the build. Never follow a link.
if (dirname(dist) !== resolve(root) || (await lstat(dist).catch(error => {
  if (error.code !== 'ENOENT') throw error;
}))?.isSymbolicLink()) throw new Error('Unsafe build output directory.');
await rm(dist, { recursive: true, force: true });
await mkdir(resolve(dist, 'assets'), { recursive: true });
const app = await build({ absWorkingDir: root, entryPoints: ['src/app.mjs'], outdir: 'dist/assets',
  bundle: true, splitting: true, format: 'esm', target: 'es2022', minify: true,
  entryNames: 'app', chunkNames: 'chunk-[hash]', metafile: true });
const worker = await build({ absWorkingDir: root, entryPoints: ['src/model/worker.mjs'], outfile: 'dist/assets/model-worker.js',
  bundle: true, format: 'esm', target: 'es2022', minify: true, metafile: true });
for (const name of staticFiles.filter(name => name !== 'index.html'))
  await copyFile(resolve(root, name), resolve(dist, name));
const html = await readFile(new URL('index.html', import.meta.url), 'utf8');
await writeFile(new URL('dist/index.html', import.meta.url), html.replace('./src/app.mjs', './assets/app.js'));
if (inputHash !== await sourceHash()) throw new Error('Source changed during the build; build again.');
const files = [...staticFiles, ...Object.keys(app.metafile.outputs), ...Object.keys(worker.metafile.outputs)].map(path => path.replace(/^dist\//, ''));
const manifest = { version: 1, sourceHash: inputHash, files: [] };
for (const path of [...new Set(files)].sort()) manifest.files.push({ path, sha256: sha256(await readFile(resolve(dist, path))) });
await writeFile(new URL('dist/build-manifest.json', import.meta.url), JSON.stringify(manifest, null, 2));
console.log('Built dist/ for GitHub Pages. npm start previews at http://127.0.0.1:5173/ with /ws proxied to the local relay.');
