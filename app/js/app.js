// =============================================================================
// app.js — the Trax app shell. Owns the transport, the console/events, the
// stored-fault and settings panels, and the machine's identity (REQ-BLE-7).
// It identifies the unit from its `ID` line (registry.js) and hands every
// telemetry line to that product's dashboard module; unknown machines get the
// generic dashboard. The GSE tiller handle is the default when a board is
// too old to send `ID` (backwards compatible).
// =============================================================================
import { PRODUCTS, UNKNOWN, parseId, identifyByName, displayName, sanitizeNick, units } from "./registry.js";
import { BridgeSource, BleSource, isWebBluetoothSupported, canSilentReconnect } from "./datasource.js";

const $ = (id) => document.getElementById(id);
let src = null, srcKind = "";
let lastSeq = -1, lost = 0, tlmCount = 0, rateT0 = performance.now();
let advanced = false;
const cfg = {};                 // key -> value as received (CFG lines)
let proto = null;               // active protocol module (parseLine, SETTINGS, ...)
let dash = null;                // active dashboard module
let identity = null;            // from the ID line (or a name-based guess)
let idRequested = false;
let idPendingUntil = 0;         // telemetry is held back until the ID reply, or this time

// ---------------------------------------------------------------- helpers
function setLink(on, label) {
  $("linkdot").classList.toggle("on", on);
  $("devname").textContent = label ? `· ${label}` : "";
  if (!on) { $("state-text").textContent = "Not connected"; idRequested = false; }
}
function badge(list, text, cls) { const b = document.createElement("span"); b.className = "badge " + (cls || ""); b.textContent = text; list.appendChild(b); }
function addEvent(kind, text) {
  const li = document.createElement("li");
  li.innerHTML = `<span class="t">${new Date().toLocaleTimeString([], { hour12: false })}</span><span class="k ${kind}">${kind}</span><span></span>`;
  li.lastChild.textContent = text;
  const ul = $("events"); ul.prepend(li);
  while (ul.children.length > 80) ul.lastChild.remove();
}
function consoleLine(text, cls) {
  const c = $("console"); const d = document.createElement("div"); d.className = cls || ""; d.textContent = text; c.appendChild(d);
  while (c.children.length > 300) c.firstChild.remove();
  c.scrollTop = c.scrollHeight;
}
const send = (t) => { if (src) { src.send(t); consoleLine("> " + t, "tx"); } };
const sendRaw = (t) => { if (src) src.send(t); };          // high-rate frames: no console echo
const ctx = { $, send, sendRaw, cfg, addEvent, badge, isAdvanced: () => advanced, srcKind: () => srcKind, get identity() { return identity; }, get proto() { return proto; } };

// ---------------------------------------------------------------- BLE auto-link
// Remember the last unit connected over Web Bluetooth and re-link silently:
// on app open, and whenever the link drops (unit rebooting, out of range, or
// dropping this client for a re-pair search). A dashboard can hold retries
// off with ctx.bleHold(ms) — used while the unit searches for a NEW pair, so
// a client that was just dropped does not steal the slot straight back.
const BLE_SAVE_KEY = "trax.ble";
let bleHoldUntil = 0, bleRetryTimer = 0, bleRetryDeadline = 0;
let bleManualOff = false;   // the user tapped Disconnect (handing the unit to another device): no auto re-link until they tap Bluetooth again
ctx.bleHold = (ms) => { bleHoldUntil = Math.max(bleHoldUntil, Date.now() + ms); };
function bleSaved()  { try { return JSON.parse(localStorage.getItem(BLE_SAVE_KEY) || "null"); } catch (e) { return null; } }
function bleRemember(id, name) { try { localStorage.setItem(BLE_SAVE_KEY, JSON.stringify({ id, name })); } catch (e) {} }
function bleStopRetry() { if (bleRetryTimer) { clearInterval(bleRetryTimer); bleRetryTimer = 0; } }
async function bleSilentConnect() {
  const saved = bleSaved();
  if (!saved || !canSilentReconnect()) return false;
  attachBle();
  try { await src.reconnect(saved.id); return true; }
  catch (e) { consoleLine("BLE auto-link: " + e.message); return false; }
}
function bleScheduleRetry() {
  if (bleManualOff || !bleSaved() || !canSilentReconnect()) return;
  bleRetryDeadline = Date.now() + 10 * 60 * 1000;    // give up after 10 min
  bleStopRetry();
  let busy = false;
  bleRetryTimer = setInterval(async () => {
    if (srcKind !== "ble") { bleStopRetry(); return; } // user switched source
    if (busy || Date.now() < bleHoldUntil) return;
    if (Date.now() > bleRetryDeadline) { bleStopRetry(); return; }
    busy = true;
    const ok = await bleSilentConnect();
    busy = false;
    if (ok) bleStopRetry();
  }, 3000);
}

