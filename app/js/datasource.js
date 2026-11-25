// =============================================================================
// datasource.js — one interface over both transports:
//   { connect(), disconnect(), send(text), onLine(cb), onConn(cb), onMeta(cb) }
// Bridge (WebSocket): the bridge forwards raw protocol lines ({type:"line"}).
// BLE (Web Bluetooth): raw bytes, reassembled on '\n' here.
// The app parses every line with protocol.js regardless of the source.
// =============================================================================
import { WebBleTransport, isWebBluetoothSupported } from "./transport-webble.js";

export { isWebBluetoothSupported };

class LineReassembler {
  constructor(onLine) { this._buf = ""; this._dec = new TextDecoder(); this._onLine = onLine; }
  push(bytes) {
    this._buf += this._dec.decode(bytes, { stream: true });
    let i;
    while ((i = this._buf.indexOf("\n")) >= 0) {
      const ln = this._buf.slice(0, i).replace(/\r$/, "");
      this._buf = this._buf.slice(i + 1);
      if (ln) this._onLine(ln);
    }
  }
}

export class BridgeSource {
  constructor(url) {
    // The bridge serves the app on port N and its WebSocket on N-1 (8766/8765 by default).
    const port = location.port ? Number(location.port) - 1 : 8765;
    this.url = url || `ws://${location.hostname || "localhost"}:${port}/`;
    this.onLine = () => {}; this.onConn = () => {}; this.onMeta = () => {};
    this._ws = null; this._closed = false;
  }
  connect() { this._closed = false; this._open(); }
  _open() {
    this._ws = new WebSocket(this.url);
    this._ws.onopen = () => this.onConn({ link: true, kind: "bridge" });
    this._ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.type === "line") this.onLine(m.text);
      else this.onMeta(m);            // conn, ports, logging, log
    };
    this._ws.onclose = () => {
      this.onConn({ link: false, kind: "bridge" });
      if (!this._closed) setTimeout(() => this._open(), 2000);
    };
  }
  send(text) { this._json({ type: "cmd", text }); }
  _json(o) { if (this._ws && this._ws.readyState === 1) this._ws.send(JSON.stringify(o)); }
  // bridge-only controls
  listPorts() { this._json({ type: "ports" }); }
  connectSerial(port) { this._json({ type: "connect_serial", port }); }
  disconnectSerial() { this._json({ type: "disconnect" }); }
  setLogging(on) { this._json({ type: "log", on }); }
  disconnect() { this._closed = true; if (this._ws) this._ws.close(); }
}

export class BleSource {
  constructor() {
    this.onLine = () => {}; this.onConn = () => {}; this.onMeta = () => {}; this.onError = () => {};
    this._t = new WebBleTransport();
    this._t.onError((m) => this.onError(m));
    this._re = new LineReassembler((l) => this.onLine(l));
    this._t.onData((b) => this._re.push(b));
    this._t.onDisconnect(() => this.onConn({ link: false, kind: "ble" }));
    this._enc = new TextEncoder();
  }
  async connect() {
    await this._t.connect();            // must be inside a user gesture
    this.onConn({ link: true, kind: "ble", name: this._t.deviceName });
  }
  send(text) { return this._t.send(this._enc.encode(text + "\n"), { latest: text.startsWith("RC,") }); }
  disconnect() { return this._t.disconnect(); }
}
