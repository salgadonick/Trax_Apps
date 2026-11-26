// =============================================================================
// protocol/x2-v1.js — X2 dual-motor logic board, protocol v1, browser side.
// Bound to Remote-Controllers/Dual-Motor/code/ESP32-C6/docs/X2_PROTOCOL.md
// (source of truth). TLM_FIELDS / DRV_FIELDS are the exact wire order; the
// firmware emitter is x2_receive/telemetry.cpp and the simulator is
// tools/x2_sim.py. Change all of them together.
//
// The X2 sends two periodic lines: TLM (system, the shell counts its seq) and
// DRV (the drive loop: command, mixer, assist, wheel speeds). DRV is a "quiet"
// kind: the shell keeps it out of the console and hands it to the dashboard.
// =============================================================================

export const TLM_VERSION = 1;
export const DRV_VERSION = 1;
export const EVT_VERSION = 1;
export const QUIET_KINDS = ["drv", "fdef"];
export const FAULTDEFS = true;      // the unit lists its fault codes on request (FAULTDEFS -> FDEF rows)

// [key, type, label, unit, category] — order == wire order after "TLM,<ver>,<seq>,"
export const TLM_FIELDS = [
  ["state",   "str", "State",                       "",   "Vehicle"],
  ["fault",   "int", "Fault code",                  "",   "Vehicle"],
  ["src",     "int", "Phone control",               "",   "Control"],
  ["ctl",     "int", "Driving now",                 "",   "Control"],
  ["link",    "int", "Handheld radio link",         "",   "Control"],
  ["v36",     "f",   "Pack voltage",                "V",  "Battery"],
  ["v24",     "f",   "24 V tap",                    "V",  "Battery"],
  ["v12",     "f",   "12 V tap",                    "V",  "Battery"],
  ["v_mc",    "f",   "Controller bus",              "V",  "Motor controllers"],
  ["v_j20a",  "f",   "Controller A ready line",     "V",  "Motor controllers"],
  ["v_j20b",  "f",   "Controller B ready line",     "V",  "Motor controllers"],
  ["j20a",    "int", "Controller A ready",          "",   "Motor controllers"],
  ["j20b",    "int", "Controller B ready",          "",   "Motor controllers"],
  ["i_board", "f",   "Board current",               "A",  "Battery"],
  ["i_tb",    "f",   "Trailer brake current",       "A",  "Trailer"],
  ["in",      "hex", "Input bits",                  "",   "Vehicle"],
  ["valid",   "hex", "Input bits valid",            "",   "Vehicle"],
  ["out",     "hex", "Output bits",                 "",   "Vehicle"],
  ["tb_pct",  "int", "Trailer brake",               "%",  "Trailer"],
  ["soc",     "f",   "State of charge",             "%",  "Battery"],
  ["guard",   "int", "Power ceiling",               "%",  "Vehicle"],
  ["temp",    "f",   "Temperature",                 "°C", "Battery"],
  ["up",      "int", "Uptime",                      "s",  "Vehicle"],
  ["sleep",   "int", "Auto-off in",                 "s",  "Vehicle"],
  ["estop_l", "int", "E-stop latched",              "",   "Vehicle"],
  ["v_tb",    "f",   "Trailer brake supply",        "V",  "Trailer"],
  ["v_aux",   "f",   "14 V aux supply",             "V",  "Trailer"],
  ["tb_st",   "int", "Trailer detected",            "",   "Trailer"],
  ["kt_l",    "f",   "Kar-Tech left lever",         "V",  "Control"],
  ["kt_r",    "f",   "Kar-Tech right lever",        "V",  "Control"],
  ["lq",      "int", "Handheld frames per second",  "",   "Control"],
];
export const TLM_REQUIRED = 31;

// order == wire order after "DRV,<ver>,<seq>,"
export const DRV_FIELDS = [
  ["cmd_mode", "int", "Command layout",             "",     "Drive"],
  ["cmd_x",    "int", "Command: throttle / left",   "%",    "Drive"],
  ["cmd_y",    "int", "Command: turn / right",      "%",    "Drive"],
  ["cmd_pot",  "int", "Speed knob",                 "%",    "Drive"],
  ["btns",     "hex", "Remote buttons",             "",     "Drive"],
  ["gate",     "int", "Command gate",               "",     "Drive"],
  ["mix_l",    "f",   "Mixer: left track",          "%",    "Drive"],
  ["mix_r",    "f",   "Mixer: right track",         "%",    "Drive"],
  ["out_l",    "f",   "After assist: left track",   "%",    "Drive"],
  ["out_r",    "f",   "After assist: right track",  "%",    "Drive"],
  ["thr_a",    "f",   "Throttle to controller A",   "%",    "Drive"],
  ["thr_b",    "f",   "Throttle to controller B",   "%",    "Drive"],
  ["dir_l",    "int", "Left direction",             "",     "Drive"],
  ["dir_r",    "int", "Right direction",            "",     "Drive"],
  ["ws_l",     "f",   "Left wheel sensor",          "Hz",   "Wheel speed"],
  ["ws_r",     "f",   "Right wheel sensor",         "Hz",   "Wheel speed"],
  ["spd_l",    "int", "Left track speed",           "mm/s", "Wheel speed"],
  ["spd_r",    "int", "Right track speed",          "mm/s", "Wheel speed"],
  ["pid",      "int", "Drive assist",               "",     "Wheel speed"],
  ["pid_u",    "f",   "Assist correction",          "%",    "Wheel speed"],
  ["pid_e",    "f",   "Speed-share error",          "",     "Wheel speed"],
  ["cnt_l",    "int", "Left pulse count",           "",     "Wheel speed"],
  ["cnt_r",    "int", "Right pulse count",          "",     "Wheel speed"],
  ["learn_f",  "f",   "Learned trim, forward",      "%",    "Wheel speed"],
  ["learn_r",  "f",   "Learned trim, reverse",      "%",    "Wheel speed"],
  ["learn",    "int", "Trim learning",              "",     "Wheel speed"],
];
export const FIELD_CATEGORIES = ["Vehicle", "Control", "Drive", "Wheel speed", "Battery", "Motor controllers", "Trailer"];

