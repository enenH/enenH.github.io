import { compileScene, decodeEntry } from './scene.mjs';

self.onmessage = ({ data }) => {
  try {
    self.postMessage({ type: 'progress', text: '解压并校验当前地图…' });
    const decoded = decodeEntry(new Uint8Array(data.compressed), data.meta);
    self.postMessage({ type: 'progress', text: '构建地图几何与实例…' });
    const scene = compileScene(decoded);
    const buffers = new Set([data.compressed]);
    for (const record of scene.geometries)
      for (const array of [record.positions, record.indices, record.matrices, record.boxes]) buffers.add(array.buffer);
    self.postMessage({ type: 'ready', scene, compressed: data.compressed }, [...buffers]);
  } catch (error) {
    self.postMessage({ type: 'error', message: error.message });
  }
};
