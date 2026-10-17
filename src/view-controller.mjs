// One state stream and one map identity, with lazy model modules and cancellation.
import { allies, markerLabel, markerScenePosition } from './core.mjs';

export class ViewController {
  constructor({ flat, elements, notice, onTools, markerVisibility = {}, loadRuntime = () => Promise.all([import('./model/view.mjs'), import('./model/source.mjs')]) }) {
    Object.assign(this, { flat, elements, notice, onTools, loadRuntime });
    this.mode = 'flat'; this.config = null; this.sequence = 0; this.pending = null; this.modelView = null;
    this.markers = []; this.frame = null; this.stale = false;
    this.markerVisibility = { bot: markerVisibility.bot !== false, item: markerVisibility.item !== false };
    this.selectedAllyId = ''; this.followSignature = '';
  }
  get currentView() { return this.mode === 'flat' ? this.flat : this.modelView; }
  get visibleMarkers() { return this.stale ? [] : this.markers.filter(marker => this.markerVisibility[marker.kind] !== false); }
  get anchor() { return this.currentView?.getAllyPosition?.(this.selectedAllyId); }
  get ready() { return this.mode === 'flat' ? Boolean(this.config?.layer && this.flat) : Boolean(this.modelView?.model && !this.modelView.lost); }
  setMarkerVisibility(kind, visible) {
    if (!Object.hasOwn(this.markerVisibility, kind)) return;
    this.markerVisibility[kind] = Boolean(visible);
    this.render();
  }
  update(config, state) {
    this.frame = state; this.markers = state.markers;
    if (this.config?.id !== config?.id) {
      this.selectedAllyId = ''; this.modelView?.setFollowTarget?.('');
      this.cancel(); this.config = config; this.failed = false; this.modelView?.clearModel();
      this.flat?.setMap(config?.layer ? config : null);
      if (this.mode !== 'flat' && config) void this.ensureModel();
    }
    if (this.flat) this.flat.frame = state;
    if (this.modelView) this.modelView.frame = state;
    this.render();
  }
  render() {
    this.currentView?.render(this.visibleMarkers);
    if (this.mode !== 'flat') this.modelView?.setFollowTarget?.(this.selectedAllyId);
    this.updateCoordinateNotice(); this.onTools();
  }
  clearMarkers() { this.stale = true; this.flat?.clearMarkers(); this.modelView?.clearMarkers(); this.updateCoordinateNotice(); }
  updateCoordinateNotice() {
    const missing = this.modelView?.missingCoordinates || this.frame?.coordinatesValid === false ||
      (this.frame?.coordinateSpace !== 'persistent-cm' && !this.frame?.worldOrigin);
    this.elements.coordinates.hidden = this.mode === 'flat' || !this.modelView?.model || !missing || this.stale;
    this.elements.stats.hidden = this.mode === 'flat' || !this.modelView?.model;
    this.syncFollowUI();
  }
  followOptions() {
    const options = allies(this.markers).map(marker => ({ id: marker.id, label: markerLabel(marker),
      available: !this.stale && Boolean(this.frame && markerScenePosition(this.frame, marker, [0,0,0])) }));
    if (this.selectedAllyId && !options.some(option => option.id === this.selectedAllyId))
      options.push({ id: this.selectedAllyId, label: '所选队友暂不可用', available: false });
    return options;
  }
  selectAlly(id) {
    if (id && !this.followOptions().some(option => option.id === id && option.available)) return false;
    this.selectedAllyId = id;
    this.modelView?.setFollowTarget?.(id);
    this.syncFollowUI(); this.onTools();
    return true;
  }
  syncFollowUI() {
    const group = this.elements.followGroup, select = this.elements.follow;
    if (!group || !select) return;
    group.hidden = this.mode !== 'model3d';
    const options = this.followOptions(), selected = options.find(option => option.id === this.selectedAllyId);
    const signature = JSON.stringify([this.selectedAllyId, options]);
    if (signature !== this.followSignature) {
      this.followSignature = signature;
      const option = (value, label, disabled = false) => {
        const node = document.createElement('option'); node.value = value; node.textContent = label; node.disabled = disabled; return node;
      };
      select.replaceChildren(option('', '自由观察'), ...options.map(entry => option(entry.id, entry.label, !entry.available)));
      select.value = this.selectedAllyId;
    }
    this.elements.followStatus.textContent = !this.selectedAllyId ? '选择友方，切换跟随视角' :
      selected?.available ? '正在跟随 · 可旋转与缩放' : '队友位置暂不可用，跟随已暂停';
    if (this.mode === 'model3d') this.elements.gesture.textContent = this.selectedAllyId
      ? '拖动旋转 · 滚轮 / 双指缩放 · 自由观察可退出跟随'
      : '拖动旋转 · 右键 / 双指平移 · 双击表面定位';
  }
  async setMode(mode) {
    if (!['flat', 'model3d'].includes(mode)) return;
    this.mode = mode; this.notice('');
    this.elements.flat.hidden = mode !== 'flat'; this.elements.model.hidden = mode === 'flat';
    this.elements.options.hidden = mode === 'flat';
    for (const button of this.elements.buttons) button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
    this.elements.gesture.textContent = '拖动旋转 · 右键 / 双指平移 · 双击表面定位';
    this.modelView?.setActive(mode !== 'flat');
    if (mode === 'flat') { this.cancel(); this.flat?.resize(); }
    else { this.failed = false; await this.ensureModel(); }
    this.render();
  }
  cancel() {
    this.sequence++; this.pending?.abort(); this.pending = null;
    this.elements.loading.hidden = true;
  }
  async ensureModel() {
    if (!this.config || this.mode === 'flat' || this.pending || this.failed) return;
    if (this.modelView?.model?.name === this.config.model && !this.modelView.lost) return;
    const sequence = ++this.sequence, config = this.config;
    const abort = this.pending = new AbortController();
    const active = () => sequence === this.sequence && this.mode !== 'flat' && this.config === config;
    this.elements.loading.hidden = false; this.elements.retry.hidden = true;
    this.elements.progress.value = 0; this.elements.loadingText.textContent = '准备当前地图模型…';
    try {
      const [{ ModelView }, { loadModel }] = await this.loadRuntime();
      if (!active()) return;
      if (this.modelView?.lost) { this.modelView.dispose(); this.modelView = null; }
      this.modelView ||= new ModelView(this.elements.model, (text, error) => {
        this.elements.stats.textContent = text;
        if (error) { this.cancel(); this.failed = true; this.elements.loading.hidden = false; this.elements.loadingText.textContent = text; this.elements.retry.hidden = false; this.onTools(); }
      }, this.onTools);
      this.modelView.setActive(true);
      this.modelView.setFollowTarget?.(this.selectedAllyId);
      this.modelView.radius = this.elements.radius.value === 'all' ? Infinity : Number(this.elements.radius.value);
      this.modelView.xray = this.elements.xray.checked;
      const model = await loadModel(config.model, { signal: abort.signal, onProgress: (text, value) => {
        if (active()) { this.elements.loadingText.textContent = text; this.elements.progress.value = value; }
      } });
      if (!active()) return;
      this.modelView.setModel(model, { ...this.frame, markers: this.visibleMarkers });
      this.modelView.frame = this.frame;
      this.elements.loading.hidden = true; this.render();
    } catch (error) {
      if (active() && !abort.signal.aborted) {
        this.failed = true;
        this.elements.loadingText.textContent = error.name === 'AbortError' ? '模型请求超时，请重试' : error.message;
        this.elements.retry.hidden = false;
      }
    } finally { if (active()) { this.pending = null; this.onTools(); } }
  }
  retry() { this.failed = false; this.cancel(); this.modelView?.clearModel(); void this.ensureModel(); }
  reset() { this.cancel(); this.failed = false; this.selectedAllyId = ''; this.config = null; this.markers = []; this.frame = null; this.stale = false; this.flat?.setMap(null); this.modelView?.dispose(); this.modelView = null; this.syncFollowUI(); }
  resize() { this.currentView?.resize(); }
  fit() { this.selectAlly(''); if (this.mode !== 'flat') { this.elements.radius.value = 'all'; this.modelView?.setRadius(Infinity); } this.currentView?.fit(); }
  locate() { this.currentView?.locate(this.selectedAllyId); }
  zoom(delta) { this.currentView?.zoom(delta); }
}