export const INPUT_NAMES  = ["wake", "temp_alert", "brake_a", "brake_b", "estop_open", "relay_i_a", "relay_i_b",
                             "limit1", "limit2", "kt_estop", "pair", "speed_sw"];
export const OUTPUT_NAMES = ["shifter", "ksi", "idc", "tb_bus", "way7", "estop_sig", "fast", "relay_a", "relay_b",
                             "lift_a", "lower_a", "lift_b", "lower_b", "horn", "aux12", "auxbatt"];
export const INPUT_LABELS = { wake: "Power button", temp_alert: "Temperature alert", brake_a: "Motor brake A released",
  brake_b: "Motor brake B released", estop_open: "E-stop loop open", relay_i_a: "Relay A coil current",
  relay_i_b: "Relay B coil current", limit1: "Limit switch 1", limit2: "Limit switch 2", kt_estop: "Kar-Tech e-stop line high",
  pair: "Pair button", speed_sw: "Local fast toggle" };
export const OUTPUT_LABELS = { shifter: "Level shifters", ksi: "Key switch (KSI)", idc: "Main power", tb_bus: "Trailer brake supply",
  way7: "7-way 12 V", estop_sig: "E-stop to controllers", fast: "Fast mode", relay_a: "Relay A", relay_b: "Relay B",
  lift_a: "Lift A", lower_a: "Lower A", lift_b: "Lift B", lower_b: "Lower B", horn: "Horn", aux12: "12 V aux", auxbatt: "Battery meter" };
export const J20_NAMES = ["unpowered", "ready", "not ready", "indeterminate"];
export const DIR_NAMES = ["stopped", "forward", "reverse"];
export const SRC_NAMES = ["radio remote", "phone requested", "phone armed", "phone link lost", "phone stopped"];
export const CTL_NAMES = ["nobody", "Trax handheld", "Kar-Tech remote", "phone"];
export const LINK_NAMES = ["no radio fitted", "not paired", "searching", "linked", "e-stop pressed on the handheld", "pairing", "off (Kar-Tech unit)"];
export const PID_NAMES = ["off", "active", "standing by", "sensor fault"];
export const TRAILER_NAMES = ["unknown", "none", "connected", "open circuit"];

// The radio remote's button mask (TxPacket.btns); the app sends the same bits.
export const BTN = { sw0: 1, sw1: 2, btn0: 4, btn1: 8, btn2: 16, btn3: 32 };

