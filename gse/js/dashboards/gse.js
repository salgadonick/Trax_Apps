// =============================================================================
// dashboards/gse.js — the GSE tiller-handle dashboard: operator view, advanced
// (bench) view, remote control and the full-screen drive mode. Everything in
// index.html marked data-dash="gse" belongs to this module.
//
// Dashboard contract (see app.js): { id, mount(ctx), render(d), onEvent(evt), onError(err), onLink(on), onLinkStatus(link, transport),
// onCfg(key, value), onAdvanced(on), unmount() }. `ctx` gives the shell's
// helpers: $, send, cfg (live settings), addEvent, badge, isAdvanced(),
// srcKind() and the protocol module.
// =============================================================================
import { TLM_FIELDS, FIELD_CATEGORIES, INPUT_NAMES, OUTPUT_NAMES, INPUT_LABELS, OUTPUT_LABELS,
         DIR_NAMES, J20_NAMES, SRC_NAMES, STATE_TEXT, CHEM, hoursToFull, faultTitle, tapsPlausible } from "../protocol/gse-v1.js";

export const id = "gse";

let ctx = null, $ = null, send = null, cfg = null, badge = null;
let last = null;
let iSmooth = null;             // EMA of board current for a steady low-current display
const chart = { v36: [], i: [], vmc: [], max: 600 };
// SOC under load (REQ-PWR-5): anchor on the last idle reading, then subtract
// the charge consumed since; never re-read the loaded voltage as "SOC".
const socEst = { restSoc: null, idleSince: null, consumedAh: 0, lastT: null, avgI: null };

const fmtH = (h) => h == null ? "—" : h < 1 ? `${Math.round(h * 60)} min` : `${h.toFixed(1)} h`;
const socClass = (p) => p < 15 ? "low" : p < 35 ? "mid" : "";
const chem = () => CHEM[cfg.batt_chem ?? 0] || CHEM[0];
const bucksOff = () => cfg.tb_enable === 0 && cfg.way7_mode === 0;
const simUi = () => ctx.isAdvanced() && ctx.srcKind() === "sim";

export function mount(c) {
  ctx = c; $ = c.$; send = c.send; cfg = c.cfg; badge = c.badge;
  if (!mounted) { wire(); mounted = true; }
  setStick(0);
  closeDrive();                                   // the drive view opens only on arming
  window.__gse = { socEst, cfg, get last() { return last; } };   // debugging hook (read-only use)
}
export function unmount() { stopRc(); closeDrive(); }
export function onAdvanced(on) { if (on && last) renderAdvanced(last); }
export function onCfg(key, value) {
  if (key === "thr_limit" && document.activeElement !== $("thr-limit")) { $("thr-limit").value = value; $("thr-limit-v").textContent = value + " %"; }
}
// ERR replies to the operator's own actions, shown under the button that
// caused them. The events list is at the bottom of the page and off-screen on
// a phone (Bluefy, 2026-10-21: a refused request looked like nothing happened).
// What this phone's link may do, from the unit's LINK line (Web Bluetooth only:
// serial/bridge links are bench links and always allowed).
let link = null;
const LINK_TEXT = {
  occupied: "This unit is paired to another phone. To take over: triple-press the tiller power button. The unit will disconnect; connect again, request control and accept the pairing prompt.",
  unpaired: "This phone is not paired with this unit yet. Triple-press the tiller power button to open pairing (60 s), then request control and accept the pairing prompt.",
  pairing:  "Pairing window open: request control now and accept the pairing prompt.",
};
function linkState() { if (!link || link.bonded) return "ok"; if (link.pairing) return "pairing"; return link.hasBond ? "occupied" : "unpaired"; }
function renderLinkStatus() {
  const p = $("remote-link"); if (!p) return;
  const st = linkState();
  p.hidden = st === "ok"; p.textContent = LINK_TEXT[st] || "";
  p.className = "drive-banner" + (st === "occupied" ? " bad" : "");
}
export function onLinkStatus(d, transport) { link = transport === "ble" ? d : null; renderLinkStatus(); if (linkState() !== "ok") remoteMsg(""); }