// ---------------------------------------------------------------- identity / dashboards
// data-dash key of a product's markup: "gse" for GSE-TH, "generic" for the fallback.
const dashKey = (info) => (!info || info === UNKNOWN || !info.protocol) ? "generic" : info.code.toLowerCase().split("-")[0];
async function useProduct(info, id) {
  // Show only this dashboard's markup; load its protocol + dashboard modules.
  const key = dashKey(info);
  // Elements of other dashboards are hidden; this dashboard's are shown,
  // except those that own their own visibility (data-keep-hidden: the drive
  // overlay, the fault alert). Force-showing them put the phone straight
  // into the drive screen on load (Bluefy, 2026-10-21).
  // The modules load first: while they do, the previous dashboard is still
  // the one receiving lines, and it may un-hide its own elements again.
  const [p, d] = await Promise.all([info.protocol ? info.protocol() : null, info.dashboard()]);
  if (dash && dash !== d) { try { dash.unmount(); } catch (e) {} }
  proto = p; dash = d;
  document.querySelectorAll("[data-dash]").forEach((el) => {
    if (el.dataset.dash !== key) el.hidden = true;
    else if (!("keepHidden" in el.dataset)) el.hidden = false;
  });
  $("cfg").replaceChildren(); $("fields") && $("fields").replaceChildren();
  dash.mount({ ...ctx, identity: id });
  $("settings-card").hidden = !proto || !proto.SETTINGS;
  $("faults-card").hidden = !proto;
  if (advanced && proto) renderSettings();
}
function renderIdentity() {
  const id = identity;
  $("unit-name").textContent = id ? displayName(id) : "Trax";
  $("unit-id").textContent = id && id.shortId ? `#${id.shortId}` : "";
  $("unit-id").hidden = !(id && id.shortId);
  $("unit-product").textContent = id ? `${id.info.name}${id.fw ? " · firmware " + id.fw : ""}${id.guessed ? " (older firmware, no ID)" : ""}` : "";
  $("btn-rename").hidden = !(id && id.serial && src);
  // Another remembered unit with the same nickname: say so, never force a rename.
  const twins = id ? units.sameNick(id) : [];
  const t = $("unit-twin");
  t.hidden = !twins.length;
  if (twins.length) t.textContent = `Another unit is also named "${id.nick}" (#${twins.map((u) => u.shortId).join(", #")}). The number after # tells them apart.`;
  renderKnownUnits();
}
function renderKnownUnits() {
  const ul = $("known-units"); ul.replaceChildren();
  const all = Object.entries(units.all()).sort((a, b) => b[1].lastSeen - a[1].lastSeen);
  if (!all.length) { ul.innerHTML = `<li class="muted">No units remembered yet.</li>`; return; }
  all.forEach(([serial, u]) => {
    const li = document.createElement("li");
    const info = PRODUCTS[u.product] || UNKNOWN;
    const here = identity && identity.serial === serial;
    li.innerHTML = `<span><b></b> <span class="chip unit-chip"></span><br><span class="muted small"></span></span><button class="btn small ghost">Forget</button>`;
    li.querySelector("b").textContent = u.nick || `${info.short} ${u.shortId}`;
    li.querySelector(".chip").textContent = `#${u.shortId}`;
    li.querySelector(".muted").textContent = `${info.name} · serial ${serial}${u.fw ? " · fw " + u.fw : ""}${here ? " · connected now" : " · " + new Date(u.lastSeen).toLocaleDateString()}`;
    li.querySelector("button").onclick = () => { units.forget(serial); renderKnownUnits(); };
    ul.appendChild(li);
  });
}
async function onIdentity(id) {
  if (id.unknownVersion) { identity = { info: UNKNOWN, code: "?", fw: "", shortId: "", nick: "", tlmVersion: 0 }; renderIdentity(); await useProduct(UNKNOWN, identity); return; }
  const changed = !identity || identity.serial !== id.serial || identity.product !== id.product;
  identity = id;
  units.remember(id);
  renderIdentity();
  if (changed || !dash || dash.id !== dashKey(id.info)) {
    // A known product whose protocol version we cannot parse gets the generic view too.
    const p = id.info.protocol ? await id.info.protocol() : null;
    if (p && p.TLM_VERSION !== id.tlmVersion) { addEvent("APP", `This unit speaks protocol v${id.tlmVersion}; this app reads v${p.TLM_VERSION}. Update the app.`); await useProduct(UNKNOWN, id); }
    else await useProduct(id.info, id);
    // Learn the unit's own fault list first: a code this app predates is then
    // shown by its firmware name instead of "Unknown fault N" (fault 30, 2026-11-26).
    if (proto && proto.FAULTDEFS) send("FAULTDEFS");
    // The listing requested at connect was parsed with the previous product's
    // fault table (an X2 after a GSE showed "Unknown fault 24", 2026-11-25), or
    // dropped while no product was loaded. Ask again with the right table.
    if (proto) requestFaults(true);
  }
  addEvent("UNIT", `${displayName(id)} · ${id.info.name} · firmware ${id.fw} · serial ${id.serial}`);
}
function rename() {
  if (!identity || !src) return;
  const cur = identity.nick || "";
  const raw = prompt(`Name this unit (letters, numbers, spaces; up to 18 characters).\nLeave empty to use "${identity.info.short} ${identity.shortId}".`, cur);
  if (raw === null) return;
  const nick = sanitizeNick(raw);
  if (nick === cur) return;
  send(`NICK,${nick}`);
}
$("btn-rename").onclick = rename;
$("unit-name").onclick = () => { if (!$("btn-rename").hidden) rename(); };