// code -> [wire name, plain-English title, description, isWarning]. Codes 1..23 and
// 32..45 are shared with the GSE tiller handle; 24+ and 46+ are X2 only.
export const FAULTS = {
  0:  ["NONE", "No fault", "No fault.", false],
  1:  ["ESTOP_PRESSED", "Emergency stop", "The hard-wired emergency stop loop is open: the e-stop is pressed, or its wiring or fuse is open. Release it, then Restart.", false],
  2:  ["CURTIS_J20_FAULT", "Motor controller A fault", "Motor controller A reported a fault while running.", false],
  3:  ["J20_TIMEOUT_AT_START", "Motor controller A not ready", "Motor controller A did not come ready at start-up.", false],
  4:  ["RAMP_TIMEOUT_AT_START", "Motor controller A not powering up", "No pre-charge seen on controller A's bus after key-on. Check the controller connections.", false],
  29: ["RAMP_TIMEOUT_AT_START_B", "Motor controller B not powering up", "No pre-charge seen on controller B's bus after key-on. Check the controller connections.", false],
  5:  ["THROTTLE_NONZERO_AT_BOOT", "Remote not at zero at start-up", "The radio remote's throttle was not at zero the first time the unit read it after starting: a stick or lever was being held, a Kar-Tech lever wire is open or shorted (an open wire reads about 0.44 V), or the control does not rest at zero. The unit will not run because the remote's zero cannot be established. Let go of the controls, check the lever wiring and that the controls rest at centre, then Restart.", false],
  // Tiller-only codes (reserved here, never raised by x2_receive): named so a shared table stays complete.
  6:  ["DIR_NONZERO_AT_BOOT", "Direction selected at start", "A direction was selected when the unit powered up (tiller units only).", false],
  7:  ["THROTTLE_STALE", "Throttle signal lost", "The throttle signal stopped updating while running (tiller units only).", false],
  8:  ["DIR_BOTH", "Both directions selected", "Forward and reverse were selected together (tiller units only).", false],
  18: ["THROTTLE_OUT_OF_RANGE", "Throttle out of range", "The throttle signal is out of range: wiring (tiller units only).", false],
  9:  ["UNDERVOLT_PACK", "Low battery", "The battery is too low to run. Charge it.", false],
  10: ["TB_STUCK_ON", "Trailer brake stuck on", "Trailer-brake current with the brake commanded off.", false],
  11: ["I2C_LOST", "Internal I/O fault", "The internal I/O expanders stopped responding.", false],
  12: ["RTC_WDT_RESET", "Controller reset (watchdog)", "The hardware watchdog reset the board while running.", false],
  13: ["BROWNOUT_RESET", "Controller reset (supply dip)", "The supply dipped below the board's brown-out level while running.", false],
  14: ["EXT_RESET_WHILE_LIVE", "Board reset while running", "The board was reset (reset pin or host) while the motor controllers were live.", false],
  15: ["OVERTEMP", "Over-temperature", "Over-temperature sustained.", false],
  16: ["EXPANDER_ABSENT", "Internal I/O missing", "The internal I/O expanders were not found at boot.", false],
  17: ["REMOTE_LINK_LOST", "Phone control link lost", "The phone link dropped while the phone was driving. The unit stopped.", false],
  19: ["PANIC_RESET", "Firmware crashed", "The firmware crashed while running.", false],
  20: ["TASK_WDT_RESET", "Firmware hung", "A firmware task hung while running.", false],
  21: ["INT_WDT_RESET", "Firmware interrupt stall", "Interrupts were blocked too long while running.", false],
  22: ["SW_RESET_WHILE_LIVE", "Firmware restarted while running", "The firmware restarted itself while the motor controllers were live.", false],
  23: ["BRAKE_DISCONNECTED", "Motor brake A not connected", "At start-up the brake line of controller A read disconnected: the brake coil is unplugged or open. Check the connector, then Restart.", false],
  24: ["RELAY_COIL_OPEN_A", "Power relay A not drawing current", "Power relay A (motor controller A) is switched on with the e-stop loop closed, but its coil draws no current: relay unplugged, coil open, or the loop fuse has tripped.", false],
  28: ["RELAY_COIL_OPEN_B", "Power relay B not drawing current", "Power relay B (motor controller B) is switched on with the e-stop loop closed, but its coil draws no current: relay unplugged, coil open, or the loop fuse has tripped.", false],
  25: ["CURTIS_J20_FAULT_B", "Motor controller B fault", "Motor controller B reported a fault while running.", false],
  26: ["J20_TIMEOUT_AT_START_B", "Motor controller B not ready", "Motor controller B did not come ready at start-up.", false],
  27: ["BRAKE_DISCONNECTED_B", "Motor brake B not connected", "At start-up the brake line of controller B read disconnected: the brake coil is unplugged or open. Check the connector, then Restart.", false],
  32: ["UNDERVOLT_TRANSIENT", "Battery dipped under load", "The battery voltage dipped under load.", true],
  33: ["UNEVEN_BATTERY1", "Battery 1 unevenly charged", "Battery 1 rests lower than the others: charge each battery individually.", true],
  34: ["UNEVEN_BATTERY2", "Battery 2 unevenly charged", "Battery 2 rests lower than the others: charge each battery individually.", true],
  35: ["UNEVEN_BATTERY3", "Battery 3 unevenly charged", "Battery 3 rests lower than the others: charge each battery individually.", true],
  36: ["TB_OPEN_COIL", "Trailer brake not connected", "No trailer-brake current: trailer not connected or the coil is open.", true],
  37: ["OVERTEMP_WARNING", "Running hot", "Temperature is high: power is limited.", true],
  38: ["REMOTE_OVERRIDDEN", "Phone control interrupted", "The radio remote was used, so it took control back from the phone.", true],
  39: ["POWER_LOSS_WHILE_LIVE", "Power lost while running", "Power was lost while running; the previous run never shut down.", true],
  40: ["WEAK_BATTERY1", "Weak battery 1", "Battery 1 collapses under load far more than the others: weak or failing, replace it.", true],
  41: ["WEAK_BATTERY2", "Weak battery 2", "Battery 2 collapses under load far more than the others: weak or failing, replace it.", true],
  42: ["WEAK_BATTERY3", "Weak battery 3", "Battery 3 collapses under load far more than the others: weak or failing, replace it.", true],
  43: ["REMOTE_LINK_IDLE", "Phone control ended", "The phone link dropped while the unit was at rest. The radio remote is back in control; request control again when ready.", true],
  44: ["TEMP_SENSOR_LOST", "Temperature sensor not answering", "The power-board temperature sensor stopped answering. The unit keeps running without over-temperature protection; have it checked.", true],
  45: ["MOTOR_CURRENT_LIMITED", "Motor current limited", "The board current reached the limit, so the unit is holding the throttle down.", true],
  46: ["WHEEL_SENSOR_LEFT", "Left wheel sensor not reading", "The left track is being driven but its speed sensor shows no pulses. The drive assist is off until it reads again; the unit still drives.", true],
  47: ["WHEEL_SENSOR_RIGHT", "Right wheel sensor not reading", "The right track is being driven but its speed sensor shows no pulses. The drive assist is off until it reads again; the unit still drives.", true],
  48: ["RELAY_COIL_NO_CURRENT_A", "Power relay A not drawing current", "Power relay A (motor controller A) is switched on with the e-stop loop closed, but its coil draws no current. Reported only (relay check is set to monitor).", true],
  52: ["RELAY_COIL_NO_CURRENT_B", "Power relay B not drawing current", "Power relay B (motor controller B) is switched on with the e-stop loop closed, but its coil draws no current. Reported only (relay check is set to monitor).", true],
  49: ["KARTECH_SIGNAL", "Kar-Tech left lever signal out of range", "The Kar-Tech LEFT lever signal is outside its valid band (open or shorted wire, or the receiver is off). Both tracks are held at rest until both levers read in range and are back at neutral.", true],
  53: ["KARTECH_SIGNAL_R", "Kar-Tech right lever signal out of range", "The Kar-Tech RIGHT lever signal is outside its valid band (open or shorted wire, or the receiver is off). Both tracks are held at rest until both levers read in range and are back at neutral.", true],
  51: ["TRACK_MISMATCH", "Tracks differ more than wear explains", "The drive assist's learned trim has reached its limit: one track is consistently slower than the other for the same throttle. Check for a dragging brake, a soft or worn tyre, or a weak motor on the slow side. The unit still drives.", true],
  30: ["ESTOP_REMOTE", "E-stop pressed on the handheld", "The Trax handheld's e-stop was pressed. The unit stopped and holds in FAULT, like the hard-wired e-stop. Release the e-stop on the handheld, then Restart (or turn the unit off and on).", false],
  50: ["RADIO_ESTOP", "Kar-Tech remote stopped", "The Kar-Tech receiver's ready line dropped: the remote's e-stop was pressed or the remote went off. The unit holds at rest until the Kar-Tech remote is back up (power-cycle it) and the levers are at neutral. Not a fault: no Restart needed.", true],
};