const REMOTE_ERR = {
  not_bonded:  "This phone is not paired with the unit. Triple-press the tiller power button to open pairing (60 s). If the unit drops the connection at that moment, connect again. Then request control, accept the pairing prompt, and request once more.",
  occupied:    "This unit is paired to another phone. Triple-press the tiller power button to take over; the unit will disconnect. Connect again, request control and accept the pairing prompt.",
  not_run:     "The unit is not running. Start it from the tiller first.",
  not_at_rest: "Release the throttle and direction on the tiller, then request again.",
  busy:        "A request is already in progress.",
  not_armed:   "Remote control is not active.",
  not_stopped: "Nothing to resume.",
  disabled:    "Remote control is not enabled in this unit's firmware.",
};
function remoteMsg(text) { const m = $("remote-msg"); if (!m) return; m.hidden = !text; m.textContent = text || ""; }
export function onLink(on) {
  // Link gone: nothing we remember about the session is true any more.
  if (!on) { stopRc(); srcNow = 0; closeDrive(); remoteMsg(""); link = null; renderLinkStatus(); }
}
export function onError(data) {
  if (data.what === "RC") {
    // Frames refused: the unit is not under our control, whatever the screen says.
    if (rc.armed) { stopRc(); if (!(last && (last.state === "FAULT" || last.estop_l))) closeDrive(); }
    if (data.args[0] === "not_bonded") remoteMsg(REMOTE_ERR.not_bonded);
    else remoteMsg("The unit is not under remote control. Request control again.");
    return true;
  }
  if (data.what !== "REMOTE") return false;
  const why = data.args[0];
  remoteMsg(REMOTE_ERR[why] || `The unit refused: ${why}`);
  ctx.addEvent("ERR", `Remote: ${REMOTE_ERR[why] || why}`);
  return true;
}

export function onEvent(data) {
  if (data.kind === "REMOTE") {
    const t = { pending: "Remote control requested — press the tiller button", armed: "Remote control active", released: "Remote control released",
                overridden: "Local input detected — the control channel has been interrupted", lost: "Control link interrupted", timeout: "Remote request timed out",
                stopped: "Remote STOP latched", link_lost: "Control link lost — the unit stopped and the tiller is back in control" }[data.a] || data.a;
    ctx.addEvent("REMOTE", t);
    if (data.a === "pending" || data.a === "armed") remoteMsg("");
    if (data.a === "armed" && !rc.armed) { srcNow = 2; startRc(); openDrive(); }   // first frame goes out now, not at the next TLM
    if (data.a === "overridden") $("remote-lost-text").textContent = "Local input detected — the control channel has been interrupted. Request control again to continue.";
    if (data.a === "lost") $("remote-lost-text").textContent = "No commands reached the unit. It has stopped and is holding.";
    return true;
  }
  if (data.kind === "STATE") { ctx.addEvent("STATE", `${STATE_TEXT[data.a] || data.a}`); return true; }
  if (data.kind === "PWR" && data.a.startsWith("pairing")) { ctx.addEvent("PWR", data.a === "pairing_open" ? "Bluetooth pairing window open — pair your phone now (60 s)" : "Bluetooth pairing window closed"); if (data.a === "pairing_open") remoteMsg(""); return true; }
  return false;
}

