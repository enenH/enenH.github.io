import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { markerLabel, markerScenePosition, allies } from '../core.mjs';
import { selectInstances } from './scene.mjs';

const MAX_TRIANGLES = 3_000_000, GPU_BUDGET = 96 * 1024 ** 2;
export class ModelView {
  constructor(container, onStatus, onTools) {
    this.container = container; this.onStatus = onStatus; this.onTools = onTools;
    this.radius = 150; this.xray = true;
    this.meshes = new Map(); this.entities = []; this.allies = new Map(); this.followId = '';
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.tabIndex = 0;
    this.renderer.domElement.setAttribute('aria-label', '地图模型：方向键平移，鼠标或触屏操作视角');
    container.append(this.renderer.domElement);
    this.labels = document.createElement('div'); this.labels.className = 'model-labels'; container.append(this.labels);
    this.scene = new THREE.Scene(); this.scene.background = new THREE.Color('#101a23');
    this.world = new THREE.Group(); this.scene.add(this.world);
    this.camera = new THREE.PerspectiveCamera(50, 1, .2, 20000);
    this.camera.position.set(100, 100, 100);
    this.materials = ['#708d99', '#415c5c', '#8a9aa2', '#698991'].map(color => new THREE.ShaderMaterial({
      side: THREE.DoubleSide, uniforms: { baseColor: { value: new THREE.Color(color) } },
      vertexShader: `varying vec3 worldPoint;
        void main() { vec4 p = vec4(position, 1.0);
          #ifdef USE_INSTANCING
            p = instanceMatrix * p;
          #endif
          vec4 w = modelMatrix * p; worldPoint = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `uniform vec3 baseColor; varying vec3 worldPoint;
        void main() { vec3 n = normalize(cross(dFdx(worldPoint), dFdy(worldPoint)));
          float key = abs(dot(n, normalize(vec3(.45,.82,.32))));
          gl_FragColor = vec4(baseColor * (.34 + .66 * key), 1.0);
          #include <colorspace_fragment>
        }`
    }));
    this.capsule = new THREE.CapsuleGeometry(.4, 1.2, 3, 8);
    this.itemGeometry = new THREE.OctahedronGeometry(.5);
    this.bindControls(new THREE.Vector3());
    this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(container);
    this.onContextLost = event => { event.preventDefault(); this.lost = true; this.setActive(false); onStatus('图形上下文丢失，请切回平面地图或重试模型', true); };
    this.renderer.domElement.addEventListener('webglcontextlost', this.onContextLost);
    this.onDoubleClick = event => {
      if (!this.model || this.followId) return;
      const rect = this.renderer.domElement.getBoundingClientRect();
      const ray = new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), this.camera);
      const hit = ray.intersectObjects(this.world.children, false)[0];
      if (hit) this.moveTarget(hit.point);
    };
    this.renderer.domElement.addEventListener('dblclick', this.onDoubleClick);
  }
  bindControls(target) {
    this.controls?.dispose();
    const controls = this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    controls.target.copy(target); controls.enableDamping = true; controls.dampingFactor = .15;
    controls.minDistance = 2; controls.maxDistance = 12000;
    controls.enableRotate = true; controls.screenSpacePanning = false;
    controls.enablePan = !this.followId;
    controls.maxPolarAngle = Math.PI * .495;
    controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
    controls.touches.ONE = THREE.TOUCH.ROTATE;
    controls.listenToKeyEvents(this.renderer.domElement);
    controls.addEventListener('end', () => this.scheduleRegion());
    controls.update();
  }
  setModel(model, state) {
    this.clearModel(); this.model = model; this.frame = state;
    const friendly = allies(state.markers);
    const anchor = friendly.find(marker => marker.id === this.followId) || friendly[0];
    const position = anchor && markerScenePosition(state, anchor, model.origin);
    const target = new THREE.Vector3(...(position || model.focus));
    this.camera.position.copy(target).add(new THREE.Vector3(100, 100, 100));
    this.bindControls(target); this.resize(); this.refreshRegion(); this.render(state.markers);
  }
  setActive(active) {
    this.active = active && !this.lost;
    this.controls.enabled = this.active;
    cancelAnimationFrame(this.animation);
    if (!this.active) return;
    this.resize();
    const frame = time => {
      if (!this.active) return;
      this.animation = requestAnimationFrame(frame);
      if (document.hidden || time - (this.lastDraw || 0) < 1000 / 30) return;
      this.lastDraw = time; this.controls.update(); this.renderer.render(this.scene, this.camera); this.updateLabels();
    };
    this.animation = requestAnimationFrame(frame);
  }
  resize() {
    const width = this.container.clientWidth, height = this.container.clientHeight;
    if (!width || !height) return;
    this.renderer.setSize(width, height);
    this.camera.aspect = width / height; this.camera.updateProjectionMatrix();
  }
  scheduleRegion() {
    clearTimeout(this.regionTimer);
    this.regionTimer = setTimeout(() => this.refreshRegion(), 150);
  }
  setRadius(radius) { this.radius = radius; this.refreshRegion(); }
  refreshRegion() {
    if (!this.model) return;
    const center = this.controls.target.toArray();
    const wanted = this.model.geometries.map(record => {
      const selected = selectInstances(record, center, this.radius);
      let distance = Infinity;
      for (const index of selected) {
        const b = record.boxes, i = index * 6;
        distance = Math.min(distance, ((b[i] + b[i + 3]) / 2 - center[0]) ** 2 + ((b[i + 2] + b[i + 5]) / 2 - center[2]) ** 2);
      }
      return { record, selected, distance };
    }).filter(x => x.selected.length).sort((a, b) => a.distance - b.distance);
    let triangles = 0, bytes = 0, actors = 0, limited = false;
    const retained = new Set();
    for (const { record, selected } of wanted) {
      const size = record.positions.byteLength + record.indices.byteLength + selected.length * 64;
      const faces = record.indices.length / 3 * selected.length;
      if (bytes + size > GPU_BUDGET || triangles + faces > MAX_TRIANGLES) { limited = true; continue; }
      bytes += size; triangles += faces; actors += selected.length; retained.add(record.id);
      let mesh = this.meshes.get(record.id);
      if (mesh && mesh.instanceMatrix.count < selected.length) { this.disposeMesh(mesh); this.meshes.delete(record.id); mesh = null; }
      if (!mesh) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(record.positions, 3));
        geometry.setIndex(new THREE.BufferAttribute(record.indices, 1));
        mesh = new THREE.InstancedMesh(geometry, this.materials[record.kind], selected.length);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.meshes.set(record.id, mesh); this.world.add(mesh);
      }
      const bounds = new THREE.Box3(), point = new THREE.Vector3();
      selected.forEach((index, packed) => {
        mesh.instanceMatrix.array.set(record.matrices.subarray(index * 16, index * 16 + 16), packed * 16);
        bounds.expandByPoint(point.fromArray(record.boxes, index * 6));
        bounds.expandByPoint(point.fromArray(record.boxes, index * 6 + 3));
      });
      mesh.count = selected.length; mesh.instanceMatrix.needsUpdate = true;
      mesh.boundingBox = bounds; mesh.boundingSphere = bounds.getBoundingSphere(new THREE.Sphere());
    }
    for (const [id, mesh] of this.meshes) if (!retained.has(id)) { this.disposeMesh(mesh); this.meshes.delete(id); }
    this.scene.updateMatrixWorld(true);
    this.regionCenter = this.controls.target.clone();
    const area = this.radius === Infinity ? '全图范围' : `观察点周围 ${this.radius} 米`;
    this.regionStatus = `${area} · ${actors.toLocaleString()} 实例 · ${(triangles / 10000).toFixed(1)} 万面${limited ? ' · 已达绘制预算，部分几何省略，请缩小范围' : ''}`;
    this.onStatus(this.regionStatus, false); this.onTools();
  }
  disposeMesh(mesh) { this.world.remove(mesh); mesh.dispose(); mesh.geometry.dispose(); }
  clearMarkers() {
    for (const entity of this.entities) { this.scene.remove(entity.mesh); entity.mesh.material.dispose(); entity.label.remove(); }
    this.entities = []; this.allies = new Map(); this.onTools();
  }
  render(markers) {
    if (!this.model) return;
    this.allies = new Map();
    let count = 0, missing = 0;
    for (const marker of markers) {
      const position = markerScenePosition(this.frame, marker, this.model.origin);
      if (!position) { missing++; continue; }
      let entity = this.entities[count];
      if (!entity) {
        const mesh = new THREE.Mesh(this.capsule, new THREE.MeshBasicMaterial({ depthWrite: false }));
        mesh.renderOrder = 10; this.scene.add(mesh);
        const label = document.createElement('span'); label.className = 'model-entity-label'; this.labels.append(label);
        entity = { mesh, label }; this.entities.push(entity);
      }
      entity.mesh.geometry = marker.kind === 'item' ? this.itemGeometry : this.capsule;
      entity.mesh.position.fromArray(position);
      entity.mesh.material.color.set(marker.color); entity.mesh.material.depthTest = !this.xray;
      entity.label.textContent = markerLabel(marker); entity.label.style.borderColor = marker.color;
      entity.marker = marker;
      if (marker.kind === 'ally' && marker.id) this.allies.set(marker.id, position);
      count++;
    }
    for (const entity of this.entities.splice(count)) { this.scene.remove(entity.mesh); entity.mesh.material.dispose(); entity.label.remove(); }
    this.missingCoordinates = missing > 0;
    this.syncFollow();
    this.onTools();
  }
  updateLabels() {
    const { clientWidth: width, clientHeight: height } = this.container;
    const point = new THREE.Vector3();
    for (const entity of this.entities) {
      point.copy(entity.mesh.position); point.y += 1.5; point.project(this.camera);
      // With depth-aware markers, do not reveal occluded positions through labels.
      const visible = this.xray && point.z >= -1 && point.z <= 1 && Math.abs(point.x) <= 1 && Math.abs(point.y) <= 1;
      entity.label.hidden = !visible;
      if (visible) entity.label.style.transform = `translate(${(point.x + 1) * width / 2}px,${(1 - point.y) * height / 2}px) translate(-50%,-100%)`;
    }
  }
  setXray(value) { this.xray = value; if (this.frame) this.render(this.frame.markers); }
  moveTarget(target) {
    const delta = target.clone().sub(this.controls.target); this.camera.position.add(delta);
    this.controls.target.copy(target); this.controls.update(); this.refreshRegion();
  }
  getAllyPosition(id = '') { return this.allies.get(id || [...this.allies.keys()].sort()[0]) || null; }
  locate(id) { const position = this.getAllyPosition(id); if (position) this.moveTarget(new THREE.Vector3(...position)); }
  setFollowTarget(id) {
    if (this.followId !== id) {
      // Keep the user's orbit when switching between teammates. First entering
      // follow starts close enough to inspect that teammate's surroundings.
      this.followPlacement = id ? (this.followId
        ? this.camera.position.clone().sub(this.controls.target) : new THREE.Vector3(12, 10, 12)) : null;
      this.followId = id;
    }
    this.controls.enablePan = !id;
    this.syncFollow();
  }
  syncFollow() {
    if (!this.followId || !this.model) return;
    const position = this.getAllyPosition(this.followId);
    if (!position) return; // Missing/stale/enemy targets never select another ally.
    const target = new THREE.Vector3(...position), delta = target.clone().sub(this.controls.target);
    if (this.followPlacement) { this.camera.position.copy(target).add(this.followPlacement); this.followPlacement = null; }
    else this.camera.position.add(delta);
    this.controls.target.copy(target); this.controls.update();
    // Moving teammates must load the geometry around their new location too.
    if (!this.regionCenter || this.regionCenter.distanceTo(target) > 15) this.refreshRegion();
  }
  zoom(delta) { if (delta > 0) this.controls.dollyIn(1.3); else this.controls.dollyOut(1.3); this.controls.update(); }
  fit() {
    if (!this.model) return;
    const [a,b,c,d,e,f] = this.model.bounds, target = new THREE.Vector3((a+d)/2,(b+e)/2,(c+f)/2);
    const span = Math.max(d-a, f-c, 100);
    this.camera.position.copy(target).add(new THREE.Vector3(span,span,span));
    this.controls.target.copy(target); this.controls.update(); this.resize(); this.refreshRegion();
  }
  clearModel() {
    clearTimeout(this.regionTimer); this.clearMarkers();
    for (const mesh of this.meshes.values()) this.disposeMesh(mesh);
    this.meshes.clear(); this.model = null; this.frame = null;
    this.regionCenter = null;
    this.renderer.renderLists.dispose();
  }
  dispose() {
    this.setActive(false); this.clearModel(); this.controls.dispose(); this.observer.disconnect();
    this.renderer.domElement.removeEventListener('webglcontextlost', this.onContextLost);
    this.renderer.domElement.removeEventListener('dblclick', this.onDoubleClick);
    this.materials.forEach(material => material.dispose()); this.capsule.dispose(); this.itemGeometry.dispose();
    this.renderer.dispose(); this.renderer.domElement.remove(); this.labels.remove();
  }
}
