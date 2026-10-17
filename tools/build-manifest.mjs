import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const dist = resolve(root, 'dist');
export const staticFiles = ['index.html', 'styles.css', 'nodes.json', 'CNAME', '.nojekyll'];
export const requiredFiles = [...staticFiles, 'assets/app.js', 'assets/model-worker.js'];
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const publicPath = name => staticFiles.includes(name) || /^assets\/[A-Za-z0-9_-]+\.js$/.test(name);

export async function filesUnder(directory, prefix = '') {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = prefix + entry.name;
    if (entry.isDirectory()) files.push(...await filesUnder(resolve(directory, entry.name), name + '/'));
    else if (entry.isFile()) files.push(name);
    else throw new Error('Unexpected link or special file: ' + name);
  }
  return files.sort();
}

export async function sourceHash() {
  const names = [...staticFiles, 'build.mjs', 'tools/build-manifest.mjs', 'package.json', 'package-lock.json',
    ...(await filesUnder(resolve(root, 'src'))).map(name => 'src/' + name)];
  const hash = createHash('sha256');
  for (const name of names.sort()) {
    hash.update(name + '\0');
    hash.update(await readFile(resolve(root, name)));
    hash.update('\0');
  }
  return hash.digest('hex');
}

export function validateNodes(nodes) {
  const ids = new Set();
  if (!Array.isArray(nodes) || nodes.length === 0) throw new Error('The public node inventory is empty.');
  for (const node of nodes) {
    if (!node || Object.keys(node).some(key => !['id', 'name', 'host', 'port'].includes(key)) ||
        !Number.isInteger(node.id) || node.id < 1 || node.id > 9 || ids.has(node.id) ||
        typeof node.name !== 'string' || !node.name.trim() ||
        typeof node.host !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9.-]*$/.test(node.host) ||
        !Number.isInteger(node.port) || node.port < 1 || node.port > 65535)
      throw new Error('Invalid public node entry; only id, name, host and port are allowed.');
    ids.add(node.id);
  }
}
