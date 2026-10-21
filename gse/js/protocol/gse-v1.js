// =============================================================================
// protocol/gse-v1.js — GSE tiller handle, protocol v1. GSE tiller-handle wire protocol, browser side.
// Bound to docs/PROTOCOL.md (source of truth). TLM_FIELDS is the exact TLM
// field order for TLM_VERSION; the firmware emitter (telemetry.cpp) and
// clients/python/protocol.py carry the same list. Change all three together.
// =============================================================================

export const TLM_VERSION = 1;
export const EVT_VERSION = 1;

// [key, type, label, unit, category] — order == wire order after "TLM,<ver>,<seq>,"
export const TLM_FIELDS = [
  ["state",   "str", "State",                   "",   "Vehicle"],
  ["fault",   "int", "Fault code",              "",   "Vehicle"],
  ["src",     "int", "Control source",          "",   "Vehicle"],
  ["v36",     "f",   "Pack voltage",            "V",  "Battery"],
  ["v24",     "f",   "24 V tap",                "V",  "Battery"],
  ["v12",     "f",   "12 V tap",                "V",  "Battery"],
  ["v_mc",    "f",   "Controller bus",          "V",  "Motor controller"],
  ["v_j20",   "f",   "Controller ready line",   "V",  "Motor controller"],
  ["j20",     "int", "Controller ready",        "",   "Motor controller"],
  ["i_board", "f",   "Board current",           "A",  "Battery"],
  ["i_tb",    "f",   "Trailer brake current",   "A",  "Trailer"],
  ["thr_in",  "f",   "Tiller throttle",         "V",  "Tiller"],
  ["thr_out", "f",   "Throttle to controller",  "%",  "Motor controller"],
  ["dir_in",  "int", "Tiller direction",        "",   "Tiller"],
  ["dir_out", "int", "Direction to controller", "",   "Motor controller"],
  ["in",      "hex", "Input bits",              "",   "Tiller"],
  ["valid",   "hex", "Input bits valid",        "",   "Tiller"],
  ["out",     "hex", "Output bits",             "",   "Outputs"],
  ["tb_pct",  "int", "Trailer brake",           "%",  "Trailer"],
  ["soc",     "f",   "State of charge",         "%",  "Battery"],
  ["guard",   "int", "Power ceiling",           "%",  "Vehicle"],
  ["ilk",     "hex", "Interlocks",              "",   "Vehicle"],
  ["temp",    "f",   "Temperature",             "°C", "Battery"],
  ["up",      "int", "Uptime",                  "s",  "Vehicle"],
  ["sleep",   "int", "Auto-off in",             "s",  "Vehicle"],
  ["estop_l", "int", "E-stop latched",          "",   "Vehicle"],
];
export const FIELD_CATEGORIES = ["Vehicle", "Battery", "Tiller", "Motor controller", "Trailer", "Outputs"];

export const INPUT_NAMES  = ["wake", "temp_alert", "brake_pd", "reverse", "forward", "speed",
                             "estop", "horn", "lower", "lift"];
export const OUTPUT_NAMES = ["shifter", "ksi", "idc", "tb_bus", "way7", "estop_sig", "speed",
                             "lift", "lower", "horn", "aux12", "auxbatt"];
export const INPUT_LABELS = { wake: "Power button", temp_alert: "Temperature alert", brake_pd: "Motor brake released",
  reverse: "Reverse", forward: "Forward", speed: "Slow", estop: "E-stop", horn: "Horn", lower: "Lower", lift: "Lift" };
export const OUTPUT_LABELS = { shifter: "Level shifter", ksi: "Key switch (KSI)", idc: "Main power",
  tb_bus: "Trailer brake supply", way7: "7-way 12 V", estop_sig: "E-stop to controller", speed: "Slow to controller",
  lift: "Lift", lower: "Lower", horn: "Horn", aux12: "12 V aux", auxbatt: "Battery meter" };
export const J20_NAMES = ["unpowered", "ready", "not ready", "indeterminate"];
export const DIR_NAMES = ["idle", "forward", "reverse", "both"];
export const SRC_NAMES = ["local", "remote pending", "remote armed", "remote lost", "remote stopped"];

