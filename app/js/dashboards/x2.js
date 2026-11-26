// =============================================================================
// dashboards/x2.js — the X2 dual-motor dashboard: operator view, advanced
// (bench) view, phone control and the full-screen drive mode. Everything in
// index.html marked data-dash="x2" belongs to this module; its element ids all
// start with "x2-".
//
// Phone control mimics the radio remote: the drive screen sends the same
// things the handheld sends (two axes, the speed knob, the button mask), and
// the unit runs them through the same mixer. Two control styles:
//   RC car  like the Trax handheld: the LEFT stick is forward / reverse, the
//           RIGHT stick is rotation
//   Tank    like the Kar-Tech remote: the LEFT lever is the left track, the
//           RIGHT lever is the right track
// The style is the UNIT's setting (CFG app_style), not a toggle on this
// screen: it changes what the controls do, so changing it is a request that
// someone at the machine confirms with the unit's power button, and it is
// only used after the unit has been switched off and on. The same goes for
// the radio remote type (CFG radio_src). The drive screen always shows the
// style the unit is actually using.
//
// Dashboard contract (see app.js): { id, mount(ctx), render(tlm), onData(kind,
// data), onEvent(evt), onError(err), onLink(on), onLinkStatus(link, transport),
// onCfg(key, value), onAdvanced(on), unmount() }.
// =============================================================================
import { TLM_FIELDS, DRV_FIELDS, FIELD_CATEGORIES, INPUT_NAMES, OUTPUT_NAMES, INPUT_LABELS, OUTPUT_LABELS,
         DIR_NAMES, J20_NAMES, SRC_NAMES, CTL_NAMES, LINK_NAMES, PID_NAMES, TRAILER_NAMES, STATE_TEXT, CHEM, BTN,
         faultTitle, tapsPlausible } from "../protocol/x2-v1.js";

export const id = "x2";

let ctx = null, $ = null, send = null, cfg = null, badge = null;
let last = null;                // latest TLM
let drv = null;                 // latest DRV
let iSmooth = null;
let wsScale = 50;               // Hz at the right-hand end of the wheel-speed bars (grows with the fastest seen)
const chart = { l: [], r: [], u: [], max: 300 };
const el = (name) => $("x2-" + name);
const simUi = () => ctx.isAdvanced() && ctx.srcKind() === "sim";
const chem = () => CHEM[cfg.batt_chem ?? 0] || CHEM[0];
const socClass = (p) => p < 15 ? "low" : p < 35 ? "mid" : "";
const CTRL_MODE_TEXT = ["radio remote or phone", "radio remote only", "phone only"];

export function mount(c) {
  ctx = c; $ = c.$; send = c.send; cfg = c.cfg; badge = c.badge;
  if (!mounted) { wire(); mounted = true; }
  el("fields").replaceChildren();
  // Settings usually arrive before the unit has identified itself (while the
  // default dashboard is still mounted): apply what the shell already holds.
  Object.entries(cfg).forEach(([key, value]) => onCfg(key, value));
  centre();
  closeDrive();                                   // the drive view opens only on arming
  window.__x2 = { cfg, rc, get last() { return last; }, get drv() { return drv; } };   // debugging hook (read-only use)
}
export function unmount() { stopRc(); closeDrive(); }
export function onAdvanced(on) { if (on && last) renderAdvanced(); }
export function onCfg(key, value) {
  if (key === "thr_limit" && document.activeElement !== el("thr-limit")) { el("thr-limit").value = value; el("thr-limit-v").textContent = value + " %"; }
  if (key === "pid_en") el("pid-en").checked = !!value;
  if (key === "app_arm_press") el("remote-intro").textContent = value
    ? "Drive from this phone with the same controls as the radio remote. The unit must be running and at rest; after requesting, press the unit's power button once to confirm you are at the machine."
    : "Drive from this phone with the same controls as the radio remote. The unit must be running and at rest. Bench setting: no button press is needed, the phone is armed at once.";
  if (key === "sw0_mode") el("btn-fast").hidden = value !== 1;
  if (key === "sw1_mode") el("btn-sw1").textContent = value === 1 ? "Aux" : "Horn";
  // The drive screen is laid out in the style the unit is using.
  if (key === "app_style" && ax.left) { if (!rc.armed) setStyle(value === 1 ? "tank" : "rc"); renderStyle(); }
  if (key === "radio_src" || key === "remote_arm_s") renderCfgNotice();
}

// ---------------------------------------------------------------- confirmed settings
// radio_src and app_style: CFGSET -> ACK,CFGPEND -> one press of the unit's
// power button (EVT CFG,staged) -> the unit holds at rest until it has been
// switched off and on (DRV gate bit 2).
const CONFIRM_LABEL = { app_style: "the phone control style", radio_src: "the radio remote type" };
const CONFIRM_VALUE = { app_style: ["RC car", "Tank"], radio_src: [null, "Trax handheld (RC-car style)", "Kar-Tech (tank style)"] };
let cfgPend = null;             // { key, value, until }
let cfgTimer = null;
function renderStyle() {
  const tank = (cfg.app_style ?? 0) === 1;
  el("style-now").textContent = tank ? "Tank (left + right track)" : "RC car (drive + rotation)";
  el("style-label").textContent = tank ? "Tank" : "RC car";
  el("btn-style").textContent = `Change to ${tank ? "RC car" : "tank"} style…`;
}
function renderCfgNotice() {
  const box = el("cfg-notice"); if (!box) return;
  const restart = !!(drv && drv.restartReq);
  if (cfgPend) {
    const left = Math.max(0, Math.ceil((cfgPend.until - performance.now()) / 1000));
    const to = (CONFIRM_VALUE[cfgPend.key] || [])[cfgPend.value] ?? cfgPend.value;
    box.hidden = false;
    el("cfg-notice-title").textContent = "Confirm at the unit";
    el("cfg-notice-text").textContent = `Press the power button on the unit once to change ${CONFIRM_LABEL[cfgPend.key] || cfgPend.key} to ${to}. `
      + `Nothing changes until it is pressed, and the unit must then be switched off and on. ${left} s left.`;
  } else if (restart) {
    box.hidden = false;
    el("cfg-notice-title").textContent = "Restart required";
    el("cfg-notice-text").textContent = "A control setting was changed and stored. The unit is parked with its outputs safe (power relays open) and will not drive until it has been switched off and on; the new setting is used from then on.";
  } else box.hidden = true;
  el("btn-cfg-cancel").hidden = !cfgPend;
  el("btn-cfg-sim-press").hidden = !(cfgPend && simUi());
  el("btn-cfg-sim-reset").hidden = !(restart && !cfgPend && simUi());
  if (cfgPend && !cfgTimer) cfgTimer = setInterval(() => { if (cfgPend && performance.now() > cfgPend.until + 1500) cfgPend = null; renderCfgNotice(); }, 500);
  if (!cfgPend && cfgTimer) { clearInterval(cfgTimer); cfgTimer = null; }
}
function onCfgEvent(data) {
  const [key, v] = String(data.b || "").split("="), value = Number(v);
  const what = CONFIRM_LABEL[key] || key, to = (CONFIRM_VALUE[key] || [])[value] ?? v;
  if (data.a === "pending") { cfgPend = { key, value, until: performance.now() + (cfg.remote_arm_s ?? 15) * 1000 }; remoteMsg(""); }
  else cfgPend = null;
  ctx.addEvent("CFG", { pending: `Change of ${what} to ${to} requested — press the unit's power button to confirm`,
                        staged: `Change of ${what} to ${to} confirmed and stored — switch the unit off and on to use it`,
                        timeout: `Change of ${what} was not confirmed in time — nothing changed`,
                        cancelled: `Change of ${what} cancelled — nothing changed`,
                        nvs_fail: `Change of ${what} could not be stored — nothing changed` }[data.a] || `${key}: ${data.a}`);
  if (data.a === "timeout") remoteMsg("The change was not confirmed at the unit in time. Nothing changed.");
  renderCfgNotice();
}

