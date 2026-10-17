// Offline DFCOL v1 decoder. No device or process access.
// Layout and transform order follow user/DFCOL_FORMAT.md and dfcol_loader.cpp.
import * as THREE from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';

const MAGIC = [0x44, 0x46, 0x43, 0x4f, 0x4c, 13, 10, 26];
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function requireThat(condition, reason) {
  if (!condition) throw new Error(reason);
}
class Cursor {
  constructor(bytes) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.offset = 0;
  }
  take(count) {
    requireThat(Number.isSafeInteger(count) && count >= 0 && count <= this.bytes.length - this.offset,
      `Truncated or oversized DFCOL record at ${this.offset}`);
    const offset = this.offset;
    this.offset += count;
    return offset;
  }
  u8() { return this.view.getUint8(this.take(1)); }
  u32() { return this.view.getUint32(this.take(4), true); }
  f32() {
    const value = this.view.getFloat32(this.take(4), true);
    requireThat(Number.isFinite(value), 'Non-finite DFCOL float');
    return value;
  }
  floats(count) { return Array.from({ length: count }, () => this.f32()); }
  floatArray(count) {
    const start = this.take(count * 4);
    // Convex records can leave the next section unaligned. Copy before viewing.
    const result = new Float32Array(this.bytes.slice(start, this.offset).buffer);
    requireThat(result.every(Number.isFinite), 'Non-finite vertex');
    return result;
  }
}
export function readHeader(bytes) {
  requireThat(bytes.length >= 64 && bytes.length <= 1024 ** 3, 'Invalid DFCOL file size');
  const c = new Cursor(bytes);
  requireThat(MAGIC.every(value => c.u8() === value), 'Invalid DFCOL magic');
  requireThat(c.u32() === 1 && c.u32() === 64 && c.u32() === 0x01020304 && c.u32() === 1,
    'Unsupported DFCOL version/header/endian/flags');
  const counts = Array.from({ length: 5 }, () => c.u32());
  requireThat(c.u32() === 0, 'Nonzero reserved header field');
  const payloadBytes = Number(c.view.getBigUint64(c.take(8), true));
  const payloadCrc = c.u32();
  const headerCrc = c.u32();
  requireThat(payloadBytes === bytes.length - 64, 'Payload length mismatch');
  requireThat(crc32(bytes.subarray(0, 60)) === headerCrc, 'Header CRC32 mismatch');
  requireThat(crc32(bytes.subarray(64)) === payloadCrc, 'Payload CRC32 mismatch');
  const minimum = counts.reduce((sum, n, i) => sum + n * [12, 24, 12, 12, 92][i], 0);
  requireThat(minimum <= payloadBytes, 'Impossible section counts');
  return { counts, payloadBytes, payloadCrc, headerCrc, cursor: c };
}
function quaternion(values) {
  const q = new THREE.Quaternion(...values);
  requireThat(q.lengthSq() > 1e-12 && Number.isFinite(q.lengthSq()), 'Invalid quaternion');
  return q.normalize();
}
function pose(c) {
  const q = quaternion(c.floats(4));
  return new THREE.Matrix4().compose(new THREE.Vector3(...c.floats(3)), q, new THREE.Vector3(1, 1, 1));
}
export function meshScaleMatrix(scale, rotation) {
  const r = new THREE.Matrix4().makeRotationFromQuaternion(rotation);
  // PxMeshScale::transform(v) = R^-1 * S * R * v (not R * S * R^-1).
  return r.clone().transpose().multiply(new THREE.Matrix4().makeScale(...scale)).multiply(r);
}
function geometry(kind, positions, indices, extra = {}) {
  requireThat(positions.length >= 9 && indices.length >= 3 && indices.length % 3 === 0, 'Empty geometry');
  const bounds = new THREE.Box3().setFromArray(positions);
  return { kind, positions, indices, bounds, ...extra };
}
export function decodeDfcol(input) {
  const bytes = input instanceof Uint8Array && input.constructor === Uint8Array ? input : new Uint8Array(input);
  const { counts, cursor: c, ...header } = readHeader(bytes);
  const groups = [[], [], [], []];
  for (let n = 0; n < counts[0]; n++) {
    const vertices = c.u32(), triangles = c.u32(), flags = c.u32();
    requireThat(vertices >= 3 && vertices <= 4_000_000 && triangles > 0 && triangles <= 8_000_000 && !(flags & ~6), 'Invalid triangle-mesh counts/flags');
    const positions = c.floatArray(vertices * 3);
    const short = Boolean(flags & 2);
    requireThat(!short || vertices <= 65536, 'Too many vertices for u16 indices');
    const start = c.take(triangles * 3 * (short ? 2 : 4));
    const packed = bytes.slice(start, c.offset).buffer;
    const indices = short ? Uint32Array.from(new Uint16Array(packed)) : new Uint32Array(packed);
    requireThat(indices.every(index => index < vertices), 'Out-of-range triangle index');
    groups[0].push(geometry(0, positions, indices));
  }
  for (let n = 0; n < counts[1]; n++) {
    const rows = c.u32(), columns = c.u32();
    const hs = c.f32(), rs = c.f32(), cs = c.f32(), flags = c.u8();
    c.take(3);
    requireThat(rows >= 2 && columns >= 2 && rows * columns <= 16_000_000 && hs > 0 && rs > 0 && cs > 0 && !(flags & ~2), 'Invalid height field');
    const samples = c.take(rows * columns * 4);
    const positions = new Float32Array(rows * columns * 3);
    const indices = new Uint32Array((rows - 1) * (columns - 1) * 6);
    let count = 0;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < columns; col++) {
        const i = row * columns + col, p = samples + i * 4;
        positions.set([row * rs, c.view.getInt16(p, true) * hs, col * cs], i * 3);
        if (row === rows - 1 || col === columns - 1) continue;
        const m0 = bytes[p + 2], m1 = bytes[p + 3];
        const a = i, b = i + 1, d = i + columns, e = d + 1;
        if ((m0 & 127) !== 127) {
          indices.set(m0 & 128 ? [d, a, e] : [a, b, d], count); count += 3;
        }
        if ((m1 & 127) !== 127) {
          indices.set(m0 & 128 ? [b, e, a] : [e, d, b], count); count += 3;
        }
      }
    }
    groups[1].push(geometry(1, positions, indices.slice(0, count), { storedScale: [cs, hs, rs] }));
  }
  for (let n = 0; n < counts[2]; n++) {
    const half = c.floats(3);
    requireThat(half.every(value => value > 0), 'Invalid box half extents');
    const box = new THREE.BoxGeometry(...half.map(value => value * 2));
    groups[2].push(geometry(2, box.attributes.position.array, Uint32Array.from(box.index.array), { storedScale: half }));
    box.dispose();
  }
  let convexRecovered = 0;
  for (let n = 0; n < counts[3]; n++) {
    const vertices = c.u32(), flatCount = c.u32(), polygonCount = c.u32();
    requireThat(vertices >= 4 && vertices <= 256 && polygonCount >= 4 && polygonCount <= 255 && flatCount >= polygonCount * 3 && flatCount <= 4096, 'Invalid convex counts');
    const positions = c.floatArray(vertices * 3);
    const start = c.take(flatCount), indices = bytes.subarray(start, c.offset);
    requireThat(indices.every(index => index < vertices), 'Out-of-range convex index');
    // DFCOL v1 lacks polygon boundaries. Recover the closed convex volume from
    // referenced points; triangulation may differ from the Android polygon solver.
    const points = [...new Set(indices)].map(index => new THREE.Vector3().fromArray(positions, index * 3));
    const hull = new ConvexGeometry(points);
    requireThat(hull.attributes.position.count >= 12, 'Failed to recover a closed convex hull');
    const hp = hull.attributes.position.array;
    groups[3].push(geometry(3, hp, Uint32Array.from({ length: hp.length / 3 }, (_, i) => i)));
    hull.dispose();
    convexRecovered++;
  }
  requireThat(bytes.length - c.offset === counts[4] * 92, 'Actor section size mismatch');
  const geometries = groups.flat(), actors = [];
  const bases = [0, counts[0], counts[0] + counts[1], counts[0] + counts[1] + counts[2]];
  for (let n = 0; n < counts[4]; n++) {
    const actor = pose(c), kind = c.u8(); c.take(3);
    const scale = c.floats(3), scaleRotation = quaternion(c.floats(4));
    const local = pose(c), id = c.u32();
    requireThat(kind < 4 && id < groups[kind].length, 'Invalid actor geometry reference');
    const geo = groups[kind][id];
    let scaling = new THREE.Matrix4();
    if (kind === 0 || kind === 3) {
      requireThat(scale.every(value => Math.abs(value) >= 1e-8) && (kind !== 3 || scale.every(value => value > 0)), 'Singular/invalid actor scale');
      scaling = meshScaleMatrix(scale, scaleRotation);
    } else {
      requireThat(scale.every((value, i) => Math.abs(value - geo.storedScale[i]) <= Math.max(1e-6, Math.abs(value) * 1e-5)), 'Inconsistent baked geometry scale');
      requireThat(Math.abs(scaleRotation.x) + Math.abs(scaleRotation.y) + Math.abs(scaleRotation.z) < 3e-5, 'Unexpected baked scale rotation');
    }
    actors.push({ geometry: bases[kind] + id, matrix: actor.multiply(local).multiply(scaling) });
  }
  requireThat(actors.length > 0 && c.offset === bytes.length, 'Empty scene or trailing payload');
  return { counts, ...header, convexRecovered, geometries, actors };
}

// UE left-handed Z-up centimetres -> Three.js right-handed Y-up metres.
// Swapping Y/Z changes handedness; negating Y as well would mirror the world.
// Keep markerScenePosition in core.mjs aligned: [(X-Ox), (Z-Oz), (Y-Oy)] / 100.
export function sceneBasis(origin) {
  return new THREE.Matrix4().set(
    .01, 0, 0, -origin[0] * .01,
    0, 0, .01, -origin[2] * .01,
    0, .01, 0, -origin[1] * .01,
    0, 0, 0, 1);
}