// key -> {label, cat, unit, kind, help, enum?|values?}   kind: int | bool | enum | enumv | x10 | x100 | mv
export const SETTINGS = {
  // ---- Control ----
  ctrl_src:      { label: "Who may drive", cat: "Control", unit: "", kind: "enum", help: "Both: the radio remote drives, and the phone can take over on request (bench). Radio remote only: the phone can watch but not drive. Phone only: radio commands are ignored; a radio e-stop still stops the unit.", enum: ["Both (bench)", "Radio remote only", "Phone only"] },
  radio_src:     { label: "Radio remote type", cat: "Control", unit: "", kind: "enumv", help: "Which radio remote this unit is built for. Trax handheld: RC-car style, the left stick drives forward and reverse and the right stick rotates. Kar-Tech: tank style, the left and right levers are the left and right tracks. The remote that is not selected is not read at all; a Kar-Tech unit switches the handheld radio off. Changing it needs one press of the unit's power button to confirm, and the unit must then be switched off and on; it parks with its outputs safe until that is done.", values: [[1, "Trax handheld (RC-car style)"], [2, "Kar-Tech receiver (tank style)"]] },
  app_style:     { label: "Phone control style", cat: "Control", unit: "", kind: "enum", help: "What the phone's drive screen does. RC car: the left stick drives forward and reverse, the right stick rotates (like the Trax handheld). Tank: the left and right levers are the left and right tracks (like the Kar-Tech remote). Changing it needs one press of the unit's power button to confirm, and the unit must then be switched off and on; it parks with its outputs safe until that is done.", enum: ["RC car (drive + rotation)", "Tank (left + right track)"] },
  radio_lost_ms: { label: "Handheld link timeout", cat: "Control", unit: "ms", kind: "int", help: "No valid frame from the Trax handheld for this long and the unit comes to rest." },
  app_arm_press: { label: "Phone needs a button press", cat: "Control", unit: "", kind: "bool", help: "On: after the phone asks for control, someone must press the unit's power button once to confirm they are at the machine. Off (bench only): the phone is armed at once." },
  remote_arm_s:  { label: "Phone request window", cat: "Control", unit: "s", kind: "int", help: "How long the unit waits for that button press." },
  rc_lost_ms:    { label: "Phone link timeout", cat: "Control", unit: "ms", kind: "int", help: "Without a control frame from the phone for this long the unit stops and holds (deadman)." },
  sw0_mode:      { label: "Remote switch SW0", cat: "Control", unit: "", kind: "enum", help: "What the first toggle on the remote does. Fast mode drives the controllers' speed line; the local fast/slow toggle on the unit can also select fast.", enum: ["Unused", "Fast mode"] },
  sw1_mode:      { label: "Remote switch SW1", cat: "Control", unit: "", kind: "enum", help: "What the second toggle does. The 12 V aux choice also needs the 12 V aux output set to follow SW1.", enum: ["Horn", "12 V aux output"] },
  lim_mode:      { label: "Limit switches", cat: "Control", unit: "", kind: "enum", help: "Monitor only, or limit switch 1 blocks lift and limit switch 2 blocks lower on both actuators.", enum: ["Monitor only", "Block lift / lower"] },
  // ---- Kar-Tech ----
  kt_center_mv:  { label: "Kar-Tech lever centre", cat: "Kar-Tech", unit: "mV", kind: "int", help: "Nominal lever voltage at rest (2500 for a 0 to 5 V wig-wag). The unit measures each lever's actual rest voltage near this while the levers are let go, and uses that as zero." },
  kt_span_mv:    { label: "Kar-Tech lever travel", cat: "Kar-Tech", unit: "mV", kind: "int", help: "Voltage either side of centre that means 100 %. 2500 puts full reverse at 0 V and full forward at 5 V, as the board's input is scaled." },
  kt_db_mv:      { label: "Kar-Tech dead band", cat: "Kar-Tech", unit: "mV", kind: "int", help: "Either side of the measured rest voltage that still counts as at rest. Also how far from the nominal centre a lever may rest and still be measured as zero." },
  kt_min_mv:     { label: "Kar-Tech valid band: low", cat: "Kar-Tech", unit: "mV", kind: "int", help: "Below this the lever signal is treated as a wiring fault: both tracks stop. The board reads down to about -360 mV, so the whole 0 to 5 V travel is valid. A broken lever wire reads about 440 mV, inside the range: it is caught at start-up, where the levers must read neutral (fault 5)." },
  kt_max_mv:     { label: "Kar-Tech valid band: high", cat: "Kar-Tech", unit: "mV", kind: "int", help: "Above this the lever signal is treated as a wiring fault (a short to a supply): both tracks stop. The board reads up to about 5660 mV." },
  kt_estop_mode: { label: "Kar-Tech e-stop line", cat: "Kar-Tech", unit: "", kind: "enum", help: "How the receiver's e-stop output is read. Low = stop is the fail-safe choice: a receiver that loses its link or power stops the unit.", enum: ["Ignored", "Low = stop", "High = stop"] },
  kt_swap:       { label: "Kar-Tech swap levers", cat: "Kar-Tech", unit: "", kind: "bool", help: "Swap which lever drives which track." },
  kt_inv_l:      { label: "Kar-Tech invert left", cat: "Kar-Tech", unit: "", kind: "bool", help: "Reverse the left lever's direction." },
  kt_inv_r:      { label: "Kar-Tech invert right", cat: "Kar-Tech", unit: "", kind: "bool", help: "Reverse the right lever's direction." },
  // ---- Drive ----
  thr_limit:     { label: "Speed limit", cat: "Drive", unit: "%", kind: "int", help: "A full command maps to this percentage of the motor controllers' input. Stored on the unit." },
  mc_swap:       { label: "Swap left / right controllers", cat: "Drive", unit: "", kind: "bool", help: "Off: controller A is the left track, B the right. On: swapped. Takes effect at the next start, never while the controllers are live." },
  mc_mask:       { label: "Controllers fitted", cat: "Drive", unit: "", kind: "enumv", help: "Which motor controllers are connected. Use one controller only on the bench. Takes effect at the next start, never while the controllers are live.", values: [[1, "A only"], [2, "B only"], [3, "A and B"]] },
  ilim_a:        { label: "Board current limit", cat: "Drive", unit: "A", kind: "int", help: "While driving, the unit lowers its throttle ceiling to keep the board current at or below this. 0 turns the limiter off." },
  // ---- Wheel speed and assist ----
  pid_en:        { label: "Drive assist", cat: "Wheel speed", unit: "", kind: "bool", help: "Trim the two throttles from the wheel-speed sensors so the unit drives straight when asked to and holds the commanded ratio in turns." },
  pid_kp_x100:   { label: "Assist: P gain", cat: "Wheel speed", unit: "", kind: "x100", help: "Correction per unit of speed-share error. Higher reacts faster; too high makes the tracks hunt." },
  pid_ki_x100:   { label: "Assist: I gain", cat: "Wheel speed", unit: "/s", kind: "x100", help: "How fast a steady difference between the tracks is removed. This term works on the pulse counts, so it also bounds how far the heading swings while it settles." },
  pid_kd_x1000:  { label: "Assist: D gain (x1000)", cat: "Wheel speed", unit: "", kind: "int", help: "Damping on a changing error. 0 = off; start there." },
  pid_max_pct:   { label: "Assist: authority", cat: "Wheel speed", unit: "%", kind: "int", help: "The most the assist may slow one track and raise the other." },
  pid_min_cmd_pct: { label: "Assist: minimum command", cat: "Wheel speed", unit: "%", kind: "int", help: "Both tracks must be commanded above this for the assist to act." },
  pid_min_hz_x10:  { label: "Assist: minimum sensor rate", cat: "Wheel speed", unit: "Hz", kind: "x10", help: "Both sensors must show at least this pulse rate for the assist to act." },
  pid_sensor_ms: { label: "Assist: sensor fault time", cat: "Wheel speed", unit: "ms", kind: "int", help: "A driven track with no pulses for this long raises a wheel-sensor warning and the assist stands down." },
  pid_learn:     { label: "Assist: learn the trim", cat: "Wheel speed", unit: "", kind: "bool", help: "Keep the correction the tracks settle at in steady straight driving as a stored trim, so each run starts with the worn-in difference between the motors already taken out. Learned slowly, forward and reverse separately." },
  pid_learn_max: { label: "Assist: learned trim limit", cat: "Wheel speed", unit: "%", kind: "int", help: "The most the stored trim may reach. It is part of the assist's authority, not added to it. A trim at this limit raises a warning: the tracks differ by more than wear explains." },
  pid_learn_s:   { label: "Assist: learning time", cat: "Wheel speed", unit: "s", kind: "int", help: "Seconds of steady straight driving for the stored trim to take up about two thirds of the correction in use. Longer ignores slopes and soft ground better; shorter follows a change sooner." },
  ws_ppr:        { label: "Sensor pulses per revolution", cat: "Wheel speed", unit: "", kind: "int", help: "Teeth or slots the sensor sees per wheel or sprocket revolution. Only used to show speed." },
  ws_circ_mm:    { label: "Travel per revolution", cat: "Wheel speed", unit: "mm", kind: "int", help: "Ground travel for one revolution of that wheel or sprocket. Only used to show speed." },
  ws_ratio_x1000:{ label: "Left / right pulse ratio (x1000)", cat: "Wheel speed", unit: "", kind: "int", help: "Left pulses per right pulse at equal ground speed, times 1000. 1000 unless the two sides have different tone rings." },
  ws_window_ms:  { label: "Speed averaging window", cat: "Wheel speed", unit: "ms", kind: "int", help: "Shortest window the pulse rate is averaged over. Slow wheels automatically use a longer one." },
  ws_swap:       { label: "Swap wheel sensors", cat: "Wheel speed", unit: "", kind: "bool", help: "Off: sensor A is the left track. On: swapped." },
  // ---- Battery ----
  batt_chem:     { label: "Battery type", cat: "Battery", unit: "", kind: "enum", help: "Chemistry of each 12 V battery; sets the charge curve and the low-battery limits.", enum: ["AGM", "Flooded", "Li-ion", "LiFePO4"] },
  batt_series:   { label: "Pack layout", cat: "Battery", unit: "", kind: "enumv", help: "A single 36 V battery, or three 12 V batteries with individual monitoring taps.", values: [[1, "Single 36 V battery"], [3, "Three 12 V batteries"]] },
  batt_ah:       { label: "Battery capacity", cat: "Battery", unit: "Ah", kind: "int", help: "Capacity of each battery (20-hour rating)." },
  soc_trim_mv:   { label: "Charge reading trim", cat: "Battery", unit: "mV", kind: "mv", help: "Added to each battery's resting voltage before the state-of-charge lookup." },
  uvlo_soc:      { label: "Low-battery cut-off", cat: "Battery", unit: "% charge", kind: "int", help: "Below this resting state of charge the unit shuts down." },
  start_soc:     { label: "Minimum charge to start", cat: "Battery", unit: "% charge", kind: "int", help: "The motor controllers are not started below this resting state of charge." },
  weak_dv_x100:  { label: "Uneven-battery difference", cat: "Battery", unit: "V", kind: "x100", help: "One battery resting this far below the others is reported as unevenly charged." },
  uv_warn_x10:   { label: "Low-voltage warning level", cat: "Battery", unit: "V", kind: "x10", help: "Pack excursions below this are logged." },
  uv_fault_ms:   { label: "Low-voltage fault time", cat: "Battery", unit: "ms", kind: "int", help: "How long the pack must stay below the cut-off before the unit shuts down." },
  // ---- Trailer ----
  tb_enable:     { label: "Trailer brake supply", cat: "Trailer", unit: "", kind: "bool", help: "Allow the trailer-brake converter to be powered at all." },
  way7_mode:     { label: "7-way 12 V output", cat: "Trailer", unit: "", kind: "enum", help: "Off, follows the trailer-brake supply, or always on.", enum: ["Off", "Follows trailer brake", "Always on"] },
  tb_full_ms:    { label: "Trailer brake full-apply time", cat: "Trailer", unit: "ms", kind: "int", help: "How long the trailer brake holds at the full-apply duty at a stop, before dropping to the hold duty." },
  tb_full_pct:   { label: "Trailer brake full-apply duty", cat: "Trailer", unit: "%", kind: "int", help: "Duty applied for the full-apply time." },
  tb_hold_pct:   { label: "Trailer brake hold duty", cat: "Trailer", unit: "%", kind: "int", help: "Duty held after the full-apply time while the unit is stopped." },
  tb_present_x10:{ label: "Trailer detect current", cat: "Trailer", unit: "A", kind: "x10", help: "Trailer-brake coil current above which a trailer counts as connected." },
  mc_decel_ms:   { label: "Motor controller decel ramp", cat: "Trailer", unit: "ms", kind: "int", help: "The Curtis decel setting. The trailer brake ramps up in step with it when the command is released to zero." },
  // ---- Power ----
  sleep_min:     { label: "Auto-off after idle", cat: "Power", unit: "min", kind: "int", help: "Turn the unit off after this long with no activity. 0 = never. Driving (from any remote) and a connected phone keep it awake; a handheld that is merely switched on does not." },
  shut_dly:      { label: "Shutdown delay", cat: "Power", unit: "ms", kind: "int", help: "Time between the outputs going safe and the power latch releasing." },
  temp_warn_c:   { label: "Temperature: warning", cat: "Power", unit: "°C", kind: "int", help: "Power-board temperature at which a warning is logged and the throttle ceiling starts to fold back." },
  temp_fault_c:  { label: "Temperature: shutdown", cat: "Power", unit: "°C", kind: "int", help: "Power-board temperature at which the unit stops with an over-temperature fault." },
  aux12_mode:    { label: "12 V aux output", cat: "Power", unit: "", kind: "enum", help: "Status LED, or switched from the remote's SW1.", enum: ["Status LED", "Follows SW1"] },
  // ---- Motor controllers ----
  auto_start:    { label: "Start the motor controllers", cat: "Motor controllers", unit: "", kind: "bool", help: "Off = bench mode: key on, inputs live, but the controllers are never started (no fault when they are not connected)." },
  start_bus_chk: { label: "Require bus pre-charge", cat: "Motor controllers", unit: "", kind: "bool", help: "On: the controller bus must be seen ramping before a controller's ready signal counts. Turn off if the bus sense point does not see the pre-charge on this wiring." },
  start_pattern: { label: "Require pre-charge pattern", cat: "Motor controllers", unit: "", kind: "bool", help: "Only when the controllers' main-contactor check is on." },
  idc_delay_ms:  { label: "Main power delay", cat: "Motor controllers", unit: "ms", kind: "int", help: "Delay between a controller reporting ready and its power path closing." },
  start_ramp_ms: { label: "Pre-charge must begin within", cat: "Motor controllers", unit: "ms", kind: "int", help: "After key-on, the controller bus must have started rising within this time." },
  start_tout_ms: { label: "Start timeout", cat: "Motor controllers", unit: "ms", kind: "int", help: "Key-on to each controller reporting ready; longer than this is a failed start." },
  start_peak_pct:{ label: "Bus level to accept ready", cat: "Motor controllers", unit: "%", kind: "int", help: "The controller bus must have reached this percentage of the pack voltage when a controller reports ready." },
  j20_assert_pct:{ label: "Controller-ready signal: low below", cat: "Motor controllers", unit: "%", kind: "int", help: "A controller's ready line counts as asserted below this percentage of the pack voltage." },
  j20_float_pct: { label: "Controller-ready signal: high above", cat: "Motor controllers", unit: "%", kind: "int", help: "A controller's ready line counts as released above this percentage of the pack voltage." },
  brake_engage_ms: { label: "Motor brake check: settle time", cat: "Motor controllers", unit: "ms", kind: "int", help: "At start-up, how long after the key line comes up before the brake lines are judged." },
  brake_fault_ms:  { label: "Motor brake check: fault time", cat: "Motor controllers", unit: "ms", kind: "int", help: "At start-up, how long a brake line may read disconnected before the unit faults. 0 turns the check off." },
  relay_chk_ms:  { label: "Relay coil check", cat: "Motor controllers", unit: "ms", kind: "int", help: "A relay switched on with the e-stop loop closed must draw coil current within this time or the unit faults. 0 = report only." },
  estop_chk:     { label: "Monitor the e-stop loop", cat: "Motor controllers", unit: "", kind: "bool", help: "Off only on the bench, with no e-stop loop plugged in." },
  estop_idle_high: { label: "E-stop line idles high", cat: "Motor controllers", unit: "", kind: "bool", help: "On = the controllers' e-stop input is held high when not asserted. Off = held low." },
  thr_pin_min_mv:{ label: "Throttle floor at controller", cat: "Motor controllers", unit: "mV", kind: "int", help: "Held at each throttle pin whenever the controllers are enabled." },
  thr_pin_max_mv:{ label: "Throttle full at controller", cat: "Motor controllers", unit: "mV", kind: "int", help: "The controllers' Pot 1 Max: a full command maps to this voltage at the pin." },
  ilim_kp_x100:  { label: "Current limiter: P gain", cat: "Motor controllers", unit: "", kind: "x100", help: "Fold-back per unit of overage, per 20 ms." },
  ilim_ki_x100:  { label: "Current limiter: I gain", cat: "Motor controllers", unit: "", kind: "x100", help: "Fold-back on the accumulated overage." },
  ilim_kd_x1000: { label: "Current limiter: D gain (x1000)", cat: "Motor controllers", unit: "", kind: "int", help: "Spike guard on a fast-rising current." },
  // ---- Calibration ----
  i_board_zero_mv: { label: "Board current: zero", cat: "Calibration", unit: "mV", kind: "int", help: "Sense-pin voltage at zero board current." },
  i_board_uohm:    { label: "Board current: shunt", cat: "Calibration", unit: "µΩ", kind: "int", help: "Effective shunt resistance." },
  i_tb_zero_mv:    { label: "Trailer brake current: zero", cat: "Calibration", unit: "mV", kind: "int", help: "0 = measured automatically at every power-up." },
  i_tb_uohm:       { label: "Trailer brake current: shunt", cat: "Calibration", unit: "µΩ", kind: "int", help: "Effective shunt resistance." },
};
export const SETTING_CATEGORIES = ["Control", "Drive", "Wheel speed", "Kar-Tech", "Battery", "Trailer", "Power", "Motor controllers", "Calibration"];
for (let i = 0; i <= 10; i++) SETTINGS["thr_cal" + i] = { label: `Throttle pin at ${i * 10} % duty`, cat: "Calibration", unit: "mV", kind: "int", help: `Voltage measured at a controller's throttle pin with BENCH,throttle_a,${Math.round(i * 409.5)}. The firmware inverts this table so requested voltages are exact. One table serves both channels.` };

