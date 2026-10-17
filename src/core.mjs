const TILE_ROOT = "https://game.gtimg.cn/images/dfm/cp/a20240729directory/img/";
// Survey/calibration data is preserved; the interface and application are new.
// Native names are the .dfcol stems in 三角洲地图漏打模型.zip (CN_20260729_MapForrest).
// Aliases are exact, case-insensitive identifiers, never substring guesses.
const MAPS = [
  { id: "daba", name: "零号大坝", layer: "map_db", aliases: ["Dam_Iris", "零号大坝"],
    origin: [357100, -770800], center: [358155.7, 750191.75], size: [81086.3, 80988.5], rotation: 0, minNativeZoom: 0 },
  { id: "cgxg", name: "长弓溪谷", layer: "map_yc", aliases: ["Forrest", "长弓溪谷"],
    origin: [328800, -640600], center: [330551.75, 639913.875], size: [112800, 112800], rotation: 90, minNativeZoom: 2 },
  { id: "htjd", name: "航天基地", layer: "map_htjd", aliases: ["SpaceCenter", "航天基地"],
    origin: [668200, -452923], center: [669337, 446449.75], size: [65442.9, 65442.9], rotation: 0, minNativeZoom: 2 },
  { id: "bks", name: "巴克什", layer: "map_bks2", aliases: ["Brakkesh", "巴克什"],
    origin: [378400, -449400], center: [380000, 456000], size: [60000, 60000], rotation: 0, minNativeZoom: 2 },
  { id: "cxjy", name: "潮汐监狱", layer: "map_cxjy", aliases: ["Tide", "潮汐监狱"],
    origin: [53150, -52650], center: [50383.5, 51155.9], size: [36596.4, 36596.4], rotation: 0, minNativeZoom: 1 },
  // Nuclear calibration remains the existing seed, pending measured landmarks.
  { id: "az3", name: "核电站", layer: "map_az3", aliases: ["AZ-5", "核电站"],
    origin: [197518.9, -204814], center: [197518.90625, 204814.046875], size: [80999.179688, 80831.398438], rotation: -90, minNativeZoom: 1 },
  { id: "training", name: "靶场", layer: null, aliases: ["SecretService", "靶场"] }
];
for (const map of MAPS) map.model = map.aliases[0];
const KINDS = {
  ally: { name: "友方", radius: 7, fillColor: "#7ce4cd", color: "#effff8", weight: 2 },
  player: { name: "敌方", radius: 7, fillColor: "#ff5252", color: "#fff0f1", weight: 2 },
  bot: { name: "人机", radius: 6, fillColor: "#f8fafc", color: "#28373d", weight: 2 },
  item: { name: "物资", radius: 4, fillColor: "#ffd54f", color: "#ffd54f", weight: 1 }
};
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const normalizeRoom = value => String(value ?? "").normalize("NFKC").replace(/[^0-9]/g, "").slice(0, 4);
const mapKey = value => String(value ?? "").trim().replace(/_Level.*$/i, "").toLowerCase();
const resolveMap = name => MAPS.find(map => [map.id, map.layer, ...map.aliases].filter(Boolean).some(alias => mapKey(alias) === mapKey(name))) || null;

function projectPoint(map, x, y, frame) {
  if (!map?.layer || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (frame?.coordinateSpace === 'persistent-cm') {
    x -= map.origin[0]; y -= map.origin[1];
  } else if (frame?.worldOrigin) {
    x += frame.worldOrigin[0] - map.origin[0]; y += frame.worldOrigin[1] - map.origin[1];
  }
  const east = (x + map.origin[0] - map.center[0]) * 128 / map.size[0];
  const north = (y + map.origin[1] + map.center[1]) * 128 / map.size[1];
  if (map.rotation === 90) return [-128 - east, 128 - north];
  if (map.rotation === -90) return [-128 + east, 128 + north];
  return [-128 - north, 128 + east];
}

function normalizeState(raw) {
  const source = object(raw) ? raw : {};
  const markers = [];
  const seen = new Set();
  if (source.available === true && source.coordinatesValid !== false && Array.isArray(source.markers)) {
    for (const value of source.markers.slice(0, 2048)) {
      if (!object(value) || !Number.isFinite(value.x) || !Number.isFinite(value.y)) continue;
      const kind = Object.hasOwn(KINDS, value.kind) ? value.kind : "item";
      const id = typeof value.id === 'string' && /^[a-zA-Z0-9:_-]{1,64}$/.test(value.id) ? value.id : '';
      if (id && seen.has(id)) continue;
      if (id) seen.add(id);
      markers.push({
        id, kind, x: value.x, y: value.y, z: Number.isFinite(value.z) ? value.z : null,
        label: typeof value.label === "string" ? value.label.trim().slice(0, 128) : "",
        color: kind === 'item' && typeof value.color === "string" && /^#[a-f0-9]{6}$/i.test(value.color) ? value.color : KINDS[kind].fillColor,
        price: Number.isFinite(value.price) && value.price > 0 ? Math.floor(value.price) : 0
      });
    }
  }
  return {
    available: source.available === true,
    levelName: typeof source.levelName === "string" ? source.levelName.trim().slice(0, 128) : "",
    updatedAtMs: Number.isFinite(source.updatedAtMs) ? Math.max(0, source.updatedAtMs) : 0,
    coordinateSpace: source.coordinateSpace === 'persistent-cm' ? 'persistent-cm' : 'runtime-cm',
    worldOrigin: Array.isArray(source.worldOrigin) && source.worldOrigin.length === 3 && source.worldOrigin.every(Number.isFinite) ? source.worldOrigin.slice() : null,
    coordinatesValid: source.coordinatesValid !== false,
    markers
  };
}

// Never manufacture heights or substitute a tile calibration for UWorld origin.
// Match sceneBasis in model/dfcol.mjs: UE +Y (right) becomes scene +Z.
function markerScenePosition(state, marker, origin) {
  if (state.coordinatesValid === false || !Number.isFinite(marker.z)) return null;
  const offset = state.coordinateSpace === 'persistent-cm' ? [0, 0, 0] : state.worldOrigin;
  if (!offset) return null;
  return [(marker.x + offset[0] - origin[0]) / 100,
    (marker.z + offset[2] - origin[2]) / 100, (marker.y + offset[1] - origin[1]) / 100];
}

function markerLabel(marker) {
  const label = String(marker.label || "").replace(/\s+/g, " ").trim() || KINDS[marker.kind].name;
  return marker.kind === "item" && marker.price > 0 ? label + "\n价值 " + marker.price.toLocaleString("zh-CN") : label;
}

function roomSocketUrl(nodes, room, location) {
  if (!Array.isArray(nodes) || !/^[1-9][0-9]{3}$/.test(room)) throw new Error("房间号无效，请核对客户端显示的 4 位号码。");
  const node = nodes.find(entry => entry.id === Number(room[0]));
  if (!node || typeof node.host !== "string" || !/^[a-z0-9.-]+$/i.test(node.host) ||
      !Number.isInteger(node.port) || node.port < 1 || node.port > 65535) {
    throw new Error("未找到房间对应的节点，请更新页面后重试。");
  }
  return (location.protocol === "https:" ? "wss:" : "ws:") + "//" + node.host + ":" + node.port + "/ws?room=" + room;
}

function allies(markers) {
  return markers.filter(marker => marker.kind === 'ally' && marker.id)
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export { TILE_ROOT, MAPS, KINDS, object, normalizeRoom, resolveMap, projectPoint, normalizeState, markerLabel, roomSocketUrl, markerScenePosition, allies };