// ---------------------------------------------------------------- link / errors
let link = null;
// Current firmware carries no link-identity gate: any connected device may
// request control, and the arm press (power button) is the safety layer —
// the LINK line's 4th field says so (authorized true). The banner texts only
// remain for OLD firmware (4th field absent: control was gated by bonding).
const LINK_TEXT = {
  occupied: "This unit is paired to another phone (old firmware). Triple-press the unit's power button to open pairing, connect again, request control and accept the pairing prompt.",
  unpaired: "This unit's firmware gates control by Bluetooth pairing (old firmware). Triple-press the unit's power button to open pairing (60 s), then request control and accept the pairing prompt.",
  pairing:  "Pairing window open: request control now and accept the pairing prompt.",
};
function linkState() {
  if (!link || link.authorized !== null) return "ok";                    // current firmware: connection = may request
  if (link.bonded) return "ok";                                          // old firmware, bonded
  if (link.pairing) return "pairing";
  return link.hasBond ? "occupied" : "unpaired";
}
function renderLinkStatus() {
  const p = el("remote-link"); if (!p) return;
  const st = linkState();
  p.hidden = st === "ok"; p.textContent = LINK_TEXT[st] || "";
  p.className = "drive-banner";
}
export function onLinkStatus(d, transport) { link = transport === "ble" ? d : null; renderLinkStatus(); if (linkState() !== "ok") remoteMsg(""); }

const REMOTE_ERR = {
  not_authorized: "This device is not authorized to drive. Triple-press the unit's power button: the unit drops this connection and searches for its new pair — the app reconnects by itself and takes control.",
  // Older firmware (bond-based control) still answers with these two:
  not_bonded:  "This phone is not paired with the unit. Triple-press the unit's power button to open pairing (60 s). If the unit drops the connection at that moment, connect again. Then request control, accept the pairing prompt, and request once more.",
  occupied:    "This unit is paired to another phone. Triple-press the unit's power button to take over; the unit will disconnect. Connect again, request control and accept the pairing prompt.",
  not_run:     "The unit is not running yet.",
  not_at_rest: "The radio remote is commanding the unit. Let go of its controls, then request again.",
  busy:        "A request is already in progress.",
  not_armed:   "Phone control is not active.",
  restart_needed: "A control setting was changed. Switch the unit off and on before driving.",
  style:       "This app and the unit disagree about the control style. Disconnect and connect again.",
  not_stopped: "Nothing to resume.",
  radio_only:  "This unit is set to its radio remote only (setting: Who may drive).",
  disabled:    "Phone control is not enabled in this unit's firmware.",
};
function remoteMsg(text) { const m = el("remote-msg"); if (!m) return; m.hidden = !text; m.textContent = text || ""; }
export function onLink(on) {
  if (!on) {
    stopRc(); srcNow = 0; closeDrive(); remoteMsg(""); link = null; renderLinkStatus(); last = null; drv = null;
    cfgPend = null; renderCfgNotice();
    el("state").textContent = "—"; el("state-text").textContent = "Not connected"; el("state-sub").textContent = "";
    el("hero").className = "hero state-none"; el("alert").hidden = true;
  }
}
export function onError(data) {
  if (data.what === "LEARN") {
    ctx.addEvent("ERR", data.args[0] === "not_at_rest" ? "The learned trim can only be forgotten with the unit at rest." : `Learned trim: ${data.args[0]}`);
    return true;
  }
  if (data.what === "CFGSET" && CONFIRM_LABEL[data.args[1]]) {
    remoteMsg({ not_at_rest: "The unit must be at rest, with nobody driving it, to change this. Let go of the controls (or release phone control) and try again.",
                busy: "Another change is waiting for the unit's power button. Finish or cancel it first." }[data.args[0]] || `The unit refused the change: ${data.args[0]}`);
    return true;
  }
  if (data.what === "RC" && data.args[0] === "style") {
    if (rc.armed) { stopRc(); send("REMOTE,REL"); closeDrive(); }
    remoteMsg(REMOTE_ERR.style); send("CFGGET");
    return true;
  }
  if (data.what === "RC") {
    if (rc.armed) { stopRc(); if (!(last && (last.state === "FAULT" || last.estop_l))) closeDrive(); }
    remoteMsg(REMOTE_ERR[data.args[0]] || "The unit is not under phone control. Request control again.");
    return true;
  }
  if (data.what !== "REMOTE") return false;
  const why = data.args[0];
  remoteMsg(REMOTE_ERR[why] || `The unit refused: ${why}`);
  ctx.addEvent("ERR", `Phone control: ${REMOTE_ERR[why] || why}`);
  return true;
}