// code -> [wire name, plain-English title, description, isWarning]  (PROTOCOL.md fault table)
export const FAULTS = {
  0:  ["NONE", "No fault", "No fault.", false],
  1:  ["ESTOP_PRESSED", "Emergency stop", "The emergency stop was pressed. Power cycle to clear.", false],
  2:  ["CURTIS_J20_FAULT", "Motor controller fault", "The motor controller reported a fault while running.", false],
  3:  ["J20_TIMEOUT_AT_START", "Motor controller not ready", "The motor controller did not come ready at start-up.", false],
  4:  ["RAMP_TIMEOUT_AT_START", "Motor controller not powering up", "No pre-charge seen after key-on. Check the controller connection.", false],
  5:  ["THROTTLE_NONZERO_AT_BOOT", "Throttle not at rest", "The throttle was not at rest when the tiller powered up.", false],
  6:  ["DIR_NONZERO_AT_BOOT", "Direction selected at start", "A direction was selected when the tiller powered up.", false],
  7:  ["THROTTLE_STALE", "Throttle signal lost", "The throttle signal stopped updating while running.", false],
  8:  ["DIR_BOTH", "Both directions selected", "Forward and reverse were selected together; the unit holds with no direction until one is released.", false],
  9:  ["UNDERVOLT_PACK", "Low battery", "The battery is too low to run. Charge it.", false],
  10: ["TB_STUCK_ON", "Trailer brake stuck on", "Trailer-brake current with the brake commanded off.", false],
  11: ["I2C_LOST", "Internal I/O fault", "The internal I/O expander stopped responding.", false],
  12: ["RTC_WDT_RESET", "Controller reset (watchdog)", "The hardware watchdog reset the controller while running.", false],
  13: ["BROWNOUT_RESET", "Controller reset (supply dip)", "The supply dipped below the controller's brown-out level while running.", false],
  14: ["EXT_RESET_WHILE_LIVE", "Controller reset while running", "The controller was reset (reset pin or host) while the motor controller was live.", false],
  15: ["OVERTEMP", "Over-temperature", "Over-temperature sustained.", false],
  16: ["EXPANDER_ABSENT", "Internal I/O missing", "The internal I/O expander was not found at boot.", false],
  17: ["REMOTE_LINK_LOST", "Remote control link lost", "Bluetooth control did not disconnect properly.", false],
  18: ["THROTTLE_OUT_OF_RANGE", "Throttle out of range", "The throttle signal is out of range (wiring).", false],
  19: ["PANIC_RESET", "Firmware crashed", "The firmware crashed while running.", false],
  20: ["TASK_WDT_RESET", "Firmware hung", "A firmware task hung while running.", false],
  21: ["INT_WDT_RESET", "Firmware interrupt stall", "Interrupts were blocked too long while running.", false],
  22: ["SW_RESET_WHILE_LIVE", "Firmware restarted while running", "The firmware restarted itself while the motor controller was live.", false],
  32: ["UNDERVOLT_TRANSIENT", "Battery dipped under load", "The battery voltage dipped under load.", true],
  33: ["UNEVEN_BATTERY1", "Battery 1 unevenly charged", "Battery 1 rests lower than the others: charge each battery individually.", true],
  34: ["UNEVEN_BATTERY2", "Battery 2 unevenly charged", "Battery 2 rests lower than the others: charge each battery individually.", true],
  35: ["UNEVEN_BATTERY3", "Battery 3 unevenly charged", "Battery 3 rests lower than the others: charge each battery individually.", true],
  36: ["TB_OPEN_COIL", "Trailer brake not connected", "No trailer-brake current: trailer not connected or the coil is open.", true],
  37: ["OVERTEMP_WARNING", "Running hot", "Temperature is high: power is limited.", true],
  38: ["REMOTE_OVERRIDDEN", "Remote control interrupted", "A local input was detected, so the control channel has been interrupted.", true],
  39: ["POWER_LOSS_WHILE_LIVE", "Power lost while running", "Power was lost while running; the previous run never shut down.", true],
  40: ["WEAK_BATTERY1", "Weak battery 1", "Battery 1 collapses under load far more than the others: weak or failing, replace it.", true],
  41: ["WEAK_BATTERY2", "Weak battery 2", "Battery 2 collapses under load far more than the others: weak or failing, replace it.", true],
  42: ["WEAK_BATTERY3", "Weak battery 3", "Battery 3 collapses under load far more than the others: weak or failing, replace it.", true],
  43: ["REMOTE_LINK_IDLE", "Remote control ended", "The phone link dropped while the unit was at rest. The tiller is back in control; request control again when ready.", true],
};