// ---------------------------------------------------------------- operator view
export function render(d) {
  last = d;
  const hero = $("hero");
  hero.className = "hero state-" + d.state;
  $("state").textContent = d.state === "FAULT" ? "STOPPED" : d.state === "RUN" ? "RUNNING" : d.state.replace("_", " ");
  $("state-text").textContent = d.state === "FAULT" ? d.faultTitle : (STATE_TEXT[d.state] || d.state);
  const sub = [];
  if (d.state === "RUN" && d.guard < 100) sub.push(`Power limited to ${d.guard}% (low battery)`);
  if (d.src !== 0) sub.push(`Control: ${d.srcName}`);
  if (d.state === "RUN" && d.sleep > 0 && d.sleep < 120) sub.push(`Auto-off in ${d.sleep}s`);
  $("state-sub").textContent = sub.join(" · ");

  const alert = $("alert");
  if (d.state === "FAULT") {
    alert.hidden = false; alert.classList.remove("warn");
    $("alert-title").textContent = d.faultTitle + `  (code ${d.fault})`;
    const restartable = !d.estop_l && d.fault !== 1;
    $("alert-text").textContent = d.faultText + (restartable ? " Fix the cause, then Restart — or turn the unit off and on." : " Turn the unit off and on again once the cause is fixed.");
    $("btn-powercycle").hidden = !simUi();
    $("btn-restart").hidden = !restartable;
  } else if (d.estop_l) {
    alert.hidden = false; alert.classList.remove("warn");
    $("alert-title").textContent = "Emergency stop"; $("alert-text").textContent = "Power cycle to clear.";
    $("btn-powercycle").hidden = !simUi();
    $("btn-restart").hidden = true;
  } else { alert.hidden = true; $("btn-restart").hidden = true; }

  // ---- battery ----
  const k = chem();
  // Current: light smoothing, and the sub-1 A region is shown as a band rather than a fluttering number.
  iSmooth = iSmooth === null ? d.i_board : iSmooth + 0.25 * (d.i_board - iSmooth);
  const now = performance.now();
  const dtH = socEst.lastT === null ? 0 : (now - socEst.lastT) / 3.6e6;
  socEst.lastT = now;
  const idle = iSmooth < 1;
  if (idle) {
    if (socEst.idleSince === null) socEst.idleSince = now;
    if (now - socEst.idleSince > 2000 && d.soc >= 0) { socEst.restSoc = d.soc; socEst.consumedAh = 0; socEst.avgI = null; }
  } else {
    socEst.idleSince = null;
    socEst.consumedAh += iSmooth * dtH;
    socEst.avgI = socEst.avgI === null ? iSmooth : socEst.avgI + 0.02 * (iSmooth - socEst.avgI);
  }
  const ah = cfg.batt_ah ?? 35;
  let soc = d.soc >= 0 ? d.soc : null;
  let socNote = "";
  if (!idle && socEst.restSoc !== null) {
    soc = Math.max(0, socEst.restSoc - socEst.consumedAh / ah * 100);
    socNote = `from the last idle reading (${socEst.restSoc.toFixed(0)} %) minus ${socEst.consumedAh.toFixed(2)} Ah used`;
  } else if (!idle && soc !== null) {
    socNote = "voltage-based, under load — settles at the next idle";
  }
  $("soc-src").hidden = !socNote; $("soc-note").textContent = socNote;
  $("batt-type").textContent = cfg.batt_ah ? ((cfg.batt_series ?? 3) === 1 ? `36 V ${cfg.batt_ah} Ah ${k.name}` : `3 × 12 V ${cfg.batt_ah} Ah ${k.name}`) : "";
  $("soc").textContent = soc === null ? "—" : soc.toFixed(0);
  const sb = $("socbar"); sb.style.width = (soc ?? 0) + "%"; sb.className = "bar-fill " + socClass(soc ?? 100);
  $("v36").textContent = d.v36.toFixed(2) + " V";
  // Per-battery values only when the pack has taps and they read plausibly.
  const taps = (cfg.batt_series ?? 3) >= 2 && tapsPlausible(d.v12, d.v24, d.v36);
  [["b1", d.b1], ["b2", d.b2], ["b3", d.b3]].forEach(([id, v]) => {
    const bar = $(id + "bar");
    if (!taps) { $(id).textContent = "—"; bar.style.width = "0"; return; }
    $(id).textContent = v.toFixed(2) + " V";
    const f = Math.max(0, Math.min(1, (v - k.v[0]) / (k.v[10] - k.v[0])));
    bar.style.width = (f * 100) + "%";
    bar.style.background = f < 0.15 ? "var(--bad)" : f < 0.35 ? "var(--warn)" : "var(--ok)";
  });
  document.querySelector(".units").title = taps ? "" : "Individual batteries are not monitored on this pack";
  $("i-label").textContent = bucksOff() ? "Motor current" : "Board current";
  $("i_board").textContent = iSmooth < 1 ? "< 1 A" : iSmooth.toFixed(1) + " A";
  const charging = d.v36 / (cfg.batt_series ?? 3) >= k.chargeV;
  const bb = $("batt-badges"); bb.replaceChildren();
  if (charging) badge(bb, "Charging", "ok");
  if (d.guard < 100) badge(bb, "Power limited", "warn");
  const spread = Math.max(d.b1, d.b2, d.b3) - Math.min(d.b1, d.b2, d.b3);
  if (taps && spread >= (cfg.weak_dv_x100 ?? 40) / 100) badge(bb, `Unevenly charged (${spread.toFixed(2)} V apart)`, "warn");
  if (!taps) badge(bb, (cfg.batt_series ?? 3) >= 2 ? "Battery taps not connected" : "Single 36 V battery", "");
  const chgRow = $("chg-row"), runRow = $("run-row");
  chgRow.hidden = !charging || soc === null;
  if (charging && soc !== null) $("chg-time").textContent = "~" + fmtH(hoursToFull(cfg.batt_chem ?? 0, soc, cfg.batt_ah ?? 35, (cfg.chg_amps_x10 ?? 40) / 10));
  const running = !charging && !idle && soc !== null && socEst.avgI !== null;
  runRow.hidden = !running;
  if (running) {
    // Remaining Ah at the trip's average current (Peukert), not the instantaneous load.
    const iAvg = Math.max(1, socEst.avgI);
    const ahEff = ah * Math.pow(Math.min(1, ah / (iAvg * 20)), k.peukert - 1);
    $("run-time").textContent = "~" + fmtH((soc / 100) * ahEff / iAvg) + ` at ${iAvg.toFixed(0)} A avg`;
  }

  // ---- drive ----
  $("thr").textContent = `${d.thr_in.toFixed(2)} V → ${d.thr_out.toFixed(0)} %`;
  $("thrbar").style.width = d.thr_out + "%";
  $("dir").textContent = DIR_NAMES[d.dir_in] + (d.dir_out !== d.dir_in ? ` (controller: ${DIR_NAMES[d.dir_out]})` : "");
  $("speed").textContent = d.inputs.speed ? "slow" : "normal";
  $("mbrake").textContent = d.inputsValid.brake_pd ? (d.inputs.brake_pd ? "released" : "engaged") : "—";
  $("tb").textContent = cfg.tb_enable === 0 ? "disabled" : d.outputs.tb_bus ? `${d.tb_pct} %  ·  ${d.i_tb.toFixed(1)} A` : "off";
  const db = $("drive-badges"); db.replaceChildren();
  if (d.dir_in === 3) badge(db, "Both directions!", "bad");
  if (d.inputs.horn) badge(db, "Horn", "");
  if (d.inputs.lift || d.outputs.lift) badge(db, "Lift", ""); if (d.inputs.lower || d.outputs.lower) badge(db, "Lower", "");
  if (d.outputs.ksi) badge(db, "Key on", "ok"); if (d.outputs.idc) badge(db, "Main power", "ok");
  if (d.j20 === 1) badge(db, "Controller ready", "ok"); else if (d.j20 === 2) badge(db, "Controller not ready", "warn");

  remoteUi(d.src);
  if (!$("drive").hidden) { driveStats(); $("btn-dv-aux").hidden = cfg.aux12_mode !== 1; }
  if (ctx.isAdvanced()) renderAdvanced(d);
  if (!$("drive").hidden) driveBlock();
}