export function onEvent(data) {
  if (data.kind === "CFG") { onCfgEvent(data); return true; }
  if (data.kind === "REMOTE") {
    const t = { pending: "Phone control requested — press the unit's power button", armed: "Phone control active", released: "Phone control released",
                overridden: "The radio remote was used — it has taken control back", lost: "Control link interrupted", timeout: "Phone request timed out",
                stopped: "STOP latched", link_lost: "Control link lost — the unit stopped and the radio remote is back in control" }[data.a] || data.a;
    ctx.addEvent("REMOTE", t);
    if (data.a === "pending" || data.a === "armed") remoteMsg("");
    if (data.a === "armed" && !rc.armed) { srcNow = 2; startRc(); openDrive(); }   // first frame goes out now, not at the next TLM
    if (data.a === "overridden") el("remote-lost-text").textContent = "The radio remote was used, so it took control back. Request control again to continue.";
    if (data.a === "lost") el("remote-lost-text").textContent = "No commands reached the unit. It has stopped and is holding.";
    return true;
  }
  if (data.kind === "STATE") { ctx.addEvent("STATE", `${STATE_TEXT[data.a] || data.a}`); return true; }
  if (data.kind === "ASSIST") { ctx.addEvent("ASSIST", { learn_cleared: "Learned trim forgotten — the drive assist starts learning again" }[data.a] || data.a); return true; }
  if (data.kind === "LORA") {
    ctx.addEvent("RADIO", { pairing_open: "Handheld pairing window open — hold the pair button on the handheld", paired: `Handheld paired (channel ${data.b})`, pair_timeout: "Handheld pairing timed out" }[data.a] || data.a);
    return true;
  }
  if (data.kind === "START") { ctx.addEvent("START", `Controller ${data.b || ""}: ${data.a}`); return true; }
  if (data.kind === "PWR" && data.a.startsWith("pairing")) {
    // Old firmware only: its Bluetooth bonding window (current firmware
    // gates control with the arm press and never opens one).
    ctx.addEvent("PWR", data.a === "pairing_open" ? "Bluetooth pairing window open — pair your phone now (60 s)" : "Bluetooth pairing window closed");
    if (data.a === "pairing_open") remoteMsg("");
    return true;
  }
  return false;
}

// ---------------------------------------------------------------- operator view
const restartable = () => !!(last && last.state === "FAULT" && !(last.inputsValid.estop_open && last.inputs.estop_open));