// ---------------------------------------------------------------- settings (protocol-owned metadata)
function scaleOut(kind, v) { return kind === "x10" ? v / 10 : kind === "x100" ? v / 100 : v; }
function scaleIn(kind, v)  { return Math.round(kind === "x10" ? v * 10 : kind === "x100" ? v * 100 : v); }
function renderSettings() {
  if (!proto || !proto.SETTINGS) return;
  const { SETTINGS, SETTING_CATEGORIES } = proto;
  const box = $("cfg");
  if (!box.children.length) {
    SETTING_CATEGORIES.forEach((cat) => {
      const h = document.createElement("div"); h.className = "cat-h"; h.textContent = cat; box.appendChild(h);
      Object.entries(SETTINGS).filter(([, m]) => m.cat === cat).forEach(([key, m]) => {
        const row = document.createElement("div"); row.className = "setting"; row.dataset.key = key;
        const lbl = document.createElement("div"); lbl.className = "lbl"; lbl.textContent = m.label;
        const q = document.createElement("span"); q.className = "help"; q.textContent = "?"; q.title = m.help; lbl.appendChild(q);
        let ctl;
        if (m.kind === "enum" || m.kind === "bool" || m.kind === "enumv") {
          ctl = document.createElement("select");
          const opts = m.kind === "bool" ? [[0, "Off"], [1, "On"]] : m.kind === "enumv" ? m.values : m.enum.map((t, i) => [i, t]);
          opts.forEach(([v, t]) => { const o = document.createElement("option"); o.value = v; o.textContent = t; ctl.appendChild(o); });
        } else { ctl = document.createElement("input"); ctl.type = "number"; ctl.step = m.kind === "x10" ? "0.1" : m.kind === "x100" ? "0.01" : "1"; }
        ctl.id = "cfg-" + key; ctl.setAttribute("aria-label", m.label);
        const right = document.createElement("div"); right.style.display = "flex"; right.style.gap = "6px"; right.style.alignItems = "center";
        const unit = document.createElement("span"); unit.className = "unit"; unit.textContent = m.unit;
        const btn = document.createElement("button"); btn.className = "btn small ghost"; btn.textContent = "Set";
        btn.onclick = () => { const raw = ctl.value; const v = scaleIn(m.kind, Number(raw)); settingStatus(key, "saving…", ""); send(`CFGSET,${key},${v}`); };
        const st = document.createElement("span"); st.className = "muted small save-st";
        right.append(ctl, unit, st); row.append(lbl, right, btn);
        const desc = document.createElement("div"); desc.className = "desc"; desc.textContent = m.help; desc.hidden = true; row.appendChild(desc);
        q.onclick = () => { desc.hidden = !desc.hidden; };
        box.appendChild(row);
      });
    });
  }
  Object.entries(cfg).forEach(([key, v]) => { const m = SETTINGS[key]; const ctl = $("cfg-" + key); if (ctl && m && document.activeElement !== ctl) ctl.value = scaleOut(m.kind, v); });
}
// Save feedback next to the control: "saved" on ACK, the reason on ERR.
function settingStatus(key, text, cls) {
  const row = document.querySelector(`.setting[data-key="${key}"] .save-st`); if (!row) return;
  row.textContent = text; row.className = "muted small save-st " + cls;
  if (text === "saved") setTimeout(() => { if (row.textContent === "saved") row.textContent = ""; }, 2500);
}
function onCfg(key, value) {
  cfg[key] = value;
  if (dash && dash.onCfg) dash.onCfg(key, value);
  if (advanced) renderSettings();
}