// ---------------------------------------------------------------- advanced view
function renderAdvanced(d) {
  const inp = $("inputs"); inp.replaceChildren();
  INPUT_NAMES.forEach((n) => { const c = document.createElement("span"); c.className = "chip" + (d.inputs[n] ? " on" : "") + (d.inputsValid[n] ? "" : " inv"); c.textContent = INPUT_LABELS[n]; c.title = d.inputsValid[n] ? "" : "not powered / not valid"; inp.appendChild(c); });
  const out = $("outputs"); out.replaceChildren();
  OUTPUT_NAMES.forEach((n) => { const c = document.createElement("span"); c.className = "chip" + (d.outputs[n] ? " on" : ""); c.textContent = OUTPUT_LABELS[n]; out.appendChild(c); });

  const box = $("fields");
  if (!box.children.length) {
    FIELD_CATEGORIES.forEach((cat) => {
      const h = document.createElement("div"); h.className = "cat-h"; h.textContent = cat; box.appendChild(h);
      const t = document.createElement("table"); const tb = document.createElement("tbody"); t.appendChild(tb);
      TLM_FIELDS.filter(([, , , , c]) => c === cat).forEach(([k, , label, unit]) => {
        if (k === "in" || k === "valid" || k === "out") return;          // shown as chips above
        const tr = document.createElement("tr"); tr.innerHTML = `<td>${label}</td><td class="v" data-k="${k}"></td><td class="muted">${unit}</td>`; tb.appendChild(tr);
      });
      const w = document.createElement("div"); w.className = "tablewrap"; w.appendChild(t); box.appendChild(w);
    });
  }
  const fmt = {
    state: (v) => v, fault: (v) => v ? `${v} — ${faultTitle(v)}` : "none", src: (v) => SRC_NAMES[v] || v,
    j20: (v) => J20_NAMES[v] || v, dir_in: (v) => DIR_NAMES[v] || v, dir_out: (v) => DIR_NAMES[v] || v,
    ilk: (v) => v ? "0x" + v.toString(16) : "none", temp: (v) => v <= -99 ? "no sensor" : v.toFixed(1),
    soc: (v) => v < 0 ? "unknown" : v.toFixed(1), estop_l: (v) => v ? "yes" : "no",
    up: (v) => `${Math.floor(v / 60)} min ${v % 60} s`, sleep: (v) => v ? `${Math.floor(v / 60)} min ${v % 60} s` : "disabled",
  };
  TLM_FIELDS.forEach(([k]) => { const el = box.querySelector(`[data-k="${k}"]`); if (!el) return; const v = d[k]; el.textContent = fmt[k] ? fmt[k](v) : (typeof v === "number" && !Number.isInteger(v) ? v.toFixed(2) : v); });

  chart.v36.push(d.v36); chart.i.push(d.i_board); chart.vmc.push(d.v_mc);
  for (const k of ["v36", "i", "vmc"]) if (chart[k].length > chart.max) chart[k].shift();
  drawChart();
}

