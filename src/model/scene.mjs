import * as THREE from 'three';
import { inflateSync } from 'fflate';
import { crc32, decodeDfcol, sceneBasis } from './dfcol.mjs';

const median = values => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];

export function decodeEntry(compressed, meta) {
  if (compressed.byteLength !== meta.compressedBytes || meta.bytes < 64 || meta.bytes > 128 * 1024 ** 2)
    throw new Error('模型数据大小异常');
  if (![0, 8].includes(meta.method)) throw new Error('不支持的 ZIP 压缩方法');
  const bytes = meta.method === 0 ? compressed : inflateSync(compressed, { out: new Uint8Array(meta.bytes) });
  if (bytes.length !== meta.bytes || crc32(bytes) !== meta.crc32) throw new Error('模型 ZIP CRC32 校验失败，请重试');
  return decodeDfcol(bytes);
}

export function compileScene(source) {
  const origin = [0, 1, 2].map(i => Math.round(median(source.actors.map(a => a.matrix.elements[12 + i])) / 100) * 100);
  const basis = sceneBasis(origin), bounds = new THREE.Box3();
  const groups = source.geometries.map(() => []);
  const centers = [[], [], []];
  for (const actor of source.actors) {
    const matrix = basis.clone().multiply(actor.matrix);
    const box = source.geometries[actor.geometry].bounds.clone().applyMatrix4(matrix);
    if (!box.min.toArray().concat(box.max.toArray(), matrix.elements).every(Number.isFinite)) throw new Error('模型坐标异常');
    groups[actor.geometry].push({ matrix, box });
    bounds.union(box);
    const center = box.getCenter(new THREE.Vector3()).toArray();
    center.forEach((value, i) => centers[i].push(value));
  }
  let bytes = 0;
  const geometries = source.geometries.flatMap((geometry, id) => {
    const instances = groups[id];
    if (!instances.length) return [];
    const matrices = new Float32Array(instances.length * 16);
    const boxes = new Float32Array(instances.length * 6);
    instances.forEach(({ matrix, box }, i) => {
      matrices.set(matrix.elements, i * 16);
      boxes.set(box.min.toArray().concat(box.max.toArray()), i * 6);
    });
    bytes += geometry.positions.byteLength + geometry.indices.byteLength + matrices.byteLength + boxes.byteLength;
    if (bytes > 384 * 1024 ** 2) throw new Error('模型展开后超过浏览器内存预算');
    return [{ id, kind: geometry.kind, positions: geometry.positions, indices: geometry.indices, matrices, boxes }];
  });
  return { origin, bounds: bounds.min.toArray().concat(bounds.max.toArray()), focus: centers.map(median),
    geometries, actors: source.actors.length, decodedBytes: bytes };
}

export function selectInstances(record, center, radius) {
  const result = [], b = record.boxes, r2 = radius * radius;
  for (let i = 0; i < b.length; i += 6) {
    const dx = Math.max(b[i] - center[0], 0, center[0] - b[i + 3]);
    const dz = Math.max(b[i + 2] - center[2], 0, center[2] - b[i + 5]);
    if (dx * dx + dz * dz <= r2) result.push(i / 6);
  }
  return result;
}