// ---------------------------------------------------------------- faults
let faultsPending = false;
function requestFaults(force = false) {
  if (!src || (faultsPending && !force)) return;   // one request in flight at a time
  faultsPending = true; setTimeout(() => { faultsPending = false; }, 1500);
  send("FAULTS");
}
let faultsNextIdx = 0;
function faultRow(f) {
  // The bridge fans every reply out to all connected browsers, so listings
  // from other clients' FAULTS requests arrive here too. Index 0 starts a
  // fresh listing; anything out of sequence is a stray copy.
  if (f.i === 0) { $("faults").replaceChildren(); faultsNextIdx = 0; }
  if (f.i !== faultsNextIdx) return;
  faultsNextIdx++;
  const li = document.createElement("li");
  const age = f.uptime > 0 ? `${(f.uptime / 1000).toFixed(0)} s after start #${f.boot}` : `start #${f.boot}`;
  li.innerHTML = `<span class="k ${proto.isWarning(f.code) ? "WARN" : "FAULT"}">${f.code}</span><span><b></b> — <span class="d"></span><br><span class="muted small"></span></span>`;
  li.querySelector("b").textContent = f.title; li.querySelector(".d").textContent = f.text;
  li.querySelector(".muted").textContent = `${age} · pack ${f.vpack.toFixed(1)} V · detail ${f.detail}`;
  $("faults").appendChild(li);
}

