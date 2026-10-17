// Resolve one ZIP entry entirely in the browser; never fetch the full archive.
export const MODEL_ARCHIVE_URL = 'https://gh-proxy.org/https://github.com/enenH/dfm-pak-cover-model-dumper/releases/download/v1.0/models.zip';
const MAP_NAMES = new Set(['AZ-5', 'Brakkesh', 'Dam_Iris', 'Forrest', 'SecretService', 'SpaceCenter', 'Tide']);
const MAX_INDEX_BYTES = 2 * 1024 * 1024;
const invalid = () => new Error('模型 ZIP 目录无效或格式不受支持');
const viewOf = bytes => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

export async function readExact(response, length) {
  const bytes = new Uint8Array(length), reader = response.body?.getReader();
  if (!reader) throw new Error('模型分段响应为空');
  let received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (received + value.length > length) throw new Error('服务器返回了超出请求范围的数据');
      bytes.set(value, received); received += value.length;
    }
    if (received !== length) throw new Error('模型分段不完整');
    return bytes;
  } finally { await reader.cancel().catch(() => {}); }
}

export async function resolveArchiveEntry(name, signal, fetcher = fetch) {
  if (!MAP_NAMES.has(name)) throw new Error('模型包中没有这张地图');
  let snapshot, requested = 0;
  const read = async (start, length) => {
    if (signal.aborted) throw new DOMException('已取消模型加载', 'AbortError');
    if (!Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(length) || length < 1 ||
        (requested += length) > MAX_INDEX_BYTES || (snapshot && start + length > snapshot.archiveBytes)) throw invalid();
    const end = start + length - 1;
    const response = await fetcher(MODEL_ARCHIVE_URL, { signal, headers: { Range: `bytes=${start}-${end}` },
      mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' });
    const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('Content-Range') || '');
    const etag = response.headers.get('ETag'), archiveBytes = Number(match?.[3]);
    if (response.status !== 206 || !match || Number(match[1]) !== start || Number(match[2]) !== end ||
        !Number.isSafeInteger(archiveBytes) || archiveBytes <= end || archiveBytes > 2 ** 32 || !etag ||
        (snapshot && (snapshot.archiveBytes !== archiveBytes || snapshot.etag !== etag))) {
      await response.body?.cancel();
      throw new Error('模型目录分段或版本不匹配，请重试');
    }
    snapshot = { archiveBytes, etag };
    return readExact(response, length);
  };

  await read(0, 1);
  const { archiveBytes, etag } = snapshot;
  if (archiveBytes < 22) throw invalid();
  let tailStart = archiveBytes - 22, tail = await read(tailStart, 22), endAt = -1;
  const findEnd = () => {
    const view = viewOf(tail);
    for (let at = tail.length - 22; at >= 0; at--)
      if (view.getUint32(at, true) === 0x06054b50 && at + 22 + view.getUint16(at + 20, true) === tail.length) return at;
    return -1;
  };
  endAt = findEnd();
  if (endAt < 0) {
    tailStart = Math.max(0, archiveBytes - 65557);
    tail = await read(tailStart, archiveBytes - tailStart);
    endAt = findEnd();
  }
  if (endAt < 0) throw invalid();
  const end = viewOf(tail.subarray(endAt)), count = end.getUint16(10, true);
  const directoryBytes = end.getUint32(12, true), directoryOffset = end.getUint32(16, true);
  // ZIP64 and multi-disk archives are deliberately outside the model budget.
  if (end.getUint16(4, true) || end.getUint16(6, true) || count !== end.getUint16(8, true) ||
      count < 1 || count > 128 || !directoryBytes || directoryOffset === 0xffffffff ||
      directoryOffset + directoryBytes > tailStart + endAt) throw invalid();
  const directory = await read(directoryOffset, directoryBytes), view = viewOf(directory), entries = new Map();
  let at = 0;
  for (let i = 0; i < count; i++) {
    if (at + 46 > directory.length || view.getUint32(at, true) !== 0x02014b50) throw invalid();
    const filenameBytes = view.getUint16(at + 28, true);
    const next = at + 46 + filenameBytes + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
    if (next > directory.length || view.getUint16(at + 34, true)) throw invalid();
    const filename = directory.slice(at + 46, at + 46 + filenameBytes);
    const leaf = new TextDecoder().decode(filename).replaceAll('\\', '/').split('/').at(-1);
    const map = leaf.endsWith('.dfcol') ? leaf.slice(0, -6) : '';
    if (MAP_NAMES.has(map)) {
      const entry = { filename, flags: view.getUint16(at + 8, true), method: view.getUint16(at + 10, true),
        crc32: view.getUint32(at + 16, true), compressedBytes: view.getUint32(at + 20, true),
        bytes: view.getUint32(at + 24, true), headerOffset: view.getUint32(at + 42, true) };
      if (entries.has(map) || (entry.flags & 65) || ![0, 8].includes(entry.method) ||
          entry.compressedBytes < 1 || entry.compressedBytes > 64 * 1024 ** 2 || entry.bytes < 64 || entry.bytes > 128 * 1024 ** 2 ||
          (entry.method === 0 && entry.compressedBytes !== entry.bytes) || entry.headerOffset + 30 > directoryOffset) throw invalid();
      entries.set(map, entry);
    }
    at = next;
  }
  if (at !== directory.length) throw invalid();
  const entry = entries.get(name);
  if (!entry) throw new Error('模型包中没有这张地图');
  const header = viewOf(await read(entry.headerOffset, 30));
  if (header.getUint32(0, true) !== 0x04034b50 || header.getUint16(6, true) !== entry.flags ||
      header.getUint16(8, true) !== entry.method || header.getUint16(26, true) !== entry.filename.length) throw invalid();
  if (!(entry.flags & 8) && (header.getUint32(14, true) !== entry.crc32 ||
      header.getUint32(18, true) !== entry.compressedBytes || header.getUint32(22, true) !== entry.bytes)) throw invalid();
  const offset = entry.headerOffset + 30 + entry.filename.length + header.getUint16(28, true);
  if (offset + entry.compressedBytes > directoryOffset) throw invalid();
  const filename = await read(entry.headerOffset + 30, entry.filename.length);
  if (!filename.every((byte, i) => byte === entry.filename[i])) throw invalid();
  // An opaque cache identity, not a security hash. This also works on HTTP
  // Pages origins where crypto.subtle isn't available. Payload CRCs are checked separately.
  const version = `${etag}:${archiveBytes}:${entry.crc32}:${entry.compressedBytes}:${offset}`;
  return { name, url: MODEL_ARCHIVE_URL, version, etag, archiveBytes, offset,
    compressedBytes: entry.compressedBytes, bytes: entry.bytes, method: entry.method, crc32: entry.crc32 };
}