export function render(d) {
  last = d;
  el("hero").className = "hero state-" + d.state;
  el("state").textContent = d.state === "FAULT" ? "STOPPED" : d.state === "RUN" ? "RUNNING" : d.state.replace("_", " ");
  el("state-text").textContent = d.state === "FAULT" ? d.faultTitle : (STATE_TEXT[d.state] || d.state);
  const sub = [];
  if (d.state === "RUN") sub.push(d.ctl ? `Driving: ${d.ctlName}` : "Nobody is driving");
  if (d.state === "RUN" && d.guard < 100) sub.push(`Power limited to ${d.guard}%`);
  if (d.src !== 0) sub.push(`Phone: ${d.srcName}`);
  if (d.state === "RUN" && d.sleep > 0 && d.sleep < 120) sub.push(`Auto-off in ${d.sleep}s`);
  el("state-sub").textContent = sub.join(" · ");

  const alert = el("alert");
  if (d.state === "FAULT") {
    alert.hidden = false;
    el("alert-title").textContent = d.faultTitle + `  (code ${d.fault})`;
    const loopOpen = d.inputsValid.estop_open && d.inputs.estop_open;
    el("alert-text").textContent = d.faultText + (loopOpen ? " The e-stop loop still reads open." : " Fix the cause, then Restart — or turn the unit off and on.");
    el("btn-restart").hidden = !restartable();
    alert.querySelector(".sim").hidden = !simUi();
  } else { alert.hidden = true; }

  // ---- control ----
  el("ctl-mode").textContent = CTRL_MODE_TEXT[cfg.ctrl_src ?? 0] || "";
  el("ctl").textContent = d.ctlName + (drv && drv.restartReq ? " (restart required)" : drv && drv.gated && d.state === "RUN" ? " (waiting for neutral)" : "");
  el("link").textContent = d.linkName + (d.link === 3 ? ` · ${d.lq}/s` : "");
  el("link").className = d.link === 4 ? "bad" : "";
  // Only the remote this unit is built for is shown (CFG radio_src): the other
  // one is not read. A Kar-Tech unit has its handheld radio switched off; the
  // link row says so (code 6) rather than hiding it.
  const ktUnit = (cfg.radio_src ?? 1) === 2;
  // An open lever input rests at 0.44 V (the board's bias network): inside the
  // valid band, so it is named here rather than left looking like a command.
  const ktMin = (cfg.kt_min_mv ?? -250) / 1000, ktMax = (cfg.kt_max_mv ?? 5500) / 1000;
  const ktNone = (v) => v < -0.9, ktOut = (v) => v < ktMin || v > ktMax, ktOpen = (v) => Math.abs(v - 0.44) < 0.05;
  el("kt").textContent = ktNone(d.kt_l) || ktNone(d.kt_r) ? "no reading"
    : ktOpen(d.kt_l) && ktOpen(d.kt_r) ? "not connected (0.44 V on both)"
    : `${d.kt_l.toFixed(2)} V · ${d.kt_r.toFixed(2)} V` + (ktOut(d.kt_l) || ktOut(d.kt_r) ? " (out of range)" : ktOpen(d.kt_l) || ktOpen(d.kt_r) ? " (open wire?)" : "");
  el("kt").className = ktUnit && (ktOut(d.kt_l) || ktOut(d.kt_r) || ktOpen(d.kt_l) || ktOpen(d.kt_r)) ? "bad" : "";
  el("kt-row").hidden = !ktUnit;
  el("link-row").hidden = ktUnit && d.link < 3;
  el("speed").textContent = d.outputs.fast ? "fast (from the remote)" : (d.inputsValid.speed_sw && d.inputs.speed_sw) ? "fast (local toggle)" : "slow";
  const cb = el("ctl-badges"); cb.replaceChildren();
  if (drv && drv.radioEstop) badge(cb, "Radio e-stop", "bad");
  if (d.outputs.lift_a || d.outputs.lift_b) badge(cb, "Lift", ""); if (d.outputs.lower_a || d.outputs.lower_b) badge(cb, "Lower", "");
  if (d.outputs.horn) badge(cb, "Horn", "");
  if (d.inputs.limit1) badge(cb, "Limit switch 1", "warn"); if (d.inputs.limit2) badge(cb, "Limit switch 2", "warn");

  // ---- battery ----
  const k = chem();
  iSmooth = iSmooth === null ? d.i_board : iSmooth + 0.25 * (d.i_board - iSmooth);
  const soc = d.soc >= 0 ? d.soc : null;
  el("batt-type").textContent = cfg.batt_ah ? ((cfg.batt_series ?? 3) === 1 ? `36 V ${cfg.batt_ah} Ah ${k.name}` : `3 × 12 V ${cfg.batt_ah} Ah ${k.name}`) : "";
  el("soc").textContent = soc === null ? "—" : soc.toFixed(0);
  const sb = el("socbar"); sb.style.width = (soc ?? 0) + "%"; sb.className = "bar-fill " + socClass(soc ?? 100);
  el("v36").textContent = d.v36.toFixed(2) + " V";
  const taps = (cfg.batt_series ?? 3) >= 2 && tapsPlausible(d.v12, d.v24, d.v36);
  [["b1", d.b1], ["b2", d.b2], ["b3", d.b3]].forEach(([n, v]) => {
    const bar = el(n + "bar");
    if (!taps) { el(n).textContent = "—"; bar.style.width = "0"; return; }
    el(n).textContent = v.toFixed(2) + " V";
    const f = Math.max(0, Math.min(1, (v - k.v[0]) / (k.v[10] - k.v[0])));
    bar.style.width = (f * 100) + "%";
    bar.style.background = f < 0.15 ? "var(--bad)" : f < 0.35 ? "var(--warn)" : "var(--ok)";
  });
  el("i-board").textContent = iSmooth < 1 ? "< 1 A" : iSmooth.toFixed(1) + " A";
  const hasTemp = d.temp > -90;
  el("temp-row").hidden = !hasTemp;
  if (hasTemp) el("temp").textContent = `${d.temp.toFixed(0)} °C`;
  const bb = el("batt-badges"); bb.replaceChildren();
  if (d.v36 / 3 >= k.chargeV) badge(bb, "Charging", "ok");
  if (d.guard < 100) badge(bb, "Power limited", "warn");
  const spread = Math.max(d.b1, d.b2, d.b3) - Math.min(d.b1, d.b2, d.b3);
  if (taps && spread >= (cfg.weak_dv_x100 ?? 40) / 100) badge(bb, `Unevenly charged (${spread.toFixed(2)} V apart)`, "warn");
  if (!taps) badge(bb, (cfg.batt_series ?? 3) >= 2 ? "Battery taps not connected" : "Single 36 V battery", "");

  // ---- machine ----
  const mask = cfg.mc_mask ?? 3;
  const mcText = (bit, j20) => !(mask & bit) ? "not fitted" : (J20_NAMES[j20] || "?");
  el("mc-a").textContent = mcText(1, d.j20a); el("mc-a").className = (mask & 1) && d.j20a === 2 && d.outputs.ksi ? "bad" : "";
  el("mc-b").textContent = mcText(2, d.j20b); el("mc-b").className = (mask & 2) && d.j20b === 2 && d.outputs.ksi ? "bad" : "";
  const brake = (n) => d.inputsValid[n] ? (d.inputs[n] ? "released" : "engaged") : "—";
  el("brakes").textContent = `A ${brake("brake_a")} · B ${brake("brake_b")}`;
  const relay = (on, cur) => on ? (cur ? "on" : "on, no coil current") : "off";
  el("relays").textContent = `A ${relay(d.outputs.relay_a, d.inputs.relay_i_a)} · B ${relay(d.outputs.relay_b, d.inputs.relay_i_b)}`;
  el("relays").className = (d.outputs.relay_a && !d.inputs.relay_i_a) || (d.outputs.relay_b && !d.inputs.relay_i_b) ? "bad" : "";
  el("estop").textContent = !d.inputsValid.estop_open ? "—" : d.inputs.estop_open ? "OPEN" : "closed";
  el("estop").className = d.inputsValid.estop_open && d.inputs.estop_open ? "bad" : "";
  el("tb").textContent = cfg.tb_enable === 0 ? "disabled" : d.outputs.tb_bus ? `${d.tb_pct} %  ·  ${d.i_tb.toFixed(1)} A` : "off";
  const tst = d.tb_st || 0;
  el("trailer-row").hidden = tst === 0;
  if (tst) { el("trailer").textContent = TRAILER_NAMES[tst] || "—"; el("trailer").className = tst === 3 ? "bad" : ""; }
  const mb = el("mach-badges"); mb.replaceChildren();
  if (d.outputs.ksi) badge(mb, "Key on", "ok"); if (d.outputs.idc) badge(mb, "Main power", "ok");
  if (d.inputs.kt_estop) badge(mb, "Kar-Tech line high", "");

  remoteUi(d.src);
  if (!el("drive").hidden) driveStats();
  if (ctx.isAdvanced()) renderAdvanced();
  if (!el("drive").hidden) driveBlock();
}

// Centre-zero bar: v in -100..100 (full = half the bar).
function bibar(node, v, full = 100) {
  const w = Math.min(50, Math.abs(v) / full * 50);
  node.style.width = w + "%";
  node.style.left = (v >= 0 ? 50 : 50 - w) + "%";
  node.classList.toggle("rev", v < 0);
}
const trackText = (v, dir) => dir === 0 && Math.abs(v) < 0.5 ? "stopped" : `${v < 0 ? "◀ rev" : "fwd ▶"} ${Math.abs(v).toFixed(0)} %`;
const speedText = (mm, hz) => `${(mm / 1000).toFixed(2)} m/s`;

