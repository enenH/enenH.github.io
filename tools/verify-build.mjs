import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { root, dist, requiredFiles, publicPath, filesUnder, sha256, sourceHash, validateNodes } from './build-manifest.mjs';

const manifest = JSON.parse(await readFile(resolve(dist, 'build-manifest.json'), 'utf8'));
assert.equal(manifest.version, 1, 'Unknown build manifest version.');
assert.equal(manifest.sourceHash, await sourceHash(), 'Source has changed; rebuild before publishing.');
assert.ok(Array.isArray(manifest.files), 'Missing build file list.');
const names = new Set();
for (const entry of manifest.files) {
  assert.ok(typeof entry.path === 'string' && publicPath(entry.path), 'Unexpected public file: ' + entry.path);
  assert.ok(!names.has(entry.path), 'Duplicate public file: ' + entry.path);
  names.add(entry.path);
  assert.equal(sha256(await readFile(resolve(dist, entry.path))), entry.sha256, 'Output changed: ' + entry.path);
}
for (const name of requiredFiles) assert.ok(names.has(name), 'Missing public file: ' + name);
assert.deepEqual(await filesUnder(dist), [...names, 'build-manifest.json'].sort(), 'Unlisted files in dist/.');
assert.equal((await readFile(resolve(dist, 'CNAME'), 'utf8')).trim(), 'enenh.com', 'Unexpected Pages domain.');
validateNodes(JSON.parse(await readFile(resolve(dist, 'nodes.json'), 'utf8')));
const html = await readFile(resolve(dist, 'index.html'), 'utf8');
assert.ok(html.includes('./assets/app.js') && !html.includes('./src/app.mjs'), 'HTML must load the bundled entry point.');
for (const match of html.matchAll(/(?:src|href)="\.\/([^"?#]+)"/g))
  assert.ok(names.has(match[1]), 'Missing HTML resource: ' + match[1]);
console.log(`Verified ${names.size} public files from ${root}; no source, private files or stale bundles in dist/.`);