// ---------------------------------------------------------------- lines
function onLine(line) {
  const id = parseId(line);
  if (id) { consoleLine(line); onIdentity(id); return; }
  if (!proto) { consoleLine(line); if (dash && dash.onLine) dash.onLine(line); return; }
  const { kind, data } = proto.parseLine(line);
  // High-rate line kinds a product declares quiet (QUIET_KINDS) stay out of the console, like TLM.
  if (kind !== "tlm" && !(proto.QUIET_KINDS || []).includes(kind)) consoleLine(line, kind === "err" ? "err" : "");
  switch (kind) {
    case "tlm":
      // Just connected and the unit has not said what it is yet: its telemetry
      // may belong to another product's protocol. Wait for the ID reply
      // (boards too old to have one answer ERR,UNKNOWN,ID at once).
      if (!identity && performance.now() < idPendingUntil) break;
      if (lastSeq >= 0 && data.seq !== lastSeq + 1) lost += data.seq - lastSeq - 1;
      lastSeq = data.seq; tlmCount++;
      dash.render(data);
      break;
    case "evt":
      if (data.kind === "IN" && !advanced) break;
      if (data.kind === "FAULT" || data.kind === "WARN") { addEvent(data.kind, `${data.title} — ${data.text}`); requestFaults(); }
      else if (data.kind === "CFG") {
        // A confirmed setting (needs the unit's button, used after a restart): b = "key=value".
        const key = String(data.b || "").split("=")[0];
        const text = { pending: "press the unit's power button to confirm", staged: "stored — restart the unit to apply",
                       timeout: "not confirmed in time", cancelled: "cancelled", nvs_fail: "could not be stored" }[data.a] || data.a;
        settingStatus(key, text, data.a === "staged" ? "ok" : data.a === "pending" ? "" : "bad");
        if (!(dash.onEvent && dash.onEvent(data))) addEvent("CFG", `${key}: ${text}`);
      }
      else if (dash.onEvent && dash.onEvent(data)) break;
      else addEvent(data.kind, data.a + (data.b ? " " + data.b : ""));
      break;
    case "cfg": onCfg(data.key, data.value); break;
    case "flt": faultRow(data); break;
    case "fdef": break;                         // already learned by the protocol module
    case "link": if (dash && dash.onLinkStatus) dash.onLinkStatus(data, srcKind); break;
    case "auth":
      // The unit minted this device its pairing token (it just won a re-pair
      // search). Store it per unit; onConnected replays it on every reconnect
      // so control comes back without another triple-press.
      if (srcKind === "ble" && src && src.deviceId) {
        try { localStorage.setItem("trax.auth." + src.deviceId, data.token); } catch (e) {}
        addEvent("BLE", "This device is now the unit's paired controller — it re-authorizes automatically from now on.");
      }
      break;
    case "ack":
      if (data.what === "FAULTS" && data.args[0] === "CLR") $("faults").replaceChildren();
      // ACK,FAULTS,<n>,<boot>: an empty store never sends a row, so say so (the "Connect and refresh"
      // placeholder counts as a child; checking children.length left it in place, simulator 2026-11-25).
      if (data.what === "FAULTS" && data.args[0] !== "CLR" && Number(data.args[0]) === 0) $("faults").innerHTML = `<li class="muted">No stored faults.</li>`;
      if (data.what === "CFGSET") { onCfg(data.args[0], Number(data.args[1])); settingStatus(data.args[0], "saved", "ok"); }
      if (data.what === "CFGRESET") addEvent("CFG", "Settings reset to defaults");
      if (data.what === "CFGSTAGED") settingStatus(data.args[0], "stored — restart the unit to apply", "ok");
      if (data.what === "CFGPEND") settingStatus(data.args[0], "press the unit's power button to confirm", "");
      if (data.what === "NICK" && identity) { identity.nick = data.args.join(","); units.remember(identity); renderIdentity(); addEvent("UNIT", identity.nick ? `Unit renamed to "${identity.nick}"` : "Unit name cleared"); }
      break;
    case "err":
      if (data.what === "CFGSET") { settingStatus(data.args[1], data.args[0] === "unknown_key" ? "unknown to this firmware — re-flash" : data.args[0].replace("_", " "), "bad"); addEvent("ERR", `Setting ${data.args[1]}: ${data.args[0]}`); }
      if (data.what === "UNKNOWN" && (data.args[0] === "LINK" || data.args[0] === "FAULTDEFS" || data.args[0] === "AUTH")) break;   // older firmware: no link status / fault list / app pairing
      if (data.what === "AUTH") {
        // Stale token: another device won a re-pair since. Forget it (stop
        // replaying it); the link banner already explains viewing-only.
        if (srcKind === "ble" && src && src.deviceId) { try { localStorage.removeItem("trax.auth." + src.deviceId); } catch (e) {} }
        break;
      }
      if (data.what === "UNKNOWN" && data.args[0] === "ID") { onIdentity({ ...identifyByName($("devname").textContent) || { product: 1, info: PRODUCTS[1] }, code: PRODUCTS[1].code, fw: "", serial: "", shortId: "", nick: "", tlmVersion: proto ? proto.TLM_VERSION : 0, guessed: true }); }
      else if (dash && dash.onError && dash.onError(data)) { /* shown by the dashboard where the operator is looking */ }
      else if ((data.what === "REMOTE" || data.what === "RC") && data.args[0] === "not_bonded") addEvent("ERR", "Remote: this phone is not paired with the unit. Triple-press the tiller power button to open pairing (60 s), accept the pairing prompt, then request control again.");
      else if ((data.what === "REMOTE" || data.what === "RC") && data.args[0] === "not_authorized") addEvent("ERR", "Remote: this connection is not authorized to drive. Triple-press the unit's power button to re-pair control to this device.");
      else if (data.what === "REMOTE" || data.what === "RC") addEvent("ERR", `Remote: ${data.args.join(" ")}`); else addEvent("ERR", data.reason);
      break;
    case "unknown":
      if (dash && dash.onLine) dash.onLine(line);
      break;
    default:
      // A product-specific line kind (e.g. the X2's DRV): the dashboard owns it.
      if (dash && dash.onData) dash.onData(kind, data);
      break;
  }
}
function onConnected(s) {
  requestFaults(); s.send("CFGGET"); s.send("LINK");
  // Replay this device's pairing token: the unit re-authorizes it for control
  // without another triple-press (AUTH is only ever stored for a unit that
  // minted one, so old firmware never sees the command).
  if (srcKind === "ble" && s.deviceId) {
    let t = null; try { t = localStorage.getItem("trax.auth." + s.deviceId); } catch (e) {}
    if (t) s.send("AUTH," + t);
  }
  if (!idRequested) { idRequested = true; idPendingUntil = performance.now() + 1500; s.send("ID"); }
}