function drawChart() {
  const c = $("chart"); const dpr = window.devicePixelRatio || 1;
  const W = c.clientWidth, H = 160;
  if (!W) return;
  if (c.width !== W * dpr) { c.width = W * dpr; c.height = H * dpr; }
  const g = c.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
  const css = getComputedStyle(document.documentElement);
  g.strokeStyle = css.getPropertyValue("--line"); g.lineWidth = 1;
  for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(0, H * i / 4); g.lineTo(W, H * i / 4); g.stroke(); }
  for (const [k, lo, hi, col] of [["v36", 30, 45, "--ok"], ["i", 0, 60, "--accent"], ["vmc", 0, 45, "--info"]]) {
    const a = chart[k]; if (a.length < 2) continue;
    g.strokeStyle = css.getPropertyValue(col); g.lineWidth = 1.5; g.beginPath();
    a.forEach((v, i) => { const x = i / (chart.max - 1) * W, y = H - (Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo) * H; i ? g.lineTo(x, y) : g.moveTo(x, y); });
    g.stroke();
  }
  g.fillStyle = css.getPropertyValue("--muted"); g.font = "11px system-ui";
  g.fillText("V: 30–45   A: 0–60", 6, 12);
}

// ---------------------------------------------------------------- remote control
const rc = { armed: false, thr: 0, lift: 0, lower: 0, horn: 0, aux: 0, seq: 0, timer: null, expo: 0.5 };
let srcNow = 0;
function remoteUi(srcCode) {
  srcNow = srcCode;
  $("remote-state").textContent = SRC_NAMES[srcCode] || "local";
  $("remote-idle").hidden = srcCode !== 0;
  $("remote-pending").hidden = srcCode !== 1;
  $("remote-armed").hidden = srcCode !== 2;
  $("remote-lost").hidden = srcCode !== 3;
  $("remote-stopped").hidden = srcCode !== 4;
  const restartable = !!(last && last.state === "FAULT" && !last.estop_l && last.fault !== 1);
  $("btn-remote-restart").hidden = !restartable;
  $("btn-dv-restart").hidden = !restartable;
  const armed = srcCode === 2 || srcCode === 4;          // 4 = stopped: keep-alive frames only
  if (armed && !rc.armed) { startRc(); openDrive(); }
  else if (!armed && rc.armed) stopRc();
  if (srcCode === 0 && !$("drive").hidden && !(last && (last.state === "FAULT" || last.estop_l))) closeDrive();   // a fault keeps the E-STOP/FAULT block up
  driveBanner(srcCode);
  driveBlock();
}
// Full-screen block over the drive view. A latched remote STOP clears in two
// taps (misclick protection); a fault or the tiller e-stop is a hard latch that
// only a power cycle at the unit clears.
let clearArmed = false;
function driveBlock() {
  const b = $("dv-block"), fault = last && (last.state === "FAULT" || last.estop_l);
  const stopped = srcNow === 4;
  if (!fault && !stopped) { b.hidden = true; clearArmed = false; return; }
  b.hidden = false;
  b.className = "drive-block" + (fault ? "" : " warn");
  $("dv-block-title").textContent = fault ? (last.estop_l ? "E-STOP" : "FAULT") : "STOPPED";
  $("dv-block-text").textContent = fault
    ? (last.estop_l ? "The e-stop was pressed at the tiller. It is latched: power-cycle the unit at the tiller to clear it."
                    : (last.faultTitle || "The unit has shut down") + ((!last.estop_l && last.fault !== 1) ? ". Fix the cause, then Restart, or power-cycle at the tiller." : ". Latched until the unit is power-cycled at the tiller."))
    : (clearArmed ? "Make sure the area around the unit is clear, then confirm." : "Remote STOP is latched. The unit is holding with the trailer brake on.");
  $("btn-dv-clear").hidden = fault || clearArmed;
  $("btn-dv-confirm").hidden = fault || !clearArmed;
  $("btn-dv-clear-cancel").hidden = fault || !clearArmed;
  $("btn-dv-block-release").hidden = fault;
  $("btn-dv-block-close").hidden = !fault;
}
function startRc() { rc.armed = true; rc.thr = 0; rc.timer = setInterval(sendRc, 100); }
function stopRc() { rc.armed = false; clearInterval(rc.timer); rc.timer = null; if ($) setStick(0); }
function sendRc() { if (!rc.armed) return; ctx.sendRaw(`RC,${rc.seq++ & 0xffff},${rc.thr},${rc.lift},${rc.lower},${rc.horn},${rc.aux}`); }

