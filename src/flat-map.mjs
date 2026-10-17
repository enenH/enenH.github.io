import { TILE_ROOT, KINDS, projectPoint, markerLabel } from './core.mjs';

class RadarView {
  constructor(leaflet, container, onNotice, onZoom) {
    this.L = leaflet;
    this.notice = onNotice;
    this.map = leaflet.map(container, {
      crs: leaflet.CRS.Simple, attributionControl: false, zoomControl: false,
      preferCanvas: true, minZoom: -2, maxZoom: 8, zoomSnap: .25, zoomDelta: .5,
      maxBoundsViscosity: .8, zoomAnimation: !window.matchMedia("(prefers-reduced-motion: reduce)").matches
    }).setView([-128, 128], 1);
    this.layer = leaflet.layerGroup().addTo(this.map);
    this.points = [];
    this.config = null;
    this.tiles = null;
    this.allies = new Map();
    this.map.on("zoomend", onZoom);
    this.map.on("resize", () => {
      if (!this.config) return;
      const size = this.map.getSize();
      const verticalPadding = (size.y < 400 ? 64 : 52) + (size.x <= 600 ? 110 : 78);
      this.map.setMinZoom(Math.max(0, this.map.getBoundsZoom(this.bounds, false, this.L.point(32, verticalPadding))));
      onZoom();
    });
    this.map.on("click", () => {
      for (const point of this.points) if (point.kind === "item") point.layer.closeTooltip();
    });
    if (typeof ResizeObserver !== "undefined") {
      this.observer = new ResizeObserver(() => this.map.invalidateSize({ pan: false }));
      this.observer.observe(container);
    }
  }

  setMap(config) {
    if (this.config?.id === config?.id) return;
    this.clearMarkers();
    if (this.tiles) this.map.removeLayer(this.tiles);
    this.tiles = null;
    this.config = config;
    this.notice("");
    if (!config) return;
    // The CDN pyramid is a 256x256 CRS.Simple square, not the former panning limits.
    this.bounds = this.L.latLngBounds([[-256, 0], [0, 256]]);
    this.map.setMaxBounds(this.bounds.pad(.3));
    this.map.setMinZoom(-2);
    const tiles = this.L.tileLayer(TILE_ROOT + config.layer + "/{z}_{x}_{y}.jpg", {
      bounds: this.bounds, minZoom: 0, maxZoom: 8,
      minNativeZoom: config.minNativeZoom, maxNativeZoom: 4,
      noWrap: true, tileSize: 256
    });
    let failures = 0;
    tiles.on("loading", () => { failures = 0; });
    tiles.on("tileerror", () => {
      if (this.tiles === tiles) {
        failures += 1;
        this.notice("部分底图加载失败，请检查网络；位置数据仍在同步。");
      }
    });
    tiles.on("load", () => {
      if (this.tiles === tiles && failures === 0) this.notice("");
    });
    this.tiles = tiles;
    this.fit();
    // Fit first, then fetch once at the real initial view; Leaflet downscales native tiles for overview zooms.
    tiles.addTo(this.map);
  }

  fit() {
    if (!this.config) return;
    this.map.invalidateSize({ pan: false });
    this.map.setMinZoom(-2);
    const size = this.map.getSize();
    const top = size.y < 400 ? 64 : 52;
    const bottom = size.x <= 600 ? 110 : 78;
    const fitZoom = Math.max(0, this.map.getBoundsZoom(this.bounds, false, this.L.point(32, top + bottom)));
    this.map.setMinZoom(fitZoom);
    this.map.fitBounds(this.bounds, {
      paddingTopLeft: [16, top],
      paddingBottomRight: [16, bottom],
      animate: false
    });
  }

  clearMarkers() {
    this.layer.clearLayers();
    this.points = [];
    this.allies = new Map();
  }

  render(markers) {
    if (!this.config) { this.clearMarkers(); return; }
    this.allies = new Map();
    markers.forEach((marker, index) => {
      const position = projectPoint(this.config, marker.x, marker.y, this.frame);
      const definition = KINDS[marker.kind];
      const style = { ...definition, fillColor: marker.color, fillOpacity: .96 };
      const labelText = markerLabel(marker);
      let point = this.points[index];
      if (!point || point.kind !== marker.kind) {
        if (point) this.layer.removeLayer(point.layer);
        const label = document.createElement("span");
        // Permanent tooltips measure themselves while binding; populate before that first measurement.
        label.textContent = labelText;
        const layer = this.L.circleMarker(position, style).addTo(this.layer);
        layer.bindTooltip(label, {
          permanent: marker.kind !== "item", direction: "top", offset: [0, -9],
          className: "radar-label" + (marker.kind === "item" ? " item-label" : ""), opacity: 1
        });
        if (marker.kind === "item") {
          layer.on("click", event => {
            this.L.DomEvent.stopPropagation(event);
            layer.openTooltip();
          });
        }
        point = { layer, label, kind: marker.kind };
        this.points[index] = point;
      } else {
        point.layer.setLatLng(position).setStyle(style);
      }
      if (point.label.textContent !== labelText) {
        point.label.textContent = labelText;
        // Remeasure/recenter the tooltip when a reused marker gets a different name or price.
        point.layer.setTooltipContent(point.label);
      }
      if (marker.kind === "ally") {
        if (marker.id) this.allies.set(marker.id, position);
        point.layer.bringToFront();
      }
    });
    for (const point of this.points.splice(markers.length)) this.layer.removeLayer(point.layer);
  }

  getAllyPosition(id = '') { return this.allies.get(id || [...this.allies.keys()].sort()[0]) || null; }
  locate(id) { const position = this.getAllyPosition(id); if (position) this.map.panTo(position, { animate: false }); }
  zoom(delta) { if (delta > 0) this.map.zoomIn(); else this.map.zoomOut(); }
  resize() { this.map.invalidateSize({ pan: false }); }
}

export { RadarView };