export function onData(kind, d) {
  if (kind !== "drv") return;
  const hadRestart = !!(drv && drv.restartReq);
  drv = d;
  if (d.restartReq !== hadRestart || cfgPend) renderCfgNotice();
  bibar(el("out-l"), d.out_l); el("out-l-v").textContent = trackText(d.out_l, d.dir_l);
  bibar(el("out-r"), d.out_r); el("out-r-v").textContent = trackText(d.out_r, d.dir_r);

  const top = Math.max(d.ws_l, d.ws_r);
  if (top > wsScale) wsScale = top * 1.15;
  el("ws-l").style.width = Math.min(100, d.ws_l / wsScale * 100) + "%";
  el("ws-r").style.width = Math.min(100, d.ws_r / wsScale * 100) + "%";
  el("ws-l-v").textContent = speedText(d.spd_l, d.ws_l);
  el("ws-r-v").textContent = speedText(d.spd_r, d.ws_r);
  el("ws-note").textContent = `${d.ws_l.toFixed(0)} Hz · ${d.ws_r.toFixed(0)} Hz`;
  const avg = (d.ws_l + d.ws_r) / 2;
  el("ws-diff").textContent = avg < 2 ? "—" : `${((d.ws_l - d.ws_r) / avg * 100).toFixed(1)} %  (${d.ws_l >= d.ws_r ? "left" : "right"} faster)`;
  el("pid").textContent = (cfg.pid_en === 0 ? "off (setting)" : PID_NAMES[d.pid] || "?");
  el("pid").className = d.pid === 3 ? "bad" : "";
  bibar(el("pid-u"), -d.pid_u, 20);          // + correction slows the left track: draw the trim toward the right
  el("pid-u-v").textContent = Math.abs(d.pid_u) < 0.05 ? "none" : `${d.pid_u > 0 ? "left −" : "right −"}${Math.abs(d.pid_u).toFixed(1)} %`;
  // The learned trim: the part of the correction kept between runs (+ = the left track runs fast and is slowed).
  const learnText = (v) => Math.abs(v) < 0.05 ? "none" : `${v > 0 ? "left" : "right"} −${Math.abs(v).toFixed(1)} %`;
  const learnOff = cfg.pid_en === 0 || cfg.pid_learn === 0;
  el("learn").textContent = `fwd ${learnText(d.learn_f)} · rev ${learnText(d.learn_r)}` + (d.learn ? "  (learning)" : learnOff ? "  (learning off)" : "");
  el("learn-detail").textContent = `forward ${d.learn_f.toFixed(2)} % · reverse ${d.learn_r.toFixed(2)} %  (+ = left track slowed)`;
  const wb = el("ws-badges"); wb.replaceChildren();
  const learnMax = (cfg.pid_learn_max ?? 10) - 0.05;
  if (learnMax > 0 && (Math.abs(d.learn_f) >= learnMax || Math.abs(d.learn_r) >= learnMax)) badge(wb, "Learned trim at its limit: check the slow track", "warn");
  if (d.pid === 3) badge(wb, "A wheel sensor is not reading", "bad");
  if (d.pid === 1 && Math.abs(d.pid_u) >= (cfg.pid_max_pct ?? 15) - 0.05) badge(wb, "Assist at its limit", "warn");

  if (!el("drive").hidden) driveStats();
  if (ctx.isAdvanced()) {
    chart.l.push(d.ws_l); chart.r.push(d.ws_r); chart.u.push(d.pid_u);
    for (const key of ["l", "r", "u"]) if (chart[key].length > chart.max) chart[key].shift();
    drawChart();
  }
}

// ---------------------------------------------------------------- advanced view
function renderAdvanced() {
  const d = last; if (!d) return;
  const inp = el("inputs"); inp.replaceChildren();
  INPUT_NAMES.forEach((n) => { const c = document.createElement("span"); c.className = "chip" + (d.inputs[n] ? " on" : "") + (d.inputsValid[n] ? "" : " inv"); c.textContent = INPUT_LABELS[n]; c.title = d.inputsValid[n] ? "" : "not readable right now"; inp.appendChild(c); });
  const out = el("outputs"); out.replaceChildren();
  OUTPUT_NAMES.forEach((n) => { const c = document.createElement("span"); c.className = "chip" + (d.outputs[n] ? " on" : ""); c.textContent = OUTPUT_LABELS[n]; out.appendChild(c); });
  const bt = el("btns"); bt.replaceChildren();
  [["SW0", BTN.sw0], ["SW1", BTN.sw1], ["Lift 2 (BTN0)", BTN.btn0], ["Lower 2 (BTN1)", BTN.btn1], ["Lift 1 (BTN2)", BTN.btn2], ["Lower 1 (BTN3)", BTN.btn3]]
    .forEach(([t, bit]) => { const c = document.createElement("span"); c.className = "chip" + (drv && (drv.btns & bit) ? " on" : ""); c.textContent = t; bt.appendChild(c); });

  const box = el("fields");
  const all = [...TLM_FIELDS.map((f) => ["t", ...f]), ...DRV_FIELDS.map((f) => ["d", ...f])];
  if (!box.children.length) {
    FIELD_CATEGORIES.forEach((cat) => {
      const rows = all.filter((f) => f[5] === cat && !["in", "valid", "out"].includes(f[1]));
      if (!rows.length) return;
      const h = document.createElement("div"); h.className = "cat-h"; h.textContent = cat; box.appendChild(h);
      const t = document.createElement("table"); const tb = document.createElement("tbody"); t.appendChild(tb);
      rows.forEach(([src, key, , label, unit]) => { const tr = document.createElement("tr"); tr.innerHTML = `<td>${label}</td><td class="v" data-k="${src}:${key}"></td><td class="muted">${unit}</td>`; tb.appendChild(tr); });
      const w = document.createElement("div"); w.className = "tablewrap"; w.appendChild(t); box.appendChild(w);
    });
  }
  const fmt = {
    "t:fault": (v) => v ? `${v} — ${faultTitle(v)}` : "none", "t:src": (v) => SRC_NAMES[v] || v, "t:ctl": (v) => CTL_NAMES[v] || v,
    "t:link": (v) => LINK_NAMES[v] || v, "t:j20a": (v) => J20_NAMES[v] || v, "t:j20b": (v) => J20_NAMES[v] || v,
    "t:temp": (v) => v <= -99 ? "no sensor" : v.toFixed(1), "t:soc": (v) => v < 0 ? "unknown" : v.toFixed(1), "t:estop_l": (v) => v ? "yes" : "no",
    "t:up": (v) => `${Math.floor(v / 60)} min ${v % 60} s`, "t:sleep": (v) => v ? `${Math.floor(v / 60)} min ${v % 60} s` : "disabled",
    "t:tb_st": (v) => TRAILER_NAMES[v] || v, "t:kt_l": (v) => v < -0.9 ? "no reading" : v.toFixed(2), "t:kt_r": (v) => v < -0.9 ? "no reading" : v.toFixed(2),
    "d:cmd_mode": (v) => v ? "tank (left track / right track)" : "RC car (drive / rotation)", "d:btns": (v) => "0x" + v.toString(16),
    "d:learn": (v) => v ? "adjusting" : "idle", "d:gate": (v) => v & 4 ? "restart required" : v & 2 ? "radio e-stop" : v & 1 ? "waiting for neutral" : "open",
    "d:dir_l": (v) => DIR_NAMES[v] || v, "d:dir_r": (v) => DIR_NAMES[v] || v, "d:pid": (v) => PID_NAMES[v] || v, "d:pid_e": (v) => v.toFixed(3),
  };
  all.forEach(([src, key]) => {
    const cell = box.querySelector(`[data-k="${src}:${key}"]`); if (!cell) return;
    const obj = src === "t" ? d : drv; if (!obj) return;
    const v = obj[key], f = fmt[`${src}:${key}`];
    cell.textContent = f ? f(v) : (typeof v === "number" && !Number.isInteger(v) ? v.toFixed(2) : v);
  });
}

