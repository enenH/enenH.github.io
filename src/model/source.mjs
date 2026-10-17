import { ModelCache } from './cache.mjs';
import { MODEL_ARCHIVE_URL, readExact, resolveArchiveEntry } from './archive.mjs';

export const CHUNK_BYTES = 1024 * 1024;
const cache = new ModelCache();
const abortError = () => new DOMException('已取消模型加载', 'AbortError');
const checkAbort = signal => { if (signal.aborted) throw abortError(); };

export function validateMetadata(meta, name) {
  const url = new URL(meta.url);
  if (meta.name !== name || url.href !== MODEL_ARCHIVE_URL || url.username || url.password)
    throw new Error('模型直链来源异常');
  for (const field of ['offset', 'compressedBytes', 'bytes', 'archiveBytes', 'crc32'])
    if (!Number.isSafeInteger(meta[field]) || meta[field] < 0) throw new Error('模型目录数据异常');
  if (meta.bytes < 64 || meta.bytes > 128 * 1024 ** 2 || meta.compressedBytes < 1 || meta.compressedBytes > 64 * 1024 ** 2 ||
      meta.offset + meta.compressedBytes > meta.archiveBytes || ![0, 8].includes(meta.method) ||
      typeof meta.version !== 'string' || !meta.version || meta.version.length > 1024 || typeof meta.etag !== 'string' || !meta.etag)
    throw new Error('模型目录超出大小或格式限制');
  return meta;
}

export async function resolveModel(name, signal, _refresh = false, fetcher = fetch) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(abort, 30000);
  try {
    checkAbort(signal);
    return validateMetadata(await resolveArchiveEntry(name, controller.signal, fetcher), name);
  } finally { clearTimeout(timeout); signal.removeEventListener('abort', abort); }
}

export async function readRange(meta, start, length, signal, fetcher = fetch) {
  const controller = new AbortController(), abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, 45000);
  try {
    checkAbort(signal);
    const end = start + length - 1;
    const response = await fetcher(meta.url, { headers: { Range: `bytes=${start}-${end}` }, signal: controller.signal,
      credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' });
    if (response.status !== 206) {
      await response.body?.cancel();
      const error = new Error(response.status === 204 ? '模型请求被下载器拦截，请关闭下载接管后重试' : `模型分段下载失败（${response.status}）`);
      error.status = response.status; throw error;
    }
    const etag = response.headers.get('ETag'), range = response.headers.get('Content-Range');
    // Length, ETag and final ZIP/DFCOL CRC protect every selected-map chunk.
    if (etag !== meta.etag || (range && range !== `bytes ${start}-${end}/${meta.archiveBytes}`)) {
      await response.body?.cancel(); throw new Error('模型包已更新或分段不匹配，请重新加载');
    }
    return await readExact(response, length);
  } finally {
    clearTimeout(timer); signal.removeEventListener('abort', abort);
  }
}

export async function downloadEntry(meta, { signal, onProgress = () => {}, fetcher = fetch, refresh = resolveModel }) {
  const parentSignal = signal, controller = new AbortController();
  const abort = () => controller.abort();
  parentSignal.addEventListener('abort', abort, { once: true });
  if (parentSignal.aborted) abort();
  signal = controller.signal;
  const result = new Uint8Array(meta.compressedBytes);
  let offset = 0, completed = 0, fresh = meta, renewing = null;
  async function lane() {
    while (offset < result.length) {
      checkAbort(signal);
      const at = offset, count = Math.min(CHUNK_BYTES, result.length - at); offset += count;
      for (let attempt = 0; ; attempt++) {
        try {
          const bytes = await readRange(fresh, fresh.offset + at, count, signal, fetcher);
          result.set(bytes, at); completed += count;
          onProgress(`下载当前地图 ${(completed / 1048576).toFixed(1)} / ${(result.length / 1048576).toFixed(1)} MiB`, completed / result.length);
          break;
        } catch (error) {
          checkAbort(signal);
          if (attempt >= 2 || error.status === 204) throw error;
          if (error.status === 401 || error.status === 403) {
            renewing ||= refresh(meta.name, signal, true, fetcher).finally(() => { renewing = null; });
            fresh = await renewing;
            if (fresh.version !== meta.version) throw new Error('模型包在下载期间更新，请重新加载');
          }
        }
      }
    }
  }
  try {
    await Promise.all(Array.from({ length: 3 }, lane));
    return result.buffer;
  } catch (error) { controller.abort(); throw error; }
  finally { parentSignal.removeEventListener('abort', abort); }
}

export async function loadModel(name, { signal, onProgress = () => {} }) {
  onProgress('读取模型包目录…', 0);
  const meta = await resolveModel(name, signal);
  let compressed = await cache.get(name, meta.version);
  checkAbort(signal);
  const cached = Boolean(compressed);
  if (cached) onProgress('使用已校验的本机地图缓存…', 1);
  else compressed = await downloadEntry(meta, { signal, onProgress });
  checkAbort(signal);
  const worker = new Worker(new URL('./model-worker.js', import.meta.url), { type: 'module' });
  try {
    const result = await new Promise((resolve, reject) => {
      const abort = () => { worker.terminate(); reject(abortError()); };
      const finish = callback => value => { signal.removeEventListener('abort', abort); callback(value); };
      signal.addEventListener('abort', abort, { once: true });
      worker.onerror = finish(() => reject(new Error('模型解码工作线程失败，请检查浏览器内存与静态资源')));
      worker.onmessage = ({ data }) => {
        if (data.type === 'progress') onProgress(data.text, 1);
        else if (data.type === 'ready') finish(resolve)(data);
        else if (data.type === 'error') finish(reject)(new Error(data.message));
      };
      worker.postMessage({ compressed, meta }, [compressed]);
    });
    checkAbort(signal);
    if (!cached) void cache.put(name, meta.version, result.compressed);
    return { ...result.scene, name, compressedBytes: meta.compressedBytes, cached };
  } catch (error) {
    if (error.name !== 'AbortError') void cache.remove(name);
    throw error;
  } finally { worker.terminate(); }
}
