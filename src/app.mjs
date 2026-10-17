import { normalizeRoom, normalizeState, resolveMap, roomSocketUrl } from './core.mjs';
import { RoomConnection } from './room-connection.mjs';
import { RadarView } from './flat-map.mjs';
import { ViewController } from './view-controller.mjs';

function boot() {
  const $ = id => document.getElementById(id);
  const ui = {
    entry: $("entry-screen"), radar: $("radar-screen"), form: $("room-form"), code: $("room-code"),
    codeField: $("code-field"), slots: [...document.querySelectorAll(".code-slot")],
    message: $("form-message"), join: $("join-button"), joinLabel: $("join-label"),
    room: $("active-room"), mapName: $("map-name"), peers: $("peer-count"),
    status: $("connection-label"), dot: $("connection-dot"), age: $("data-age"),
    empty: $("map-empty"), emptyTitle: $("empty-title"), emptyDescription: $("empty-description"),
    notice: $("map-notice"), reload: $("reload-button"), locate: $("locate-button"),
    zoomIn: $("zoom-in-button"), zoomOut: $("zoom-out-button"), fit: $("fit-button")
  };
  let view = null;
  let current = normalizeState(null);
  let dataReceivedAt = null;
  let connectionState = "idle";
  let displayClock = null;
  let nodes = null;
  let entryAttempt = 0;
  const modelElements = {
    flat: $('radar-map'), model: $('model-map'), options: $('model-options'),
    buttons: [...document.querySelectorAll('[data-mode]')], gesture: $('model-gesture'),
    loading: $('model-loading'), loadingText: $('model-loading-text'), progress: $('model-progress'),
    retry: $('model-retry'), stats: $('model-stats'), radius: $('model-radius'),
    xray: $('model-xray'), coordinates: $('coordinate-notice'),
    followGroup: $('ally-view-control'), follow: $('ally-view'), followStatus: $('ally-view-status')
  };
  const markerVisibility = { bot: true, item: true };
  const markerToggles = { bot: $('show-bots'), item: $('show-items') };
  for (const [kind, input] of Object.entries(markerToggles)) input.checked = markerVisibility[kind];

  function updateCode() {
    const value = normalizeRoom(ui.code.value);
    if (ui.code.value !== value) ui.code.value = value;
    const active = Math.min(ui.code.selectionStart ?? value.length, 3);
    ui.slots.forEach((slot, index) => {
      slot.textContent = value[index] || "";
      slot.classList.toggle("is-active", index === active);
    });
  }
  function formMessage(text) {
    ui.message.textContent = text;
    ui.codeField.classList.toggle("is-invalid", Boolean(text));
    ui.code.setAttribute("aria-invalid", String(Boolean(text)));
  }
  function busy(value) {
    ui.join.disabled = value;
    ui.code.readOnly = value;
    ui.join.setAttribute("aria-busy", String(value));
    ui.joinLabel.textContent = value ? "正在连接…" : "进入雷达";
  }
  function notice(text) {
    ui.notice.textContent = text;
    ui.notice.hidden = !text;
  }
  function empty(title, description, retry = false) {
    ui.empty.hidden = false;
    ui.emptyTitle.textContent = title;
    ui.emptyDescription.textContent = description;
    ui.reload.hidden = !retry;
  }
  function updateTools() {
    const ready = Boolean(view?.ready);
    ui.locate.disabled = !ready || !view.anchor;
    ui.fit.disabled = !ready;
    const map = view?.mode === 'flat' ? view.flat?.map : null;
    ui.zoomIn.disabled = !ready || Boolean(map && map.getZoom() >= map.getMaxZoom());
    ui.zoomOut.disabled = !ready || Boolean(map && map.getZoom() <= map.getMinZoom());
  }
  function counts(markers = null) {
    for (const kind of ["ally", "player", "bot", "item"]) {
      $(kind + "-count").textContent = markers ? String(markers.filter(marker => marker.kind === kind).length) : "—";
    }
  }
  function refreshStatus() {
    let label = "等待客户端数据";
    let tone = "waiting";
    const elapsed = dataReceivedAt === null ? null : Math.max(0, Math.floor((performance.now() - dataReceivedAt) / 1000));
    ui.age.textContent = elapsed === null ? "尚无数据" : elapsed < 2 ? "刚刚更新" : elapsed + " 秒前更新";
    if (connectionState === "reconnecting") label = "连接中断，正在重连";
    else if (connectionState === "connecting") label = "正在连接";
    else if (current.available && elapsed !== null && elapsed >= 10) {
      label = "数据已暂停，等待客户端";
      tone = "error";
      view?.clearMarkers();
      counts();
      updateTools();
    } else if (current.available && !current.coordinatesValid) {
      label = '世界坐标暂不可用，等待客户端刷新';
      tone = 'waiting';
    } else if (current.available && resolveMap(current.levelName)) {
      label = "实时同步";
      tone = "live";
    } else if (current.available) label = current.levelName ? "地图暂未支持" : "等待识别地图";
    if (ui.status.textContent !== label) ui.status.textContent = label;
    ui.dot.dataset.tone = tone;
  }
  function receive(raw) {
    const next = normalizeState(raw);
    const changed = next.updatedAtMs !== current.updatedAtMs || next.levelName !== current.levelName || next.available !== current.available;
    if (!next.available) dataReceivedAt = null;
    else if (changed || dataReceivedAt === null) dataReceivedAt = performance.now();
    current = next;
    const config = current.available ? resolveMap(current.levelName) : null;
    ui.mapName.textContent = config?.name || (current.levelName || "等待识别地图");
    ui.mapName.title = current.levelName;
    if (view) {
      view.stale = !current.available || connectionState !== 'connected' || (dataReceivedAt !== null && performance.now() - dataReceivedAt >= 10000);
      view.update(config, current);
    }
    presentMap();
    counts(config && view && !view.stale ? view.visibleMarkers : null);
    updateTools();
    refreshStatus();
  }
  function presentMap() {
    const config = view?.config;
    if (!view) {
      empty("地图组件加载失败", "请检查网络后重试。房间连接不受影响。", true);
    } else if (!current.available) {
      view.clearMarkers();
      empty("等待客户端数据", "进入对局后，地图和位置会自动出现在这里。");
    } else if (!current.levelName) {
      empty("等待识别地图", "客户端尚未传来地图名称，请确认客户端与中继已更新。");
    } else if (!config) {
      empty("暂不支持这张地图", "已识别到「" + current.levelName + "」，模型包和底图目录中均无此地图。");
    } else if (view.mode === 'flat' && !config.layer) {
      empty('这张地图没有平面底图', '请切换到 3D 模型查看「' + config.name + '」。');
    } else if (view.mode === 'flat' && !view.flat) {
      empty('平面地图组件加载失败', '可切换到模型视图，或检查网络后重新加载页面。', true);
    } else {
      ui.empty.hidden = true;
    }
  }
  function returnToEntry(message = "") {
    entryAttempt += 1;
    clearInterval(displayClock);
    displayClock = null;
    current = normalizeState(null);
    dataReceivedAt = null;
    connectionState = "idle";
    view?.reset();
    void view?.setMode('flat');
    notice("");
    counts();
    ui.peers.textContent = "0";
    ui.room.textContent = "----";
    ui.radar.hidden = true;
    ui.entry.hidden = false;
    busy(false);
    formMessage(message);
    document.title = "DFM · 实时雷达";
    ui.code.focus({ preventScroll: true });
    ui.code.select();
    updateCode();
  }
  const socketUrlForRoom = room => ['127.0.0.1', 'localhost'].includes(location.hostname)
    ? `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws?room=${room}`
    : roomSocketUrl(nodes, room, window.location);
  const channel = new RoomConnection({
    join(room) {
      const firstEntry = ui.radar.hidden;
      ui.code.blur(); // Dismiss the Android keyboard before sizing the map.
      ui.entry.hidden = true;
      ui.radar.hidden = false;
      ui.room.textContent = room;
      busy(false);
      formMessage("");
      document.title = room + " · DFM 雷达";
      if (!view) {
        const flat = window.L?.map ? new RadarView(window.L, $('radar-map'), text => { if (view?.mode === 'flat') notice(text); }, updateTools) : null;
        view = new ViewController({ flat, elements: modelElements, notice, onTools: updateTools, markerVisibility });
      }
      if (firstEntry) {
        displayClock = setInterval(refreshStatus, 1000);
        ui.mapName.focus({ preventScroll: true });
        requestAnimationFrame(() => view?.resize());
      }
    },
    status(status) {
      connectionState = status;
      if (status === "reconnecting") {
        view?.clearMarkers();
        counts();
        updateTools();
        ui.peers.textContent = "—";
      }
      refreshStatus();
    },
    state: receive,
    peers(count) { ui.peers.textContent = String(count); },
    failure: returnToEntry
  }, {
    location: window.location, createSocket: url => new WebSocket(url), now: () => performance.now(),
    socketUrl: socketUrlForRoom,
    setTimeout: window.setTimeout.bind(window), clearTimeout: window.clearTimeout.bind(window),
    setInterval: window.setInterval.bind(window), clearInterval: window.clearInterval.bind(window)
  });

  ui.form.addEventListener("submit", async event => {
    event.preventDefault();
    if (ui.join.disabled) return;
    updateCode();
    if (!/^[0-9]{4}$/.test(ui.code.value)) {
      formMessage("请输入完整的 4 位数字房间号。");
      ui.code.focus();
      return;
    }
    formMessage("");
    busy(true);
    const attempt = ++entryAttempt;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      if (!nodes) {
        const response = await fetch("./nodes.json", { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("节点列表加载失败，请刷新页面重试。");
        nodes = await response.json();
      }
      if (attempt !== entryAttempt) return;
      roomSocketUrl(nodes, ui.code.value, window.location);
      channel.join(ui.code.value);
    } catch (error) {
      if (attempt !== entryAttempt) return;
      busy(false);
      formMessage(error.name === "AbortError" ? "节点列表加载超时，请检查网络后重试。" : error.message);
    } finally {
      clearTimeout(timeout);
    }
  });
  ui.code.addEventListener("input", () => { formMessage(""); updateCode(); });
  for (const event of ["focus", "click", "keyup", "select"]) ui.code.addEventListener(event, updateCode);
  ui.code.addEventListener("paste", event => {
    if (ui.code.readOnly) return;
    const text = event.clipboardData?.getData("text");
    if (text !== undefined) {
      event.preventDefault();
      ui.code.value = normalizeRoom(text);
      ui.code.setSelectionRange(ui.code.value.length, ui.code.value.length);
      formMessage("");
      updateCode();
    }
  });
  $("leave-button").addEventListener("click", () => { channel.stop(); returnToEntry(); });
  ui.zoomIn.addEventListener("click", () => view?.zoom(1));
  ui.zoomOut.addEventListener("click", () => view?.zoom(-1));
  ui.fit.addEventListener("click", () => view?.fit());
  ui.locate.addEventListener("click", () => view?.locate());
  ui.reload.addEventListener("click", () => window.location.reload());
  for (const [kind, input] of Object.entries(markerToggles)) input.addEventListener('change', () => {
    markerVisibility[kind] = input.checked;
    view?.setMarkerVisibility(kind, input.checked);
    counts(view?.config && !view.stale ? view.visibleMarkers : null);
  });
  for (const button of modelElements.buttons) button.addEventListener('click', async () => {
    if (!view) return;
    const change = view.setMode(button.dataset.mode);
    presentMap(); updateTools();
    await change;
    presentMap(); updateTools();
  });
  modelElements.retry.addEventListener('click', () => view?.retry());
  modelElements.follow.addEventListener('change', () => view?.selectAlly(modelElements.follow.value));
  modelElements.radius.addEventListener('change', () => view?.modelView?.setRadius(modelElements.radius.value === 'all' ? Infinity : Number(modelElements.radius.value)));
  modelElements.xray.addEventListener('change', () => {
    if (view?.modelView) { view.modelView.xray = modelElements.xray.checked; view.render(); }
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && !ui.radar.hidden) {
      view?.resize();
      refreshStatus();
    }
  });
  window.addEventListener("pagehide", () => { channel.stop(); returnToEntry(); });
  updateCode();
}

boot();