// ---------------------------------------------------------------- sources
function attach(s, label) {
  if (src) { try { src.disconnect(); } catch (e) {} }
  if (dash) dash.unmount && dash.unmount();
  src = s;
  s.onLine = onLine;
  s.onError = (m) => consoleLine("BLE: " + m, "err");
  s.onConn = ({ link, kind, name }) => {
    setLink(link, name || label); if (dash && dash.onLink) dash.onLink(link); if (link) onConnected(s); renderIdentity();
    if (kind === "ble") {
      $("btn-ble-off").hidden = !link;
      if (link) { bleStopRetry(); if (s.deviceId) bleRemember(s.deviceId, name); }
      else bleScheduleRetry();   // silent re-link (not after a manual Disconnect)
    }
  };
  s.onMeta = (m) => {
    if (m.type === "conn") { srcKind = m.connected ? m.kind : ""; setLink(m.connected, m.connected ? `${m.kind}: ${m.name}` : "bridge"); if (dash && dash.onLink) dash.onLink(m.connected); $("sim-controls").hidden = m.kind !== "sim"; showSimButtons(); if (m.connected) onConnected(s); renderIdentity(); }
    if (m.type === "ports") { const sel = $("ports"); sel.replaceChildren(); m.ports.forEach((p) => { const o = document.createElement("option"); o.value = p.device; o.textContent = `${p.device} — ${p.desc}`; sel.appendChild(o); }); if (!m.ports.length) { const o = document.createElement("option"); o.textContent = "no serial ports"; sel.appendChild(o); } }
    if (m.type === "logging") { $("chk-log").checked = m.on; $("logpath").textContent = m.path || ""; }
    if (m.type === "log") consoleLine(m.text);
  };
}