export const STATE_TEXT = {
  BOOT: "Starting up", PRECHECK: "Checking the board", ARMING: "Powering the controllers",
  CURTIS_START: "Starting the motor controllers", RUN: "Ready", SHUTDOWN: "Shutting down",
  FAULT: "Stopped — fault", SERVICE: "Parked for service — power-cycle to resume",
};

const f = (code) => FAULTS[code] || [`FAULT_${code}`, `Fault ${code}`, `Unknown fault ${code}`, false];
const humanName = (name) => name.toLowerCase().replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
// A code this app version predates, named by the firmware (FAULTDEFS reply or a
// stored-fault row): title from the name, text says to update. Never "Unknown fault".
export function learnFault(code, name, warn) {
  if (!FAULTS[code] && name) FAULTS[code] = [name, humanName(name),
    `${warn ? "Warning" : "Fault"} ${code} (${name}): this app version has no description for it. Update the app.`, !!warn];
}
// Stored-fault row: title / text from the table, or from the firmware's own
// name when this app version does not know the code (never "Unknown fault").
const fltTitleText = (code, name) => { learnFault(code, name, code >= 32); return [faultTitle(code), faultText(code)]; };
export function faultName(code)  { return f(code)[0]; }
export function faultTitle(code) { return f(code)[1]; }
export function faultText(code)  { return f(code)[2]; }
export function isWarning(code)  { return code >= 32; }