// key -> {label, cat, unit, kind, help, enum?|values?}   kind: int | bool | enum | enumv | x10 | x100 | mv
export const SETTINGS = {
  sleep_min:    { label: "Auto-off after idle", cat: "Power", unit: "min", kind: "int", help: "Turn the unit off after this long with no tiller activity. 0 = never. A connected phone keeps it awake." },
  shut_dly:     { label: "Shutdown delay", cat: "Power", unit: "ms", kind: "int", help: "Time between the outputs going safe and the power latch releasing." },
  tb_enable:    { label: "Trailer brake supply", cat: "Trailer", unit: "", kind: "bool", help: "Allow the trailer-brake converter to be powered at all." },
  way7_mode:    { label: "7-way 12 V output", cat: "Trailer", unit: "", kind: "enum", help: "Off, follows the trailer-brake supply, or always on.", enum: ["Off", "Follows trailer brake", "Always on"] },
  tb_full_ms:   { label: "Trailer brake full-apply time", cat: "Trailer", unit: "ms", kind: "int", help: "How long the trailer brake holds at the full-apply duty when the motor brake engages, before dropping to the hold duty." },
  tb_full_pct:  { label: "Trailer brake full-apply duty", cat: "Trailer", unit: "%", kind: "int", help: "Duty applied for the full-apply time." },
  tb_hold_pct:  { label: "Trailer brake hold duty", cat: "Trailer", unit: "%", kind: "int", help: "Duty held after the full-apply time while the motor brake stays engaged." },
  mc_decel_ms:  { label: "Motor controller decel ramp", cat: "Trailer", unit: "ms", kind: "int", help: "The Curtis decel setting: time for its speed command to fall from 100 % to 0 (1000 on the GSE8000 program). The trailer brake ramps up in step with it when the throttle is released to zero; a partial release never brakes." },
  thr_limit:    { label: "Speed limit", cat: "Drive", unit: "%", kind: "int", help: "The full tiller throttle range maps to 0 to this percentage of the motor controller's input. Stored on the unit." },
  lift_ilk:     { label: "Lift/lower interlock", cat: "Drive", unit: "", kind: "bool", help: "Lift and lower pressed together drive neither." },
  horn_beep:    { label: "Direction beep", cat: "Indicators", unit: "", kind: "enum", help: "Beep the horn while travelling in the selected direction.", enum: ["Off", "Reverse", "Forward", "Both"] },
  beep_on_ms:   { label: "Beep length", cat: "Indicators", unit: "ms", kind: "int", help: "On-time of each direction beep." },
  beep_per_ms:  { label: "Beep interval", cat: "Indicators", unit: "ms", kind: "int", help: "Period of the direction beep." },
  aux12_mode:   { label: "12 V aux output", cat: "Indicators", unit: "", kind: "enum", help: "Status LED, or a lock solenoid driven from the app.", enum: ["Status LED", "Lock solenoid"] },
  batt_chem:    { label: "Battery type", cat: "Battery", unit: "", kind: "enum", help: "Chemistry of each 12 V battery; sets the charge curve and the low-battery limits.", enum: ["AGM", "Flooded", "Li-ion", "LiFePO4"] },
  batt_series:  { label: "Pack layout", cat: "Battery", unit: "", kind: "enumv", help: "A single 36 V battery, or three 12 V batteries with individual monitoring taps.", values: [[1, "Single 36 V battery"], [3, "Three 12 V batteries"]] },
  batt_ah:      { label: "Battery capacity", cat: "Battery", unit: "Ah", kind: "int", help: "Capacity of each battery (20-hour rating)." },
  chg_amps_x10: { label: "Charger current", cat: "Battery", unit: "A", kind: "x10", help: "Rated output of the charger, for the charge-time estimate." },
  soc_trim_mv:  { label: "Charge reading trim", cat: "Battery", unit: "mV", kind: "mv", help: "Added to each battery's resting voltage before the state-of-charge lookup. Set at calibration." },
  i_board_zero_mv: { label: "Board current: zero", cat: "Calibration", unit: "mV", kind: "int", help: "Sense-pin voltage at zero board current (schematic 150). Adjust until the board current reads correctly at a known low load." },
  i_board_uohm:    { label: "Board current: shunt", cat: "Calibration", unit: "µΩ", kind: "int", help: "Effective shunt resistance (schematic 500). Adjust until the board current matches a clamp meter at a higher load." },
  i_tb_zero_mv:    { label: "Trailer brake current: zero", cat: "Calibration", unit: "mV", kind: "int", help: "Sense-pin voltage at zero trailer-brake current (schematic 150)." },
  i_tb_uohm:       { label: "Trailer brake current: shunt", cat: "Calibration", unit: "µΩ", kind: "int", help: "Effective shunt resistance (schematic 1000). Adjust until the trailer-brake current matches a clamp meter." },
  uvlo_soc:     { label: "Low-battery cut-off", cat: "Battery", unit: "% charge", kind: "int", help: "Below this resting state of charge the unit shuts down." },
  start_soc:    { label: "Minimum charge to start", cat: "Battery", unit: "% charge", kind: "int", help: "The motor controller is not started below this resting state of charge." },
  weak_dv_x100: { label: "Weak-battery difference", cat: "Battery", unit: "V", kind: "x100", help: "One battery resting this far below the others is reported as low." },
  uv_warn_x10:  { label: "Low-voltage warning level", cat: "Battery", unit: "V", kind: "x10", help: "Pack excursions below this are logged." },
  uv_fault_ms:  { label: "Low-voltage fault time", cat: "Battery", unit: "ms", kind: "int", help: "How long the pack must stay below the cut-off before the unit shuts down." },
  idc_delay_ms: { label: "Main power delay", cat: "Motor controller", unit: "ms", kind: "int", help: "Delay between the controller reporting ready and the main power path closing." },
  start_ramp_ms:{ label: "Pre-charge must begin within", cat: "Motor controller", unit: "ms", kind: "int", help: "After key-on, the controller bus must have started rising within this time, or the start is abandoned (fault 4)." },
  start_timeout_ms:{ label: "Start timeout", cat: "Motor controller", unit: "ms", kind: "int", help: "Key-on to the controller reporting ready; longer than this is a failed start (fault 5)." },
  j20_assert_pct:{ label: "Controller-ready signal: low below", cat: "Motor controller", unit: "%", kind: "int", help: "The controller's ready/contactor line counts as asserted below this percentage of the pack voltage. Raise it if the controller's contactor holding duty is below 100 %." },
  j20_float_pct:{ label: "Controller-ready signal: high above", cat: "Motor controller", unit: "%", kind: "int", help: "The controller's ready/contactor line counts as released above this percentage of the pack voltage." },
  start_peak_pct:{ label: "Bus level to accept ready", cat: "Motor controller", unit: "%", kind: "int", help: "The controller bus must have reached this percentage of the pack voltage when the controller reports ready. Lower it if the controller only pre-charges part way." },
  start_pattern:{ label: "Require pre-charge pattern", cat: "Motor controller", unit: "", kind: "bool", help: "Require the controller's pre-charge test before accepting its ready signal. Only when the controller's main-contactor check is on." },
  thr_neutral_mv:{ label: "Tiller at-rest threshold", cat: "Motor controller", unit: "mV", kind: "int", help: "At or below this the tiller counts as at rest: 0 % throttle, start allowed, direction may change. Set a little above the hall's rest voltage." },
  thr_tiller_max_mv:{ label: "Tiller throttle at full", cat: "Motor controller", unit: "mV", kind: "int", help: "Voltage the tiller throttle gives at full travel." },
  thr_pin_min_mv:{ label: "Throttle floor at controller", cat: "Motor controller", unit: "mV", kind: "int", help: "The controller's Pot 1 Min. Held at the pin whenever the controller is enabled; it will not start below it." },
  thr_pin_max_mv:{ label: "Throttle full at controller", cat: "Motor controller", unit: "mV", kind: "int", help: "The controller's Pot 1 Max. Full tiller travel maps to this voltage at the pin." },
  estop_idle_high:{ label: "E-stop line idles high", cat: "Motor controller", unit: "", kind: "bool", help: "On = the controller's e-stop input is held high when not pressed (normally-closed convention). Off = held low." },
  rc_lost_ms:   { label: "Remote link timeout", cat: "Drive", unit: "ms", kind: "int", help: "Without a control frame for this long the unit stops and holds (deadman)." },
  remote_arm_s: { label: "Remote request window", cat: "Drive", unit: "s", kind: "int", help: "After the phone asks for control, how long the unit waits for the tiller button press that confirms someone is at the machine." },
  remote_arm_s: { label: "Remote request window", cat: "Drive", unit: "s", kind: "int", help: "After the phone asks for control, how long the unit waits for the tiller button press that confirms someone is at the machine." },
  auto_start:   { label: "Start the motor controller", cat: "Motor controller", unit: "", kind: "bool", help: "Off = bench mode: key on, tiller live, but the controller is never started (no fault when it is not connected)." },
};
export const SETTING_CATEGORIES = ["Drive", "Battery", "Trailer", "Power", "Indicators", "Motor controller", "Calibration"];
// Throttle output calibration: pin mV at 0, 10, ... 100 % duty (docs/PROTOCOL.md)
for (let i = 0; i <= 10; i++) SETTINGS["thr_cal" + i] = { label: `Throttle pin at ${i * 10} % duty`, cat: "Calibration", unit: "mV", kind: "int", help: `Voltage measured at the controller's throttle pin with BENCH,throttle,${Math.round(i * 409.5)}. The firmware inverts this table so requested voltages are exact.` };