// ---- full-screen drive mode ----
function openDrive() { $("drive").hidden = false; document.body.classList.add("driving"); driveStats(); }
function closeDrive() { if (!$) return; $("drive").hidden = true; document.body.classList.remove("driving"); }
function driveBanner(srcCode) {
  const b = $("dv-banner");
  $("btn-dv-resume").hidden = srcCode !== 3;
  if (srcCode === 3) { b.hidden = false; b.className = "drive-banner"; b.textContent = "Control link interrupted — the unit has stopped. Resume, or release control."; }
  else if (srcCode === 0 && !$("drive").hidden) { b.hidden = false; b.className = "drive-banner bad"; b.textContent = "Control returned to the tiller."; }
  else b.hidden = true;
}
function driveStats() {
  if (!last) return;
  $("dv-soc").textContent = last.soc >= 0 ? last.soc.toFixed(0) + " %" : "—";
  $("dv-i").textContent = (iSmooth === null ? last.i_board : iSmooth) < 1 ? "< 1 A" : (iSmooth ?? last.i_board).toFixed(0) + " A";
  $("dv-lim").textContent = (cfg.thr_limit ?? 100) + " %";
  $("dv-link").textContent = srcNow === 2 ? "armed" : srcNow === 3 ? "LOST" : srcNow === 4 ? "STOPPED" : "local";
}