// Battery model mirror (core/battery_model.h), same table as the GSE.
export const CHEM = [
  { name: "AGM",     v: [11.30, 11.55, 11.75, 11.90, 12.05, 12.20, 12.32, 12.45, 12.60, 12.75, 12.85], chargeV: 13.5 },
  { name: "Flooded", v: [11.30, 11.60, 11.75, 11.88, 12.00, 12.10, 12.22, 12.35, 12.45, 12.55, 12.65], chargeV: 13.4 },
  { name: "Li-ion",  v: [ 9.60, 10.40, 10.65, 10.80, 10.95, 11.10, 11.40, 11.70, 12.00, 12.30, 12.60], chargeV: 12.65 },
  { name: "LiFePO4", v: [10.00, 12.50, 12.90, 13.00, 13.05, 13.10, 13.15, 13.20, 13.25, 13.30, 13.40], chargeV: 13.8 },
];
export function tapsPlausible(v12, v24, v36) { return v36 > 20 && v12 > 3 && (v24 - v12) > 3 && (v36 - v24) > 3; }

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
        if (vals.length < TLM_REQUIRED) return { kind: "err", data: { reason: "short TLM" } };
        const d = { seq: Number(p[2]) };
        TLM_FIELDS.forEach(([k, t], i) => { d[k] = i < vals.length ? conv(t, vals[i]) : null; });
        d.inputs = {}; d.inputsValid = {}; d.outputs = {};
        INPUT_NAMES.forEach((n, i) => { d.inputs[n] = !!(d.in >> i & 1); d.inputsValid[n] = !!(d.valid >> i & 1); });
        OUTPUT_NAMES.forEach((n, i) => { d.outputs[n] = !!(d.out >> i & 1); });
        d.faultName = faultName(d.fault); d.faultTitle = faultTitle(d.fault); d.faultText = faultText(d.fault);
        d.srcName = SRC_NAMES[d.src] || "?"; d.ctlName = CTL_NAMES[d.ctl] || "?"; d.linkName = LINK_NAMES[d.link] || "?";
        d.b1 = d.v12; d.b2 = +(d.v24 - d.v12).toFixed(2); d.b3 = +(d.v36 - d.v24).toFixed(2);
        return { kind: "tlm", data: d };
      }
      case "DRV": {
        if (Number(p[1]) !== DRV_VERSION) return { kind: "err", data: { reason: `DRV v${p[1]}` } };
        const vals = p.slice(3);
        if (vals.length < DRV_FIELDS.length) return { kind: "err", data: { reason: "short DRV" } };
        const d = { seq: Number(p[2]) };
        DRV_FIELDS.forEach(([k, t], i) => { d[k] = conv(t, vals[i]); });
        d.gated = !!(d.gate & 1); d.radioEstop = !!(d.gate & 2); d.restartReq = !!(d.gate & 4);
        return { kind: "drv", data: d };
      }
      case "EVT": {
        if (Number(p[1]) !== EVT_VERSION) return { kind: "err", data: { reason: `EVT v${p[1]}` } };
        const d = { ts: Number(p[2]), kind: p[3], a: p[4] || "", b: p.slice(5).join(",") };
        if (d.kind === "FAULT" || d.kind === "WARN") { d.code = Number(d.b); d.title = faultTitle(d.code); d.text = faultText(d.code); }
        return { kind: "evt", data: d };
      }
      case "CFG": return { kind: "cfg", data: { key: p[1], value: Number(p[2]) } };
      case "FLT": { const [title, text] = fltTitleText(+p[2], p[3]);
        return { kind: "flt", data: { i: +p[1], code: +p[2], name: p[3], boot: +p[4], uptime: +p[5],
                                       vpack: +p[6], detail: +p[7], title, text } }; }
      case "FDEF": learnFault(+p[1], p[2], p[3] === "1"); return { kind: "fdef", data: { code: +p[1], name: p[2], warn: p[3] === "1" } };
      case "ACK": return { kind: "ack", data: { what: p[1], args: p.slice(2) } };
      // AUTH,<token>: the unit minted this device its app-pairing token (it
      // just won a re-pair search); the app stores and replays it on connect.
      case "AUTH": return { kind: "auth", data: { token: p[1] } };
      // LINK,<secure>,<bond_stored>,<window_open>,<authorized> — the 4th field
      // (this connection holds control rights from the triple-press re-pair)
      // is absent on older firmware, which only grants rights by bonding.
      case "LINK": return { kind: "link", data: { bonded: p[1] === "1", hasBond: p[2] === "1", pairing: p[3] === "1", authorized: p[4] === "1" } };
      case "ERR": return { kind: "err", data: { what: p[1], args: p.slice(2), reason: p.slice(1).join(",") } };
    }
  } catch (e) {
    return { kind: "err", data: { reason: "parse: " + e, line } };
  }
  return { kind: "unknown", data: { line } };
}