export const STATE_TEXT = {
  BOOT: "Starting up", PRECHECK: "Checking the board", ARMING: "Powering the tiller",
  CURTIS_START: "Starting the motor controller", RUN: "Ready", SHUTDOWN: "Shutting down",
  FAULT: "Stopped — fault", SERVICE: "Parked for service — power-cycle to resume",
};

const f = (code) => FAULTS[code] || [`FAULT_${code}`, `Fault ${code}`, `Unknown fault ${code}`, false];
export function faultName(code)  { return f(code)[0]; }
export function faultTitle(code) { return f(code)[1]; }
export function faultText(code)  { return f(code)[2]; }
export function isWarning(code)  { return code >= 32; }

// Battery model mirror (core/battery_model.h) for client-side estimates.
// Resting V per 12 V battery at 0..100 % SOC in 10 % steps; charge V; Peukert.
export const CHEM = [
  { name: "AGM",     v: [11.30, 11.55, 11.75, 11.90, 12.05, 12.20, 12.32, 12.45, 12.60, 12.75, 12.85], chargeV: 13.5,  peukert: 1.14, eff: 0.85 },
  { name: "Flooded", v: [11.30, 11.60, 11.75, 11.88, 12.00, 12.10, 12.22, 12.35, 12.45, 12.55, 12.65], chargeV: 13.4,  peukert: 1.25, eff: 0.80 },
  { name: "Li-ion",  v: [ 9.60, 10.40, 10.65, 10.80, 10.95, 11.10, 11.40, 11.70, 12.00, 12.30, 12.60], chargeV: 12.65, peukert: 1.03, eff: 0.97 },
  { name: "LiFePO4", v: [10.00, 12.50, 12.90, 13.00, 13.05, 13.10, 13.15, 13.20, 13.25, 13.30, 13.40], chargeV: 13.8,  peukert: 1.02, eff: 0.97 },
];
// Are the per-battery taps plausible? (mirrors core::tapsPlausible)
export function tapsPlausible(v12, v24, v36) { return v36 > 20 && v12 > 3 && (v24 - v12) > 3 && (v36 - v24) > 3; }
export function socFromUnitV(chem, v) {
  const k = CHEM[chem] || CHEM[0];
  if (v <= k.v[0]) return 0; if (v >= k.v[10]) return 100;
  for (let i = 0; i < 10; i++) if (v < k.v[i + 1]) return 10 * (i + (v - k.v[i]) / (k.v[i + 1] - k.v[i]));
  return 100;
}
// Hours to full at a CC/CV charger of `amps`: bulk at charge-acceptance efficiency plus an absorption tail.
export function hoursToFull(chem, socPct, ah, amps) {
  const k = CHEM[chem] || CHEM[0];
  if (amps <= 0) return null;
  const needAh = Math.max(0, (100 - socPct) / 100) * ah;
  const bulk = needAh / (amps * k.eff);
  const tail = k.peukert > 1.1 ? (socPct < 80 ? 1.5 : 0.75 * (100 - socPct) / 20) : 0.3;
  return bulk + tail;
}

