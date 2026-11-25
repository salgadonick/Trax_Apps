// =============================================================================
// transport-webble.js — Web Bluetooth implementation of the byte transport
// interface: { connect, disconnect, onData(cb), onDisconnect(cb), send(bytes) }.
//
// Speaks the Nordic UART Service the firmware exposes (docs/PROTOCOL.md).
// This file is the ONLY place navigator.bluetooth appears; a future native
// (CoreBluetooth) layer re-implements this same interface and nothing else
// changes. GUI and parsing must never import this directly — app.js wires it
// into createLineDataSource().
//
// Browser constraints (by design of Web Bluetooth):
//   - connect() must be called from a user gesture (button click).
//   - No silent auto-reconnect; the chooser appears each session.
//   - Chrome/Edge only (desktop + Android). No Firefox/Safari/iOS.
// =============================================================================

// Web Bluetooth requires lowercase 128-bit UUIDs.
const NUS_SERVICE = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
const NUS_RX      = "6e400002-b5a3-f393-e0a9-e50e24dcca9e"; // write:  client → ESP32
const NUS_TX      = "6e400003-b5a3-f393-e0a9-e50e24dcca9e"; // notify: ESP32 → client

export function isWebBluetoothSupported() {
  return typeof navigator !== "undefined" && !!navigator.bluetooth;
}

export class WebBleTransport {
  constructor() {
    this._device = null;
    this._rxChar = null;
    this._onData = () => {};
    this._onDisconnect = () => {};
    this._onError = () => {};
    this._queue = [];        // ordered commands
    this._latest = null;     // newest RC frame only
    this._draining = false;
  }

  onData(cb)       { this._onData = cb; }
  onDisconnect(cb) { this._onDisconnect = cb; }
  onError(cb)      { this._onError = cb; }

  get deviceName() { return this._device ? this._device.name : null; }

  async connect() {
    if (!isWebBluetoothSupported()) {
      throw new Error("Web Bluetooth is not supported in this browser (use Chrome or Edge)");
    }
    // Filter on the NUS service UUID — it's in the firmware's ADV payload.
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [NUS_SERVICE] }],
    });
    device.addEventListener("gattserverdisconnected", () => {
      this._rxChar = null; this._queue = []; this._latest = null;
      this._onDisconnect();
    });

    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(NUS_SERVICE);
    const txChar = await service.getCharacteristic(NUS_TX);
    this._rxChar = await service.getCharacteristic(NUS_RX);

    txChar.addEventListener("characteristicvaluechanged", (e) => {
      const v = e.target.value; // DataView
      this._onData(new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
    });
    await txChar.startNotifications();

    this._device = device;
  }

  async disconnect() {
    if (this._device && this._device.gatt.connected) {
      this._device.gatt.disconnect(); // fires gattserverdisconnected
    }
  }

  // Serialize writes: concurrent GATT operations reject in Web Bluetooth
  // ("GATT operation already in progress"). One drain loop sends queued
  // commands in order; a write flagged `latest` (RC frames) is a single slot
  // that newer frames replace, so a slow link (Windows: one write per
  // connection interval, 15-30 ms, competing with 10 Hz telemetry) never
  // builds a backlog of stale frames and bunches them past the deadman.
  send(bytes, { latest = false } = {}) {
    if (!this._rxChar) return Promise.reject(new Error("not connected"));
    if (latest) this._latest = bytes; else this._queue.push(bytes);
    if (!this._draining) this._drain();
    return Promise.resolve();
  }

  async _drain() {
    this._draining = true;
    try {
      while (this._rxChar && (this._queue.length || this._latest)) {
        const bytes = this._queue.length ? this._queue.shift() : this._latest;
        if (bytes === this._latest) this._latest = null;
        const rx = this._rxChar;
        for (let attempt = 0; ; attempt++) {
          try {
            await (rx.writeValueWithoutResponse ? rx.writeValueWithoutResponse(bytes) : rx.writeValue(bytes));
            break;
          } catch (e) {
            // Chrome rejects while another op (e.g. startNotifications) is still
            // in flight; one short retry covers that, anything else is reported.
            if (attempt === 0 && /in progress/i.test(e.message)) { await new Promise((r) => setTimeout(r, 30)); continue; }
            this._onError(`write failed (${new TextDecoder().decode(bytes).trim().slice(0, 16)}): ${e.message}`);
            break;
          }
        }
      }
    } finally {
      this._draining = false;
    }
  }
}