// Vertical throttle: drag and hold anywhere on the track; up = forward. Position
// maps through a mild expo (rc.expo) so the first centimetres are fine control.
// Pointer capture keeps the drag alive when the finger wanders; release = idle.
let vstick, vknob, vfill;
function setStick(v) {
  rc.thr = Math.round(Math.max(-100, Math.min(100, v)));
  const pct = rc.thr / 100;                                  // -1..1, + = forward = up
  const y = 50 - pct * 42;                                   // knob centre, % of track height
  vknob.style.top = y + "%";
  vfill.style.top = (pct > 0 ? y : 50) + "%";
  vfill.style.height = Math.abs(pct) * 42 + "%";
  vstick.setAttribute("aria-valuenow", rc.thr);
  const label = (rc.thr > 0 ? "▲ " : rc.thr < 0 ? "▼ " : "") + Math.abs(rc.thr) + " %";
  $("dv-thr").textContent = label;
}
function stickFromEvent(e) {
  const r = vstick.getBoundingClientRect();
  const y = (e.clientY - r.top) / r.height;                 // 0 top .. 1 bottom
  const raw = Math.max(-1, Math.min(1, (0.5 - y) / 0.42));  // ±1 at the marks
  const mag = rc.expo * raw * raw + (1 - rc.expo) * Math.abs(raw);
  return Math.sign(raw) * mag * 100;
}