function conv(t, s) {
  if (t === "str") return s;
  if (t === "hex") return s ? parseInt(s, 16) : 0;
  if (t === "int") return s ? Math.trunc(Number(s)) : 0;
  return s ? Number(s) : 0;
}

// One protocol line (no newline) -> {kind, data}. Never throws.
export function parseLine(line) {
  line = line.trim();
  if (!line) return { kind: "unknown", data: {} };
  if (line.startsWith("[")) return { kind: "log", data: { text: line } };
  const p = line.split(",");
  try {
    switch (p[0]) {
      case "TLM": {
        if (Number(p[1]) !== TLM_VERSION) return { kind: "err", data: { reason: `TLM v${p[1]}` } };
        const vals = p.slice(3);
        if (vals.length < TLM_FIELDS.length) return { kind: "err", data: { reason: "short TLM" } };
        const d = { seq: Number(p[2]) };
        TLM_FIELDS.forEach(([k, t], i) => { d[k] = conv(t, vals[i]); });
        d.inputs = {}; d.inputsValid = {}; d.outputs = {};
        INPUT_NAMES.forEach((n, i) => { d.inputs[n] = !!(d.in >> i & 1); d.inputsValid[n] = !!(d.valid >> i & 1); });
        OUTPUT_NAMES.forEach((n, i) => { d.outputs[n] = !!(d.out >> i & 1); });
        d.j20Name = J20_NAMES[d.j20] || "?";
        d.faultName = faultName(d.fault); d.faultTitle = faultTitle(d.fault); d.faultText = faultText(d.fault);
        d.srcName = SRC_NAMES[d.src] || "?";
        d.b1 = d.v12; d.b2 = +(d.v24 - d.v12).toFixed(2); d.b3 = +(d.v36 - d.v24).toFixed(2);
        return { kind: "tlm", data: d };
      }
      case "EVT": {
        if (Number(p[1]) !== EVT_VERSION) return { kind: "err", data: { reason: `EVT v${p[1]}` } };
        const d = { ts: Number(p[2]), kind: p[3], a: p[4] || "", b: p.slice(5).join(",") };
        if (d.kind === "FAULT" || d.kind === "WARN") { d.code = Number(d.b); d.title = faultTitle(d.code); d.text = faultText(d.code); }
        return { kind: "evt", data: d };
      }
      case "CFG": return { kind: "cfg", data: { key: p[1], value: Number(p[2]) } };
      case "FLT": return { kind: "flt", data: { i: +p[1], code: +p[2], name: p[3], boot: +p[4], uptime: +p[5],
                                                 vpack: +p[6], detail: +p[7], title: faultTitle(+p[2]), text: faultText(+p[2]) } };
      case "ACK": return { kind: "ack", data: { what: p[1], args: p.slice(2) } };
      case "LINK": return { kind: "link", data: { bonded: p[1] === "1", hasBond: p[2] === "1", pairing: p[3] === "1" } };
      case "ERR": return { kind: "err", data: { what: p[1], args: p.slice(2), reason: p.slice(1).join(",") } };
    }
  } catch (e) {
    return { kind: "err", data: { reason: "parse: " + e, line } };
  }
  return { kind: "unknown", data: { line } };
}