function drawChart() {
  const c = el("chart"); const dpr = window.devicePixelRatio || 1;
  const W = c.clientWidth, H = 160;
  if (!W) return;
  if (c.width !== W * dpr) { c.width = W * dpr; c.height = H * dpr; }
  const g = c.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
  const css = getComputedStyle(document.documentElement);
  g.strokeStyle = css.getPropertyValue("--line"); g.lineWidth = 1;
  for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(0, H * i / 4); g.lineTo(W, H * i / 4); g.stroke(); }
  const hi = Math.max(50, ...chart.l, ...chart.r) * 1.1;
  for (const [key, lo, top, col] of [["l", 0, hi, "--ok"], ["r", 0, hi, "--accent"], ["u", -20, 20, "--info"]]) {
    const a = chart[key]; if (a.length < 2) continue;
    g.strokeStyle = css.getPropertyValue(col); g.lineWidth = 1.5; g.beginPath();
    a.forEach((v, i) => { const x = i / (chart.max - 1) * W, y = H - (Math.min(top, Math.max(lo, v)) - lo) / (top - lo) * H; i ? g.lineTo(x, y) : g.moveTo(x, y); });
    g.stroke();
  }
  g.fillStyle = css.getPropertyValue("--muted"); g.font = "11px system-ui";
  g.fillText(`Hz: 0–${hi.toFixed(0)}   trim: ±20 %`, 6, 12);
}

// ---------------------------------------------------------------- phone control
// style "rc": a = drive (left stick, + forward), b = rotation (right stick, + right).
// style "tank": a = left track, b = right track. Both -100..100; pot 0..100; btns = BTN bits.
const rc = { armed: false, style: "rc", a: 0, b: 0, pot: 100, btns: 0, seq: 0, timer: null, tLast: 0 };
// A frame this late means the browser was busy (a call screen, a notification
// shade, a system dialog) longer than the unit's deadman (rc_lost_ms, 250 ms by
// default): the unit is LOST and ignores frames until Resume. Whatever the
// thumbs were doing then is not a command any more.
const RC_STALL_MS = 500;
let srcNow = 0;
function remoteUi(srcCode) {
  srcNow = srcCode;
  el("remote-state").textContent = SRC_NAMES[srcCode] || "radio remote";
  el("remote-idle").hidden = srcCode !== 0;
  el("remote-pending").hidden = srcCode !== 1;
  el("remote-armed").hidden = srcCode !== 2;
  el("remote-lost").hidden = srcCode !== 3;
  el("remote-stopped").hidden = srcCode !== 4;
  el("remote-pending").querySelector(".sim").hidden = !simUi();
  el("btn-style").hidden = srcCode !== 0;
  el("btn-dv-restart").hidden = !restartable();
  const armed = srcCode === 2 || srcCode === 4;          // 4 = stopped: keep-alive frames only
  if (armed && !rc.armed) { startRc(); openDrive(); }
  else if (!armed && rc.armed) stopRc();
  if (srcCode === 0 && !el("drive").hidden && !(last && last.state === "FAULT")) closeDrive();   // a fault keeps the FAULT block up
  driveBanner(srcCode);
  driveBlock();
}
// Full-screen block over the drive view. A latched STOP clears in two taps
// (misclick protection); a fault needs its cause fixed and a Restart.
let clearArmed = false;
function driveBlock() {
  const b = el("dv-block"), fault = last && last.state === "FAULT";
  const stopped = srcNow === 4;
  if (!fault && !stopped) { b.hidden = true; clearArmed = false; return; }
  b.hidden = false;
  b.className = "drive-block" + (fault ? "" : " warn");
  const estop = fault && last.fault === 1;
  el("dv-block-title").textContent = fault ? (estop ? "E-STOP" : "FAULT") : "STOPPED";
  el("dv-block-text").textContent = fault
    ? (estop ? "The emergency stop loop is open. Release the e-stop at the unit, then Restart."
             : (last.faultTitle || "The unit has shut down") + ". Fix the cause, then Restart, or power-cycle the unit.")
    : (clearArmed ? "Make sure the area around the unit is clear, then confirm." : "STOP is latched. The unit is holding.");
  el("btn-dv-clear").hidden = fault || clearArmed;
  el("btn-dv-confirm").hidden = fault || !clearArmed;
  el("btn-dv-clear-cancel").hidden = fault || !clearArmed;
  el("btn-dv-block-release").hidden = fault;
  el("btn-dv-block-close").hidden = !fault;
}
function startRc() { rc.armed = true; rc.tLast = 0; centre(); rc.timer = setInterval(sendRc, 100); }
function stopRc() { rc.armed = false; clearInterval(rc.timer); rc.timer = null; if ($) centre(); }
function sendRc() {
  if (!rc.armed) return;
  const now = performance.now();
  if (rc.tLast && now - rc.tLast > RC_STALL_MS) letGo();   // see RC_STALL_MS: re-touch every control
  rc.tLast = now;
  ctx.sendRaw(`RC,${rc.seq++ & 0xffff},${rc.style === "tank" ? 1 : 0},${rc.a},${rc.b},${rc.pot},${rc.btns}`);
}
// Drop every control to neutral and end its touch, so a thumb that is still
// on the screen has to lift and press again before it commands anything.
function letGo() {
  for (const A of [ax.left, ax.rot, ax.right]) if (A) A.node.classList.remove("active");
  document.querySelectorAll("#drive .active").forEach((n) => n.classList.remove("active"));
  centre();
}