let mounted = false;
function wire() {
  vstick = $("vstick"); vknob = $("vstick-knob"); vfill = $("vstick-fill");
  vstick.addEventListener("pointerdown", (e) => { if (!rc.armed || srcNow !== 2) return; vstick.setPointerCapture(e.pointerId); vstick.classList.add("active"); setStick(stickFromEvent(e)); e.preventDefault(); });
  vstick.addEventListener("pointermove", (e) => { if (vstick.classList.contains("active")) { setStick(stickFromEvent(e)); e.preventDefault(); } });
  const stickRelease = () => { vstick.classList.remove("active"); setStick(0); sendRc(); };
  vstick.addEventListener("pointerup", stickRelease);
  vstick.addEventListener("pointercancel", stickRelease);
  vstick.addEventListener("lostpointercapture", stickRelease);
  // iOS: block the page's own touch handling while the overlay is up (rubber-band, pull-to-refresh).
  $("drive").addEventListener("touchmove", (e) => e.preventDefault(), { passive: false });
  $("drive").addEventListener("touchstart", (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
  document.querySelectorAll(".btn.hold").forEach((b) => {
    const k = b.dataset.rc;
    const down = (e) => { if (!rc.armed || srcNow !== 2) return; b.setPointerCapture(e.pointerId); b.classList.add("active"); rc[k] = 1; sendRc(); e.preventDefault(); };
    const up = () => { b.classList.remove("active"); rc[k] = 0; sendRc(); };
    b.addEventListener("pointerdown", down); b.addEventListener("pointerup", up); b.addEventListener("pointercancel", up); b.addEventListener("lostpointercapture", up);
  });
  $("btn-restart").onclick = () => { if (confirm("Restart the unit's start-up sequence? Make sure the cause of the fault is fixed and the area is clear.")) send("RESTART"); };
  $("btn-remote-req").onclick = () => {
    remoteMsg("");
    if (!last) { remoteMsg("Not connected to a unit."); return; }
    const ls = linkState();
    if (ls === "occupied" || ls === "unpaired") { remoteMsg(LINK_TEXT[ls]); return; }   // the LINK line already said no: explain, do not fail
    if (last.state !== "RUN") {
      remoteMsg(last.state === "FAULT" ? `The unit is stopped on a fault (${last.faultTitle || "fault"}). Restart it first.`
              : last.estop_l ? "The e-stop is latched at the tiller. Power-cycle the unit."
              : `The unit is not running (${STATE_TEXT[last.state] || last.state}). Start it from the tiller first.`);
      return;
    }
    send("REMOTE,REQ");
  };
  const restart = () => { if (confirm("Restart the unit's start-up sequence? Make sure the cause of the fault is fixed and the area is clear.")) send("RESTART"); };
  $("btn-remote-restart").onclick = restart;
  $("btn-dv-restart").onclick = () => { restart(); closeDrive(); };
  $("btn-remote-cancel").onclick = () => send("REMOTE,REL");
  $("btn-remote-rel").onclick = () => send("REMOTE,REL");
  $("btn-remote-rel2").onclick = () => send("REMOTE,REL");
  $("btn-remote-resume").onclick = () => send("REMOTE,RESUME");
  $("btn-drive-open").onclick = openDrive;
  $("btn-dv-stop").onclick = () => { setStick(0); rc.lift = rc.lower = rc.horn = 0; send("REMOTE,STOP"); };
  $("btn-dv-resume").onclick = () => send("REMOTE,RESUME");
  $("btn-dv-clear").onclick = () => { clearArmed = true; driveBlock(); };
  $("btn-dv-clear-cancel").onclick = () => { clearArmed = false; driveBlock(); };
  $("btn-dv-confirm").onclick = () => { clearArmed = false; send("REMOTE,RESUME"); };
  $("btn-dv-block-release").onclick = () => { send("REMOTE,REL"); closeDrive(); };
  $("btn-dv-block-close").onclick = closeDrive;
  $("btn-remote-open2").onclick = openDrive;
  $("btn-remote-rel3").onclick = () => send("REMOTE,REL");
  $("btn-dv-release").onclick = () => { send("REMOTE,REL"); closeDrive(); };
  $("btn-dv-aux").onclick = () => { rc.aux = rc.aux ? 0 : 1; $("btn-dv-aux").textContent = rc.aux ? "Unlock" : "Lock"; sendRc(); };
  // Leaving the page while armed: stop first. The deadman on the unit covers the rest.
  // Backgrounded (phone locked, app switched): timers stop, so frames stop. A
  // STOP would need keep-alive frames and would time out into a link loss;
  // release cleanly instead. Coming back means requesting control again.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && (srcNow === 2 || srcNow === 3 || srcNow === 4)) { setStick(0); stopRc(); send("REMOTE,REL"); closeDrive(); }
  });
  $("thr-limit").oninput = (e) => { $("thr-limit-v").textContent = e.target.value + " %"; };
  $("thr-limit").onchange = (e) => send(`CFGSET,thr_limit,${e.target.value}`);
}