$("btn-bridge").onclick = () => { attach(new BridgeSource(), "bridge"); src.connect(); $("bridge-controls").hidden = false; };
function attachBle() {
  attach(new BleSource(), "BLE"); srcKind = "ble";
  $("bridge-controls").hidden = true; $("sim-controls").hidden = true;
}
$("btn-ble").onclick = async () => {
  if (!isWebBluetoothSupported()) { alert("Web Bluetooth is not available in this browser. On iPhone use a WebBLE browser such as Bluefy; on desktop use Chrome or Edge."); return; }
  bleHoldUntil = 0; bleManualOff = false;   // an explicit tap means: this device, now
  attachBle();
  try { await src.connect(); } catch (e) {
    consoleLine("BLE: " + e.message, "err"); setLink(false);
    // The unit forgot this phone (BONDS,CLR / re-flash) but the phone still holds the old key:
    // the OS tries to encrypt with it, the unit cannot, and the link drops before the services load.
    if (/disconnected|Cannot retrieve services|GATT/i.test(e.message)) addEvent("ERR", "Bluetooth: the connection dropped before the unit answered. If this phone shows the unit as already paired but the unit has forgotten it, forget the unit in the phone's Bluetooth settings, then connect again inside a pairing window (triple-press).");
  }
};
function showSimButtons() { document.querySelectorAll(".sim").forEach((b) => { if (!b.closest("#sim-controls")) b.hidden = !(advanced && srcKind === "sim"); }); }
$("btn-ble-off").onclick = () => {
  // Hand the unit to another device: drop the link and stay away until the
  // user taps Bluetooth again (auto re-link would steal the slot back).
  bleManualOff = true; bleStopRetry();
  if (src && srcKind === "ble") { try { src.disconnect(); } catch (e) {} }
  $("btn-ble-off").hidden = true;
};
$("btn-adv").onclick = () => { advanced = !advanced; $("advanced").hidden = !advanced; $("btn-adv").setAttribute("aria-pressed", advanced); showSimButtons(); try { localStorage.setItem("gse.adv", advanced ? "1" : "0"); } catch (e) {} if (advanced) { renderSettings(); if (dash && dash.onAdvanced) dash.onAdvanced(true); } };
$("btn-faults").onclick = requestFaults;
$("btn-faults-clr").onclick = () => send("FAULTS,CLR");
$("btn-cfg").onclick = () => send("CFGGET");
$("btn-cfg-reset").onclick = () => { if (confirm("Reset every setting on the unit to the factory defaults?")) send("CFGRESET"); };
$("btn-serial").onclick = () => src && src.connectSerial && src.connectSerial($("ports").value);
$("btn-ports").onclick = () => src && src.listPorts && src.listPorts();
$("chk-log").onchange = (e) => src && src.setLogging && src.setLogging(e.target.checked);
document.querySelectorAll(".sim").forEach((b) => { b.onclick = () => send("SIM," + b.dataset.s); });
$("cmdform").onsubmit = (e) => { e.preventDefault(); const t = $("cmd").value.trim(); if (t) send(t); $("cmd").value = ""; };

setInterval(() => { const dt = (performance.now() - rateT0) / 1000; const rateText = `${(tlmCount / dt).toFixed(1)} Hz · lost ${lost}`; $("rate").textContent = rateText;
  document.querySelectorAll("[data-rate]").forEach((el) => { el.textContent = rateText; }); tlmCount = 0; rateT0 = performance.now(); }, 2000);

// Default dashboard until the unit identifies itself: the GSE tiller handle
// (boards flashed before the ID line existed only ever speak GSE v1).
await useProduct(PRODUCTS[1], null);
renderIdentity();
try { if (localStorage.getItem("gse.adv") === "1") $("btn-adv").click(); } catch (e) {}
// Served by the bridge on the laptop / LAN: connect to it. Hosted on the web
// (the customer link, HTTPS): the unit is reached over Bluetooth only.
const onLan = ["localhost", "127.0.0.1"].includes(location.hostname) || /^(10|192\.168|172\.(1[6-9]|2\d|3[01]))\./.test(location.hostname);
const viaBridge = location.protocol === "file:" || onLan;
if (!viaBridge) { $("btn-bridge").hidden = true; $("bridge-controls").hidden = true; }
// A unit this browser connected to before links again by itself (Web
// Bluetooth permission persistence); otherwise the old behavior: the bridge
// on the LAN, the connect hint when hosted.
if (bleSaved() && canSilentReconnect()) {
  bleSilentConnect().then((ok) => {
    if (ok) return;
    if (viaBridge) $("btn-bridge").click();
    else $("connect-hint").hidden = false;
  });
} else if (viaBridge) $("btn-bridge").click();
else $("connect-hint").hidden = false;