// ---- full-screen drive mode ----
function openDrive() { el("drive").hidden = false; document.body.classList.add("driving"); driveStats(); }
function closeDrive() { if (!$) return; el("drive").hidden = true; document.body.classList.remove("driving"); }
function driveBanner(srcCode) {
  const b = el("dv-banner");
  el("btn-dv-resume").hidden = srcCode !== 3;
  if (srcCode === 3) { b.hidden = false; b.className = "drive-banner"; b.textContent = "Control link interrupted — the unit has stopped. Resume, or release control."; }
  else if (srcCode === 0 && !el("drive").hidden) { b.hidden = false; b.className = "drive-banner bad"; b.textContent = "Control returned to the radio remote."; }
  else if (drv && drv.gated && srcCode === 2) { b.hidden = false; b.className = "drive-banner"; b.textContent = "Let go of the controls: the unit waits for neutral before it accepts a command."; }
  else if (drv && drv.radioEstop) { b.hidden = false; b.className = "drive-banner bad"; b.textContent = "E-stop pressed on the radio remote. The unit is holding."; }
  else b.hidden = true;
}
function driveStats() {
  if (last) {
    el("dv-soc").textContent = last.soc >= 0 ? last.soc.toFixed(0) + " %" : "—";
    el("dv-link").textContent = srcNow === 2 ? "armed" : srcNow === 3 ? "LOST" : srcNow === 4 ? "STOPPED" : "radio";
  }
  if (drv) { el("dv-wl").textContent = (drv.spd_l / 1000).toFixed(2) + " m/s"; el("dv-wr").textContent = (drv.spd_r / 1000).toFixed(2) + " m/s"; }
}

// ---- the drive controls: three spring-return axes ----
//   ax.left   vertical    RC car: drive (+ forward)   tank: left track
//   ax.rot    horizontal  RC car: rotation (+ right)  (hidden in tank style)
//   ax.right  vertical    tank: right track           (hidden in RC car style)
const clamp100 = (v) => Math.round(Math.max(-100, Math.min(100, v)));
const ax = {};
const TRAVEL = 0.42;            // fraction of the control's size from centre to full
function makeAxis(node, horizontal) {
  const A = { node, horizontal, v: 0, knob: node.querySelector(".vstick-knob"), fill: node.querySelector(".vstick-fill"),
              label: node.querySelector(".vstick-knob span"), caption: node.querySelector(".vstick-knob small") };
  A.set = (v) => {
    A.v = clamp100(v);
    const pct = A.v / 100, len = Math.abs(pct) * TRAVEL * 100;
    if (horizontal) {
      const x = 50 + pct * TRAVEL * 100;
      A.knob.style.left = x + "%";
      A.fill.style.left = (pct < 0 ? x : 50) + "%"; A.fill.style.width = len + "%";
    } else {
      const y = 50 - pct * TRAVEL * 100;
      A.knob.style.top = y + "%";
      A.fill.style.top = (pct > 0 ? y : 50) + "%"; A.fill.style.height = len + "%";
    }
    node.setAttribute("aria-valuenow", A.v);
    A.label.textContent = A.v;
    syncRc();
  };
  A.fromEvent = (e) => {
    const r = node.getBoundingClientRect();
    const f = horizontal ? (e.clientX - r.left) / r.width - 0.5 : 0.5 - (e.clientY - r.top) / r.height;
    return Math.max(-1, Math.min(1, f / TRAVEL)) * 100;
  };
  node.addEventListener("pointerdown", (e) => { if (!driving()) return; node.setPointerCapture(e.pointerId); node.classList.add("active"); A.set(A.fromEvent(e)); e.preventDefault(); });
  node.addEventListener("pointermove", (e) => { if (node.classList.contains("active")) { A.set(A.fromEvent(e)); e.preventDefault(); } });
  const release = () => { if (!node.classList.contains("active")) return; node.classList.remove("active"); A.set(0); sendRc(); };
  node.addEventListener("pointerup", release); node.addEventListener("pointercancel", release); node.addEventListener("lostpointercapture", release);
  return A;
}
// What goes on the wire, from the controls of the current style.
function syncRc() {
  if (!ax.left) return;
  rc.a = ax.left.v;
  rc.b = rc.style === "tank" ? ax.right.v : ax.rot.v;
}
function centre() {
  if (!ax.left) return;
  ax.left.set(0); ax.rot.set(0); ax.right.set(0);
  rc.btns &= BTN.sw0; renderToggles();
}
function renderToggles() {
  el("btn-fast").setAttribute("aria-pressed", !!(rc.btns & BTN.sw0));
  el("btn-fast").classList.toggle("ghost", !(rc.btns & BTN.sw0));
}
// Lay the drive screen out for the unit's control style (CFG app_style).
function setStyle(name) {
  rc.style = name === "tank" ? "tank" : "rc";
  centre();                                     // never carry a held command across a style change
  const tank = rc.style === "tank";
  el("rot").hidden = tank; el("lev-r").hidden = !tank;
  ax.left.caption.textContent = tank ? "LEFT" : "DRIVE";
  ax.left.node.setAttribute("aria-label", tank ? "Left track lever. Drag and hold." : "Left stick: forward and reverse. Drag and hold.");
}
const driving = () => rc.armed && srcNow === 2;

