import { object } from './core.mjs';

class RoomConnection {
  constructor(callbacks, environment) {
    this.events = callbacks;
    this.env = environment;
    this.socket = null;
    this.room = "";
    this.joined = false;
    this.attempt = 0;
    this.timer = null;
    this.heartbeat = null;
  }

  join(room) {
    if (!/^[0-9]{4}$/.test(room)) return;
    this.stop();
    this.room = room;
    this.events.status("connecting");
    this.connect();
  }

  releaseSocket() {
    this.env.clearTimeout(this.timer);
    this.env.clearInterval(this.heartbeat);
    this.timer = this.heartbeat = null;
    const previous = this.socket;
    this.socket = null; // Late events from an old connection cannot mutate this session.
    if (previous) previous.close();
  }

  stop() {
    this.room = "";
    this.joined = false;
    this.attempt = 0;
    this.releaseSocket();
  }

  fail(message) {
    this.stop();
    this.events.failure(message);
  }

  connect() {
    this.releaseSocket();
    let socket;
    try {
      const scheme = this.env.location.protocol === "https:" ? "wss:" : "ws:";
      const url = this.env.socketUrl ? this.env.socketUrl(this.room) : scheme + "//" + this.env.location.host + "/ws?room=" + this.room;
      socket = this.env.createSocket(url);
    } catch {
      this.retry();
      return;
    }
    this.socket = socket;
    let welcomed = false;
    let lastMessage = this.env.now();
    this.timer = this.env.setTimeout(() => {
      if (this.socket === socket) {
        this.releaseSocket();
        this.retry();
      }
    }, 10000);

    socket.addEventListener("open", () => {
      if (this.socket !== socket) return;
      try {
        socket.send(JSON.stringify({ type: "hello", clientType: "web", room: this.room, clientName: "dfm-radar", version: 2 }));
      } catch {
        this.releaseSocket();
        this.retry();
      }
    });
    socket.addEventListener("message", event => {
      if (this.socket !== socket) return;
      let payload;
      try { payload = JSON.parse(event.data); } catch { return; }
      if (!object(payload) || typeof payload.type !== "string") return;
      lastMessage = this.env.now();
      if (payload.type === "error") {
        this.fail(payload.code === "room-not-found"
          ? "房间不存在，请确认客户端已开启共享。"
          : "连接被拒绝，请确认房间号后重试。");
        return;
      }
      if (payload.type === "welcome") {
        if (String(payload.room) !== this.room || welcomed) return;
        welcomed = true;
        this.env.clearTimeout(this.timer);
        this.timer = null;
        this.joined = true;
        this.attempt = 0;
        this.events.join(this.room);
        this.events.status("connected");
        this.events.state(payload.state?.nativeState);
        this.heartbeat = this.env.setInterval(() => {
          if (this.socket !== socket) return;
          if (this.env.now() - lastMessage > 35000) {
            this.releaseSocket();
            this.retry();
            return;
          }
          try { socket.send(JSON.stringify({ type: "heartbeat" })); }
          catch { this.releaseSocket(); this.retry(); }
        }, 12000);
      } else if (welcomed && payload.type === "native-state") {
        this.events.state(payload.state);
      } else if (welcomed && payload.type === "snapshot") {
        this.events.state(payload.state?.nativeState);
      }
      if (welcomed && Number.isInteger(payload.peers) && payload.peers >= 0) this.events.peers(payload.peers);
    });
    socket.addEventListener("close", event => {
      if (this.socket !== socket) return;
      this.releaseSocket();
      if (event.code === 4004) this.fail("房间不存在，请确认客户端已开启共享。");
      else this.retry();
    });
    // Browser error events are followed by close; the handshake timer also bounds failures.
    socket.addEventListener("error", () => {});
  }

  retry() {
    if (!this.room) return;
    if (!this.joined || this.attempt >= 5) {
      this.fail("暂时无法连接，请检查网络后重新进入房间。");
      return;
    }
    this.attempt += 1;
    this.events.status("reconnecting");
    this.timer = this.env.setTimeout(() => this.connect(), Math.min(1000 * 2 ** (this.attempt - 1), 12000));
  }
}

export { RoomConnection };
