// =============================================================================
// registry.js — which Trax machine is on the other end, and which protocol and
// dashboard modules serve it (REQ-TLM-5). Product ids are APPEND-ONLY and
// shared with every firmware's config.h.
//
// Identification, most to least authoritative:
//   1. the `ID` line the board sends on connect / on request (parseId)
//   2. the BLE advertisement (manufacturer data, name) — native app, pre-pairing
//   3. the device name / the TLM version alone (boards flashed before `ID`)
// Nothing here parses telemetry: that is the product's protocol module.
// =============================================================================

export const PRODUCTS = {
  1: { code: "GSE-TH", name: "GSE tiller handle", short: "Trax GSE",
       protocol: () => import("./protocol/gse-v1.js"), dashboard: () => import("./dashboards/gse.js"),
       nameMatch: /^(TraxGSE|Trax GSE)\b/i },
  // 2: X2, 3: Rhino, ... — add a protocol/<code>-v<n>.js and dashboards/<code>.js and list them here.
};
export const UNKNOWN = { code: "?", name: "Unknown Trax machine", short: "Trax",
                         protocol: null, dashboard: () => import("./dashboards/generic.js") };

export const ID_VERSION = 1;
export const CAPS = { remote: 0x01, bench: 0x02, faultLog: 0x04, settings: 0x08, ota: 0x10 };
export const NICK_MAX = 18;   // mirrors core::NICK_MAX

// `ID,1,<product_id>,<product_code>,<hw_rev>,<fw_ver>,<serial>,<short_id>,<tlm_ver>,<caps>,<nick>`
// -> identity object, or null when the line is not an ID line.
export function parseId(line) {
  if (!line.startsWith("ID,")) return null;
  const p = line.trim().split(",");
  if (Number(p[1]) !== ID_VERSION || p.length < 10) return { unknownVersion: Number(p[1]) };
  const product = Number(p[2]);
  return {
    product, code: p[3], hwRev: p[4], fw: p[5], serial: p[6], shortId: p[7],
    tlmVersion: Number(p[8]), caps: parseInt(p[9] || "0", 16), nick: p.slice(10).join(",") || "",
    info: PRODUCTS[product] || UNKNOWN,
  };
}

// Boards without the ID line: guess from the advertised/bridge name.
export function identifyByName(name) {
  for (const [id, info] of Object.entries(PRODUCTS)) if (info.nameMatch && info.nameMatch.test(name || "")) return { product: Number(id), info, guessed: true };
  return null;
}

// Manufacturer data from a BLE advertisement (native app / bleak):
// company id LE | format | product id | short id BE | tlm version | caps
export function parseManufacturerData(bytes) {
  if (!bytes || bytes.length < 8 || bytes[2] !== 1) return null;
  return { product: bytes[3], shortId: ((bytes[4] << 8) | bytes[5]).toString(16).toUpperCase().padStart(4, "0"),
           tlmVersion: bytes[6], caps: bytes[7], info: PRODUCTS[bytes[3]] || UNKNOWN };
}

// Customer-facing name: nickname, or "<product> <shortId>". The short id is
// always shown next to it so two units with the same nickname stay distinct.
export function displayName(id) {
  if (!id) return "";
  return id.nick || `${id.info.short} ${id.shortId}`;
}

// Same rules as core::sanitizeNick (firmware applies them again).
export function sanitizeNick(s) {
  return (s || "").replace(/[^\x20-\x7E]/g, "").replace(/,/g, "").replace(/\s+/g, " ").trim().slice(0, NICK_MAX);
}

// Units this phone has talked to, keyed by serial: nickname and product, so the
// scan list can show "Yard cart (#7F3A)" before connecting. Per-device memory
// only; the nickname itself lives on the machine.
const STORE = "trax.units";
export const units = {
  all() { try { return JSON.parse(localStorage.getItem(STORE) || "{}"); } catch (e) { return {}; } },
  remember(id) {
    if (!id || !id.serial) return;
    const all = this.all();
    all[id.serial] = { nick: id.nick || "", product: id.product, code: id.code, shortId: id.shortId, fw: id.fw, lastSeen: Date.now() };
    try { localStorage.setItem(STORE, JSON.stringify(all)); } catch (e) {}
  },
  forget(serial) { const all = this.all(); delete all[serial]; try { localStorage.setItem(STORE, JSON.stringify(all)); } catch (e) {} },
  // Other remembered units carrying the same nickname as `id` (case-insensitive).
  sameNick(id) {
    if (!id || !id.nick) return [];
    return Object.entries(this.all()).filter(([s, u]) => s !== id.serial && u.nick && u.nick.toLowerCase() === id.nick.toLowerCase())
      .map(([serial, u]) => ({ serial, ...u }));
  },
};