let mounted = false;
function wire() {
  ax.left = makeAxis(el("lev-l"), false);
  ax.rot = makeAxis(el("rot"), true);
  ax.right = makeAxis(el("lev-r"), false);

  // iOS: block the page's own touch handling while the overlay is up (rubber-band, pull-to-refresh).
  el("drive").addEventListener("touchmove", (e) => { if (e.target.id !== "x2-pot") e.preventDefault(); }, { passive: false });

  document.querySelectorAll(".btn.x2-hold").forEach((b) => {
    const bit = BTN[b.dataset.btn];
    const down = (e) => { if (!driving()) return; b.setPointerCapture(e.pointerId); b.classList.add("active"); rc.btns |= bit; sendRc(); e.preventDefault(); };
    const up = () => { b.classList.remove("active"); rc.btns &= ~bit; sendRc(); };
    b.addEventListener("pointerdown", down); b.addEventListener("pointerup", up); b.addEventListener("pointercancel", up); b.addEventListener("lostpointercapture", up);
  });
  el("btn-fast").onclick = () => { rc.btns ^= BTN.sw0; renderToggles(); sendRc(); };
  el("pot").oninput = (e) => { rc.pot = Number(e.target.value); el("pot-v").textContent = rc.pot + " %"; };
  setStyle((cfg && cfg.app_style) === 1 ? "tank" : "rc");
  renderStyle();
  // Changing the style is a request to the unit: confirmed there with its
  // power button, used after a restart (see "confirmed settings" above).
  el("btn-style").onclick = () => {
    remoteMsg("");
    if (!last) { remoteMsg("Not connected to a unit."); return; }
    const to = (cfg.app_style ?? 0) === 1 ? 0 : 1;
    if (!confirm(`Change the phone control style to ${to ? "TANK (left lever = left track, right lever = right track)" : "RC CAR (left stick = forward / reverse, right stick = rotation)"}?\n\n`
      + "This changes what the controls do. You will be asked to press the power button on the unit to confirm, and the unit must then be switched off and on.")) return;
    send(`CFGSET,app_style,${to}`);
  };
  el("btn-cfg-cancel").onclick = () => send("CFGCANCEL");

  // Laptop bench driving while the drive screen is open; space = STOP.
  //   RC car: W / S drive, A / D rotate (the arrow keys do both as well)
  //   Tank:   W / S left track, up / down arrows right track
  const keys = new Set();
  const applyKeys = () => {
    if (!driving() || ax.left.node.classList.contains("active") || ax.rot.node.classList.contains("active") || ax.right.node.classList.contains("active")) return;
    const pair = (pos, neg) => (keys.has(pos) ? 60 : 0) - (keys.has(neg) ? 60 : 0);
    if (rc.style === "tank") {
      ax.left.set(pair("w", "s")); ax.right.set(pair("ArrowUp", "ArrowDown"));
    } else {
      ax.left.set(Math.max(-60, Math.min(60, pair("w", "s") + pair("ArrowUp", "ArrowDown"))));
      ax.rot.set(Math.max(-60, Math.min(60, pair("d", "a") + pair("ArrowRight", "ArrowLeft"))));
    }
  };
  document.addEventListener("keydown", (e) => {
    if (el("drive").hidden || e.target.tagName === "INPUT") return;
    if (e.key === " ") { el("btn-dv-stop").click(); e.preventDefault(); return; }
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "w", "a", "s", "d"].includes(k)) { keys.add(k); applyKeys(); e.preventDefault(); }
  });
  document.addEventListener("keyup", (e) => { const k = e.key.length === 1 ? e.key.toLowerCase() : e.key; if (keys.delete(k)) applyKeys(); });
  window.addEventListener("blur", () => { if (keys.size) { keys.clear(); applyKeys(); } });

  const restart = () => { if (confirm("Restart the unit's start-up sequence? Make sure the cause of the fault is fixed and the area is clear.")) send("RESTART"); };
  el("btn-restart").onclick = restart;
  el("btn-dv-restart").onclick = () => { restart(); closeDrive(); };
  el("btn-remote-req").onclick = () => {
    remoteMsg("");
    if (!last) { remoteMsg("Not connected to a unit."); return; }
    const ls = linkState();
    if (ls === "occupied" || ls === "unpaired") { remoteMsg(LINK_TEXT[ls]); return; }   // old firmware already said no: explain, do not fail
    if (last.state !== "RUN") {
      remoteMsg(last.state === "FAULT" ? `The unit is stopped on a fault (${last.faultTitle || "fault"}). Restart it first.`
              : `The unit is not running (${STATE_TEXT[last.state] || last.state}).`);
      return;
    }
    send("REMOTE,REQ");
  };
  el("btn-remote-cancel").onclick = () => send("REMOTE,REL");
  el("btn-remote-rel").onclick = () => send("REMOTE,REL");
  el("btn-remote-rel2").onclick = () => send("REMOTE,REL");
  el("btn-remote-rel3").onclick = () => send("REMOTE,REL");
  el("btn-remote-resume").onclick = () => send("REMOTE,RESUME");
  el("btn-drive-open").onclick = openDrive;
  el("btn-remote-open2").onclick = openDrive;
  el("btn-dv-stop").onclick = () => { centre(); send("REMOTE,STOP"); };
  el("btn-dv-resume").onclick = () => send("REMOTE,RESUME");
  el("btn-dv-clear").onclick = () => { clearArmed = true; driveBlock(); };
  el("btn-dv-clear-cancel").onclick = () => { clearArmed = false; driveBlock(); };
  el("btn-dv-confirm").onclick = () => { clearArmed = false; send("REMOTE,RESUME"); };
  el("btn-dv-block-release").onclick = () => { send("REMOTE,REL"); closeDrive(); };
  el("btn-dv-block-close").onclick = closeDrive;
  el("btn-dv-release").onclick = () => { send("REMOTE,REL"); closeDrive(); };
  // Anything that takes the operator's eyes or thumbs off the controls ends
  // the session: a phone call or a tapped notification (the page goes hidden),
  // the phone locked or the app switched (timers stop, so frames would stop),
  // the tab closed or frozen, the window losing focus. Release cleanly rather
  // than time out into a link loss; the unit's own deadman (rc_lost_ms, then
  // fault 17 if it was moving) covers the cases where this message never
  // leaves the phone. Coming back means requesting control again.
  const interrupted = (why) => {
    if (!(srcNow === 2 || srcNow === 3 || srcNow === 4) || !rc.armed) return;
    letGo(); stopRc(); send("REMOTE,REL"); closeDrive();
    remoteMsg(`Control released: ${why}. Request it again when ready.`);
  };
  document.addEventListener("visibilitychange", () => { if (document.hidden) interrupted("the app went to the background"); });
  window.addEventListener("pagehide", () => interrupted("the page was closed"));
  document.addEventListener("freeze", () => interrupted("the page was frozen"));
  window.addEventListener("blur", () => interrupted("the app lost focus"));
  el("thr-limit").oninput = (e) => { el("thr-limit-v").textContent = e.target.value + " %"; };
  el("thr-limit").onchange = (e) => send(`CFGSET,thr_limit,${e.target.value}`);
  el("pid-en").onchange = (e) => send(`CFGSET,pid_en,${e.target.checked ? 1 : 0}`);
  el("btn-learn-clr").onclick = () => {
    if (confirm("Forget the trim the drive assist has learned? Do this after a motor, gearbox or tyre change. The unit must be at rest; it starts learning again from zero.")) send("LEARN,CLR");
  };
}
