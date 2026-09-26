// Import only verified, public build output from the separate DFM web project.
// Does not copy deployment scripts, credentials, virtualenvs or stale bundles.
import { readFile, readdir, mkdir, copyFile, writeFile, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const target = fileURLToPath(new URL('../', import.meta.url));
const source = resolve(process.argv[2] || resolve(target, '../dfm-plus-gongyi/web'));
const hashOf = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (...args) => execFileSync('git', ['-C', target, ...args], { encoding: 'utf8' }).trim();
if (resolve(git('rev-parse', '--show-toplevel')).toLowerCase() !== resolve(target).toLowerCase() ||
    git('branch', '--show-current') !== 'main') throw new Error('Run the importer in this repository on main.');
if ((await readFile(resolve(target, 'CNAME'), 'utf8')).trim() !== 'enenh.com')
  throw new Error('The expected Pages domain is missing; preserve/review CNAME first.');
if (source.toLowerCase() === resolve(target).toLowerCase()) throw new Error('Source and destination must differ.');

const safePath = name => ['index.html', 'styles.css', 'nodes.json'].includes(name) || /^assets\/[A-Za-z0-9_-]+\.js$/.test(name);
const manifest = JSON.parse(await readFile(resolve(source, 'dist/build-manifest.json'), 'utf8'));
if (manifest.version !== 1 || !Array.isArray(manifest.files) || !/^[a-f0-9]{64}$/.test(manifest.sourceHash))
  throw new Error('Invalid build manifest.');
const sources = ['build.mjs', 'index.html', 'styles.css', 'nodes.json', 'package.json', 'package-lock.json'];
async function collect(directory) {
  for (const entry of await readdir(resolve(source, directory), { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error('Unexpected source symlink.');
    const name = directory + '/' + entry.name;
    if (entry.isDirectory()) await collect(name); else sources.push(name);
  }
}
await collect('src');
const sourceHash = createHash('sha256');
for (const name of sources.sort()) {
  sourceHash.update(name + '\0'); sourceHash.update(await readFile(resolve(source, name))); sourceHash.update('\0');
}
if (sourceHash.digest('hex') !== manifest.sourceHash) throw new Error('Source changed: rebuild the web project before syncing.');
const files = new Map();
for (const entry of manifest.files) {
  if (typeof entry.path !== 'string' || !safePath(entry.path) || files.has(entry.path)) throw new Error('Unsafe/duplicate output path.');
  const bytes = await readFile(resolve(source, 'dist', entry.path));
  if (hashOf(bytes) !== entry.sha256) throw new Error('Build checksum mismatch: ' + entry.path);
  files.set(entry.path, bytes);
}
for (const name of ['index.html', 'styles.css', 'nodes.json', 'assets/app.js', 'assets/model-worker.js'])
  if (!files.has(name)) throw new Error('Missing required static asset: ' + name);
const html = files.get('index.html').toString('utf8');
for (const match of html.matchAll(/(?:src|href)="\.\/([^"?#]+)"/g))
  if (!files.has(match[1])) throw new Error('Missing HTML asset: ' + match[1]);
const nodes = JSON.parse(files.get('nodes.json').toString('utf8'));
if (!Array.isArray(nodes) || nodes.length !== 5) throw new Error('Unexpected public node inventory.');

let previous = null;
try { previous = JSON.parse(await readFile(resolve(target, 'build-manifest.json'), 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const obsolete = [];
for (const entry of previous?.files || []) {
  if (!safePath(entry.path)) throw new Error('Unsafe previous output path.');
  if (!files.has(entry.path) && entry.path.startsWith('assets/')) {
    const absolute = resolve(target, entry.path);
    if (hashOf(await readFile(absolute)) !== entry.sha256) throw new Error('An obsolete asset was locally modified: ' + entry.path);
    obsolete.push(absolute); // Validated, individual generated files only; never recursive deletion.
  }
}
// The entrypoint is copied last. Preserve CNAME, .git and all unrelated files.
for (const name of [...files.keys()].sort((a, b) => Number(a === 'index.html') - Number(b === 'index.html'))) {
  await mkdir(dirname(resolve(target, name)), { recursive: true });
  await copyFile(resolve(source, 'dist', name), resolve(target, name));
}
for (const absolute of obsolete) await unlink(absolute);
await writeFile(resolve(target, 'build-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Imported ${files.size} verified static files; preserved CNAME. Removed ${obsolete.length} obsolete generated assets.`);
