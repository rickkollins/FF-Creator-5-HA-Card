/**
 * Prism Flashforge Card
 * A Prism-style (glassmorphism / neumorphic) Home Assistant card for the
 * Flashforge Creator 5 Pro, with live sensor overlays on the printer image.
 *
 * Data sources
 *   - Moonraker integration (printer state, temps, job, layers, buttons)
 *   - Flashforge integration/add-on (chamber, light, door, filtration, camera)
 *   - AFC (Armored Turtle Automated Filament Control) lane data
 *
 * Install: copy this file and creator5pro.webp to /config/www/prism-flashforge/
 * and add /local/prism-flashforge/prism-flashforge-card.js as a JS module resource.
 */

const CARD_VERSION = "1.0.0";
const CARD_TAG = "prism-flashforge-card";
const EDITOR_TAG = "prism-flashforge-card-editor";

let DEFAULT_IMAGE = "/local/prism-flashforge/creator5pro.webp";
try {
  DEFAULT_IMAGE = new URL("./creator5pro.webp", import.meta.url).href;
} catch (_) {
  /* not loaded as a module – fall back to /local path */
}

const DEFAULTS = {
  name: "Creator 5 Pro",
  theme: "dark",
  show_camera: true,
  show_job: true,
  show_tools: true,
  show_afc: true,
  show_controls: true,
  show_fans: true,
  tint_spools: true,
  spool_lanes: [0, 1],
};

/* ------------------------------------------------------------------ *
 * Entity discovery specs
 *   src: search order – m = Moonraker device, f = Flashforge device
 *   d:   allowed domains
 *   p:   patterns tried in order against the entity_id
 *   x:   exclusion pattern
 * ------------------------------------------------------------------ */
const SPECS = {
  print_state: { src: "m", d: ["sensor"], p: [/_current_print_state$/, /_print_state$/] },
  printer_state: { src: "m", d: ["sensor"], p: [/_printer_state$/] },
  message: { src: "m", d: ["sensor"], p: [/_current_display_message$/, /_display_message$/, /_current_print_message$/] },
  ff_status: { src: "f", d: ["sensor"], p: [/_status$/, /_machine_status$/, /_state$/], x: /door|filament|fan|light/ },
  filename: { src: "m", d: ["sensor"], p: [/_filename$/, /_file_name$/] },
  progress: { src: "mf", d: ["sensor"], p: [/_progress$/, /_print_progress$/] },
  time_left: { src: "m", d: ["sensor"], p: [/_print_time_left$/, /_time_left$/, /_time_remaining$/] },
  eta: { src: "m", d: ["sensor"], p: [/_print_eta$/, /_eta$/] },
  duration: { src: "m", d: ["sensor"], p: [/_print_duration$/] },
  current_layer: { src: "mf", d: ["sensor"], p: [/_current_layer$/] },
  total_layer: { src: "mf", d: ["sensor"], p: [/_total_layers?$/] },
  speed_factor: { src: "m", d: ["sensor", "number"], p: [/_speed_factor$/] },
  nozzle_temp: { src: "mf", d: ["sensor"], p: [/_extruder_temperature$/, /_nozzle_temp(erature)?$/] },
  nozzle_target: { src: "mf", d: ["sensor", "number"], p: [/_extruder_target$/, /_nozzle_target(_temp(erature)?)?$/] },
  bed_temp: { src: "mf", d: ["sensor"], p: [/_bed_temperature$/, /_heater_bed_temperature$/, /_bed_temp$/] },
  bed_target: { src: "mf", d: ["sensor", "number"], p: [/_bed_target$/, /_bed_target_temp(erature)?$/] },
  chamber_temp: { src: "fm", d: ["sensor"], p: [/chamber.*temp/], x: /target/ },
  chamber_target: { src: "fm", d: ["sensor", "number"], p: [/chamber.*target/] },
  part_fan: {
    src: "m", d: ["sensor", "fan"], p: [/_fan_speed$/, /part_fan/, /cooling_fan/],
    x: /chamber|exhaust|external|aux|side|heater|controller|hotend|filter/,
  },
  aux_fan: { src: "mf", d: ["sensor", "fan"], p: [/aux(iliary)?_fan/, /side_fan/] },
  chamber_fan: { src: "fm", d: ["sensor", "fan", "switch"], p: [/(chamber|exhaust|external)_fan/] },
  light: { src: "fm", d: ["light", "switch"], p: [/light/, /_led/, /lamp/], x: /status_led|filament|lane/ },
  door: { src: "fm", d: ["binary_sensor", "sensor"], p: [/door/] },
  filtration: { src: "fm", d: ["switch", "fan", "select"], p: [/filtration/, /filter/] },
  camera: { src: "fm", d: ["camera"], p: [/^(?!.*thumbnail).*$/] },
  thumbnail: { src: "m", d: ["camera", "image"], p: [/thumbnail/] },
  pause_button: { src: "m", d: ["button"], p: [/_pause(_print)?$/] },
  resume_button: { src: "m", d: ["button"], p: [/_resume(_print)?$/] },
  cancel_button: { src: "m", d: ["button"], p: [/_cancel(_print)?$/, /_stop_print$/] },
  estop_button: { src: "m", d: ["button"], p: [/_emergency_stop$/, /_estop$/] },
  active_tool: { src: "m", d: ["sensor"], p: [/_toolhead_extruder$/, /_active_extruder$/, /_active_tool$/, /_current_tool$/] },
  afc_current_lane: { src: "m", d: ["sensor"], p: [/afc.*current_(lane|load)$/] },
};

const STATUS = {
  printing: { label: "Printing", color: "#4fc3f7", icon: "mdi:printer-3d-nozzle" },
  paused: { label: "Paused", color: "#ffb74d", icon: "mdi:pause-circle" },
  complete: { label: "Complete", color: "#81c784", icon: "mdi:check-circle" },
  cancelled: { label: "Cancelled", color: "#9e9e9e", icon: "mdi:close-circle" },
  error: { label: "Error", color: "#e57373", icon: "mdi:alert-circle" },
  shutdown: { label: "Shutdown", color: "#e57373", icon: "mdi:power-plug-off" },
  startup: { label: "Starting", color: "#ba68c8", icon: "mdi:progress-clock" },
  heating: { label: "Heating", color: "#ff8a65", icon: "mdi:fire" },
  standby: { label: "Idle", color: "#9e9e9e", icon: "mdi:printer-3d" },
  offline: { label: "Offline", color: "#616161", icon: "mdi:lan-disconnect" },
};

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */
const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const domainOf = (id) => id.split(".")[0];
const BAD = ["unavailable", "unknown", "none", ""];
const isBad = (s) => !s || BAD.includes(String(s.state).toLowerCase());
const isEntityId = (v) => typeof v === "string" && /^[a-z_]+\.[a-z0-9_]+$/.test(v);

function normColor(v) {
  if (v == null) return null;
  if (Array.isArray(v) && v.length >= 3) return `rgb(${v[0]},${v[1]},${v[2]})`;
  const s = String(v).trim();
  if (/^#?[0-9a-f]{6}([0-9a-f]{2})?$/i.test(s)) return "#" + s.replace("#", "").slice(0, 6);
  if (/^#?[0-9a-f]{3}$/i.test(s)) return "#" + s.replace("#", "");
  if (/^(rgb|hsl)a?\(/i.test(s)) return s;
  if (/^[a-z]+$/i.test(s) && !BAD.includes(s.toLowerCase())) return s.toLowerCase();
  return null;
}

function fmtDuration(sec) {
  if (sec == null || isNaN(sec) || sec < 0) return null;
  sec = Math.round(sec);
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m) return `${m}m`;
  return "<1m";
}

function toSeconds(stateObj) {
  if (isBad(stateObj)) return null;
  const raw = String(stateObj.state);
  if (/^\d+:\d{2}(:\d{2})?$/.test(raw)) {
    const p = raw.split(":").map(Number);
    return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 3600 + p[1] * 60;
  }
  const v = parseFloat(raw);
  if (isNaN(v)) return null;
  const u = (stateObj.attributes.unit_of_measurement || "s").toLowerCase();
  if (u.startsWith("d")) return v * 86400;
  if (u.startsWith("h")) return v * 3600;
  if (u.startsWith("min") || u === "m") return v * 60;
  if (u.startsWith("ms")) return v / 1000;
  return v;
}

function fmtEta(stateObj) {
  if (isBad(stateObj)) return null;
  const d = new Date(stateObj.state);
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return d.toDateString() === now.toDateString()
    ? time
    : `${d.toLocaleDateString([], { weekday: "short" })} ${time}`;
}

const fmtTemp = (t, target) =>
  t == null ? "--°" : `${Math.round(t)}°${target ? `<span class="tgt">/${Math.round(target)}°</span>` : ""}`;

/* ------------------------------------------------------------------ *
 * Styles
 * ------------------------------------------------------------------ */
const STYLE = `
:host {
  display: block;
}
ha-card {
  --pf-accent: #4fc3f7;
  --pf-bg: rgba(30, 32, 36, 0.6);
  --pf-border: rgba(255, 255, 255, 0.08);
  --pf-text: rgba(255, 255, 255, 0.92);
  --pf-muted: rgba(255, 255, 255, 0.5);
  --pf-faint: rgba(255, 255, 255, 0.06);
  --pf-pill: rgba(18, 20, 24, 0.62);
  --pf-pill-border: rgba(255, 255, 255, 0.1);
  --pf-raised: 4px 4px 10px rgba(0, 0, 0, 0.4), -1px -1px 3px rgba(255, 255, 255, 0.04);
  --pf-inset: inset 2px 2px 5px rgba(0, 0, 0, 0.5), inset -1px -1px 2px rgba(255, 255, 255, 0.06);
  --pf-well: rgba(0, 0, 0, 0.22);
  background: var(--pf-bg);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid var(--pf-border);
  border-radius: 24px;
  box-shadow: 0 10px 30px -5px rgba(0, 0, 0, 0.3);
  color: var(--pf-text);
  overflow: hidden;
  font-family: var(--paper-font-body1_-_font-family, inherit);
}
ha-card[data-theme="light"] {
  --pf-bg: rgba(255, 255, 255, 0.55);
  --pf-border: rgba(255, 255, 255, 0.6);
  --pf-text: rgba(20, 22, 26, 0.9);
  --pf-muted: rgba(20, 22, 26, 0.5);
  --pf-faint: rgba(0, 0, 0, 0.05);
  --pf-pill: rgba(255, 255, 255, 0.72);
  --pf-pill-border: rgba(0, 0, 0, 0.06);
  --pf-raised: 4px 4px 10px rgba(0, 0, 0, 0.1), -3px -3px 8px rgba(255, 255, 255, 0.8);
  --pf-inset: inset 2px 2px 5px rgba(0, 0, 0, 0.1), inset -2px -2px 5px rgba(255, 255, 255, 0.8);
  --pf-well: rgba(0, 0, 0, 0.04);
  box-shadow: 0 10px 30px -5px rgba(0, 0, 0, 0.12);
}
.wrap { padding: 16px; display: flex; flex-direction: column; gap: 14px; }

/* Header */
.header { display: flex; align-items: center; gap: 12px; }
.h-icon {
  width: 42px; height: 42px; border-radius: 50%; flex: none;
  display: flex; align-items: center; justify-content: center;
  background: var(--pf-well); box-shadow: var(--pf-inset);
  color: var(--st-color); --mdc-icon-size: 22px;
}
.h-icon.on { filter: drop-shadow(0 0 6px var(--st-color)); }
.h-text { flex: 1; min-width: 0; }
.h-name { font-size: 1.05rem; font-weight: 600; letter-spacing: 0.01em; }
.h-sub { font-size: 0.8rem; color: var(--pf-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.badge {
  display: flex; align-items: center; gap: 6px; flex: none;
  padding: 5px 11px; border-radius: 999px; font-size: 0.75rem; font-weight: 600;
  background: var(--pf-well); box-shadow: var(--pf-inset); color: var(--st-color);
}
.badge .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--st-color); box-shadow: 0 0 8px var(--st-color); }
.badge.pulse .dot { animation: pulse 1.6s ease-in-out infinite; }

/* Stage */
.stage {
  position: relative; border-radius: 18px; overflow: hidden;
  aspect-ratio: 1 / 0.91; container-type: inline-size;
  background: radial-gradient(ellipse at 50% 45%, rgba(255,255,255,0.05), transparent 70%), var(--pf-well);
  box-shadow: var(--pf-inset);
}
.stage-inner { position: relative; width: 100%; aspect-ratio: 1; margin-top: -4%; }
.printer { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; pointer-events: none; user-select: none; }
.stage.camera .stage-inner { visibility: hidden; }
#cam { position: absolute; inset: 0; display: none; background: #000; }
.stage.camera #cam { display: flex; align-items: center; justify-content: center; }
#cam ha-camera-stream, #cam img { width: 100%; height: 100%; object-fit: contain; }
.cam-empty { color: var(--pf-muted); font-size: 0.85rem; }

.chamber-light {
  position: absolute; left: 24.2%; top: 43.6%; width: 41.2%; height: 44.4%;
  background: radial-gradient(ellipse at 50% 0%, rgba(255, 244, 214, 0.42), rgba(255, 244, 214, 0.08) 55%, transparent 80%);
  mix-blend-mode: screen; opacity: 0; transition: opacity 0.4s ease; pointer-events: none;
}
.chamber-light.on { opacity: 1; }

.spool {
  position: absolute; left: 74.1%; width: 7%; border-radius: 2px; pointer-events: none;
  background:
    repeating-linear-gradient(0deg, rgba(0,0,0,0.14) 0 1px, transparent 1px 3px),
    linear-gradient(90deg, rgba(0,0,0,0.45), rgba(255,255,255,0.18) 38%, rgba(255,255,255,0.05) 60%, rgba(0,0,0,0.42)),
    var(--c);
}
.spool.s0 { top: 40.3%; height: 21.6%; }
.spool.s1 { top: 65.3%; height: 23.1%; }
.spool.empty { --c: #2a2c30 !important; opacity: 0.85; }

.screen {
  position: absolute; left: 55.5%; top: 34.4%; width: 13.4%; height: 7.2%;
  border-radius: 3px; background: #0d0f12; color: #e8f4ff;
  display: flex; align-items: center; justify-content: center; gap: 3%;
  font-size: clamp(7px, 1.9cqw, 11px); font-weight: 600; cursor: pointer;
  box-shadow: inset 0 0 0 1px rgba(255,255,255,0.06);
}
.screen ha-icon { --mdc-icon-size: clamp(8px, 2.2cqw, 13px); color: var(--st-color); }
.screen .mini-bar { position: absolute; left: 6%; right: 6%; bottom: 12%; height: 6%; border-radius: 2px; background: rgba(255,255,255,0.12); overflow: hidden; }
.screen .mini-bar i { display: block; height: 100%; background: var(--st-color); }

.pill {
  position: absolute; display: inline-flex; align-items: center; gap: 4px;
  transform: translate(-50%, -50%); white-space: nowrap;
  padding: 0.28em 0.7em 0.28em 0.5em; border-radius: 999px;
  font-size: clamp(9.5px, 2.65cqw, 13px); font-weight: 600; line-height: 1.2;
  color: var(--pf-text); background: var(--pf-pill);
  backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
  border: 1px solid var(--pf-pill-border);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
  cursor: pointer; transition: transform 0.15s ease, box-shadow 0.2s ease;
}
.pill.l { transform: translate(0, -50%); }
.pill:hover { box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35), 0 0 0 1px var(--pf-accent); }
.pill ha-icon { --mdc-icon-size: 1.25em; color: var(--ic, var(--pf-muted)); }
.pill .tgt { color: var(--pf-muted); font-weight: 500; margin-left: 1px; }
.pill .lbl { color: var(--pf-muted); font-weight: 500; }
.pill.heating { --ic: #ff8a65; box-shadow: 0 0 0 1px rgba(255,138,101,0.5), 0 0 14px rgba(255,138,101,0.35); }
.pill.hot { --ic: #ff7043; }
.pill.round { padding: 0.35em; }
.pill.warn { --ic: #ffb74d; box-shadow: 0 0 0 1px rgba(255,183,77,0.55), 0 0 12px rgba(255,183,77,0.3); }
.pill .sw { width: 0.8em; height: 0.8em; border-radius: 50%; background: var(--c); box-shadow: 0 0 0 1px rgba(255,255,255,0.25); }
.spin ha-icon { animation: spin var(--spd, 1s) linear infinite; }

.stage-btns { position: absolute; top: 10px; right: 10px; display: flex; gap: 8px; z-index: 2; }
.sbtn {
  width: 34px; height: 34px; border-radius: 50%; border: 1px solid var(--pf-pill-border);
  background: var(--pf-pill); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
  color: var(--pf-text); display: flex; align-items: center; justify-content: center;
  cursor: pointer; --mdc-icon-size: 18px; box-shadow: 0 4px 12px rgba(0,0,0,0.25);
}
.sbtn.on { color: #ffd54f; box-shadow: 0 0 0 1px rgba(255,213,79,0.5), 0 0 14px rgba(255,213,79,0.35); }
.sbtn.active { color: var(--pf-accent); box-shadow: 0 0 0 1px var(--pf-accent); }

/* Sections */
.section { background: var(--pf-faint); border-radius: 16px; padding: 12px; }
.sec-title { display: flex; justify-content: space-between; align-items: center; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--pf-muted); margin-bottom: 10px; font-weight: 600; }

.job { display: flex; gap: 12px; align-items: center; }
.thumb {
  width: 52px; height: 52px; border-radius: 12px; flex: none; overflow: hidden;
  background: var(--pf-well); box-shadow: var(--pf-inset);
  display: flex; align-items: center; justify-content: center; color: var(--pf-muted); cursor: pointer;
}
.thumb img { width: 100%; height: 100%; object-fit: cover; }
.job-main { flex: 1; min-width: 0; }
.job-top { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; }
.file { font-size: 0.88rem; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pct { font-size: 1.1rem; font-weight: 700; color: var(--st-color); }
.bar { height: 8px; border-radius: 999px; background: var(--pf-well); box-shadow: var(--pf-inset); margin: 7px 0; overflow: hidden; }
.bar .fill {
  height: 100%; border-radius: 999px;
  background: linear-gradient(90deg, color-mix(in srgb, var(--st-color) 60%, transparent), var(--st-color));
  box-shadow: 0 0 10px var(--st-color); transition: width 0.6s ease;
}
.job-meta { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 0.75rem; color: var(--pf-muted); }
.job-meta span { display: inline-flex; align-items: center; gap: 4px; --mdc-icon-size: 14px; }

.tools { display: grid; grid-template-columns: repeat(auto-fit, minmax(68px, 1fr)); gap: 8px; }
.tool {
  border-radius: 12px; padding: 8px 6px; text-align: center; cursor: pointer;
  background: var(--pf-well); box-shadow: var(--pf-inset); position: relative;
}
.tool.active { box-shadow: var(--pf-inset), 0 0 0 1.5px var(--pf-accent); }
.tool .tn { font-size: 0.7rem; color: var(--pf-muted); display: flex; align-items: center; justify-content: center; gap: 5px; }
.tool .tt { font-size: 0.95rem; font-weight: 700; margin-top: 2px; }
.tool .tt .tgt { font-size: 0.72rem; color: var(--pf-muted); font-weight: 500; }
.tool .sw { width: 9px; height: 9px; border-radius: 50%; background: var(--c); box-shadow: 0 0 0 1px rgba(255,255,255,0.25); }

.lanes { display: grid; grid-template-columns: repeat(auto-fit, minmax(72px, 1fr)); gap: 8px; }
.lane {
  border-radius: 14px; padding: 10px 6px 8px; text-align: center; cursor: pointer; position: relative;
  background: var(--pf-well); box-shadow: var(--pf-inset); transition: box-shadow 0.2s ease;
}
.lane.active { box-shadow: var(--pf-inset), 0 0 0 1.5px var(--c), 0 0 18px -4px var(--c); }
.reel {
  width: 40px; height: 40px; margin: 0 auto 6px; border-radius: 50%; position: relative;
  background:
    radial-gradient(circle, #1b1d21 0 18%, rgba(255,255,255,0.35) 19% 22%, transparent 23%),
    repeating-radial-gradient(circle, rgba(0,0,0,0.12) 0 1px, transparent 1px 3px),
    radial-gradient(circle at 35% 30%, rgba(255,255,255,0.35), transparent 55%),
    var(--c);
  box-shadow: 0 0 0 3px rgba(0,0,0,0.35), 0 3px 8px rgba(0,0,0,0.35);
}
.lane.empty .reel { background: radial-gradient(circle, #1b1d21 0 18%, rgba(255,255,255,0.25) 19% 22%, transparent 23%), #34373c; opacity: 0.55; }
.lane .ln { font-size: 0.72rem; color: var(--pf-muted); font-weight: 600; }
.lane .lm { font-size: 0.85rem; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lane .lw { font-size: 0.7rem; color: var(--pf-muted); }
.lane .ls { display: inline-flex; align-items: center; gap: 4px; margin-top: 3px; font-size: 0.65rem; color: var(--pf-muted); text-transform: uppercase; letter-spacing: 0.04em; }
.lane .ls i { width: 6px; height: 6px; border-radius: 50%; background: var(--lc, #757575); box-shadow: 0 0 6px var(--lc, transparent); }
.lane .tag {
  position: absolute; top: 6px; right: 6px; font-size: 0.58rem; font-weight: 700; padding: 1px 5px;
  border-radius: 6px; background: var(--c); color: var(--tc, #000);
}

.controls { display: flex; justify-content: center; gap: 14px; flex-wrap: wrap; }
.cbtn {
  display: flex; flex-direction: column; align-items: center; gap: 5px; cursor: pointer;
  font-size: 0.68rem; color: var(--pf-muted); background: none; border: none; padding: 0; font-family: inherit;
}
.cbtn .ci {
  width: 46px; height: 46px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
  background: var(--pf-bg); box-shadow: var(--pf-raised); color: var(--pf-text); --mdc-icon-size: 22px;
  transition: box-shadow 0.15s ease, color 0.2s ease;
}
.cbtn:active .ci, .cbtn.on .ci { box-shadow: var(--pf-inset); }
.cbtn.on .ci { color: var(--bc, var(--pf-accent)); filter: drop-shadow(0 0 5px var(--bc, var(--pf-accent))); }
.cbtn.danger .ci { color: #e57373; }
.warn-box { font-size: 0.8rem; color: #ffb74d; padding: 8px 12px; border-radius: 12px; background: rgba(255,183,77,0.08); }

@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
@keyframes spin { to { transform: rotate(360deg); } }
`;

/* ------------------------------------------------------------------ *
 * Card
 * ------------------------------------------------------------------ */
class PrismFlashforgeCard extends HTMLElement {
  static getConfigElement() {
    return document.createElement(EDITOR_TAG);
  }

  static getStubConfig(hass) {
    const ent = hass && hass.entities ? Object.values(hass.entities).find((e) => e.platform === "moonraker" && e.device_id) : null;
    return { name: "Creator 5 Pro", printer: ent ? ent.device_id : "" };
  }

  setConfig(config) {
    if (!config) throw new Error("Invalid configuration");
    this._config = { ...DEFAULTS, ...config };
    this._cache = null;
    this._parts = {};
    this._view = this._view || "image";
    this._ensureDom();
    if (this._hass) this._update();
  }

  set hass(hass) {
    this._hass = hass;
    this._update();
  }

  getCardSize() {
    return 10;
  }

  getGridOptions() {
    return { columns: 12, min_columns: 6 };
  }

  _ensureDom() {
    if (this._root) return;
    this._root = this.attachShadow({ mode: "open" });
    this._root.innerHTML = `
      <style>${STYLE}</style>
      <ha-card>
        <div class="wrap">
          <div id="header"></div>
          <div class="stage" id="stage">
            <div class="stage-inner" id="overlay"></div>
            <div id="cam"></div>
            <div class="stage-btns" id="sbtns"></div>
          </div>
          <div id="rest"></div>
        </div>
      </ha-card>`;
    this._root.addEventListener("click", (ev) => this._onClick(ev));
  }

  /* ---------------- entity resolution ---------------- */

  _lists() {
    const h = this._hass;
    const sig = `${Object.keys(h.states).length}|${h.entities ? Object.keys(h.entities).length : 0}`;
    if (this._cache && this._cache.sig === sig && this._cache.entities === h.entities) return this._cache;

    const c = this._config;
    const reg = h.entities ? Object.values(h.entities) : [];
    const byDevice = (dev) =>
      dev ? reg.filter((e) => e.device_id === dev).map((e) => e.entity_id).filter((id) => h.states[id]) : [];

    // Moonraker printer: device id, or a prefix string, or auto-detected
    let moonDev = null;
    let prefix = c.prefix || null;
    if (c.printer) {
      if ((h.devices && h.devices[c.printer]) || /^[0-9a-f]{32}$/i.test(c.printer)) moonDev = c.printer;
      else prefix = prefix || c.printer;
    } else if (!prefix) {
      const auto = reg.find((e) => e.platform === "moonraker" && e.device_id);
      if (auto) moonDev = auto.device_id;
    }

    let ffDev = c.flashforge_device || null;
    if (!ffDev && c.flashforge_device !== false && !c.flashforge_prefix) {
      const auto = reg.find((e) => e.platform && /flashforge/i.test(e.platform) && e.device_id);
      if (auto) ffDev = auto.device_id;
    }

    const byPrefix = (p) => {
      if (!p) return [];
      const pp = p.replace(/^[a-z_]+\./, "").toLowerCase() + "_";
      return Object.keys(h.states).filter((id) => id.split(".")[1].startsWith(pp));
    };

    const moon = [...new Set([...byDevice(moonDev), ...byPrefix(prefix)])];
    const ff = [...new Set([...byDevice(ffDev), ...byPrefix(c.flashforge_prefix)])];

    this._cache = { sig, entities: h.entities, moon, ff, moonDev, ffDev, prefix, resolved: {} };
    return this._cache;
  }

  _resolve(key) {
    const ov = this._config.entities && this._config.entities[key];
    if (ov) return ov;
    const L = this._lists();
    if (key in L.resolved) return L.resolved[key];
    const spec = SPECS[key];
    let hit = null;
    if (spec) {
      outer: for (const src of spec.src) {
        const pool = src === "m" ? L.moon : L.ff;
        for (const re of spec.p) {
          const id = pool.find((e) => spec.d.includes(domainOf(e)) && re.test(e) && !(spec.x && spec.x.test(e)));
          if (id) {
            hit = id;
            break outer;
          }
        }
      }
    }
    L.resolved[key] = hit;
    return hit;
  }

  /* ---------------- data model ---------------- */

  _st(id) {
    return id ? this._hass.states[id] : undefined;
  }

  _num(id) {
    const s = this._st(id);
    if (isBad(s)) return null;
    const v = parseFloat(s.state);
    return isNaN(v) ? null : v;
  }

  _pct(id) {
    const s = this._st(id);
    if (!s) return null;
    const d = domainOf(id);
    if (d === "fan") return s.state === "on" ? s.attributes.percentage ?? 100 : 0;
    if (d === "switch" || d === "light") return s.state === "on" ? 100 : 0;
    const v = this._num(id);
    if (v == null) return null;
    const unit = s.attributes.unit_of_measurement;
    return unit !== "%" && v <= 1 ? Math.round(v * 100) : Math.round(v);
  }

  _tools() {
    const L = this._lists();
    const map = new Map();
    for (const id of L.moon) {
      if (!id.startsWith("sensor.")) continue;
      const m = id.match(/_extruder(\d*)_temperature$/);
      if (!m) continue;
      const idx = m[1] === "" ? 0 : parseInt(m[1], 10);
      if (map.has(idx)) continue;
      const base = id.replace(/_temperature$/, "_target");
      const tgtId = [base, base.replace(/^sensor\./, "number.")].find((t) => this._hass.states[t]);
      map.set(idx, { idx, id, temp: this._num(id), target: this._num(tgtId), targetId: tgtId });
    }
    return [...map.values()].sort((a, b) => a.idx - b.idx);
  }

  _laneValue(v) {
    if (v == null) return null;
    if (isEntityId(v) && this._hass.states[v]) {
      const s = this._hass.states[v];
      if (isBad(s)) return null;
      return s.attributes.rgb_color && /color|colour/.test(v) ? s.attributes.rgb_color : s.state;
    }
    return v;
  }

  _afc() {
    const c = this._config;
    const afcCfg = c.afc || {};
    const L = this._lists();
    let lanes = [];
    let current = null;
    let state = null;

    const curId = afcCfg.current_lane || this._resolve("afc_current_lane");
    const curState = this._st(curId);
    if (!isBad(curState)) current = curState.state;

    // 1) explicit lanes in YAML
    if (Array.isArray(afcCfg.lanes) && afcCfg.lanes.length) {
      lanes = afcCfg.lanes.map((l, i) => {
        const loaded = this._laneValue(l.loaded);
        return {
          name: l.name || `lane${i + 1}`,
          color: normColor(this._laneValue(l.color)),
          material: this._laneValue(l.material),
          weight: this._laneValue(l.weight),
          status: this._laneValue(l.status),
          tool: l.tool ?? l.map ?? null,
          active: loaded != null ? ["on", "true", "loaded", "1"].includes(String(loaded).toLowerCase()) : null,
          entity: [l.color, l.status, l.material].find((x) => isEntityId(x)) || null,
        };
      });
    }

    // 2) one entity whose attributes hold the Moonraker AFC objects (REST sensor)
    const afcEnt = afcCfg.entity ? this._st(afcCfg.entity) : null;
    if (!lanes.length && afcEnt && afcEnt.attributes) {
      let a = afcEnt.attributes;
      if (a.result && a.result.status) a = a.result.status;
      else if (a.status && typeof a.status === "object") a = a.status;
      const root = a.AFC || a.afc || {};
      const objs = {};
      for (const [k, v] of Object.entries(a)) {
        const m = k.match(/^AFC_(?:stepper|lane)\s+(.+)$/i);
        if (m && v && typeof v === "object") objs[m[1]] = v;
      }
      if (Array.isArray(a.lanes) && a.lanes.length && typeof a.lanes[0] === "object") {
        a.lanes.forEach((v, i) => (objs[v.name || `lane${i + 1}`] = v));
      } else if (a.lanes && typeof a.lanes === "object" && !Array.isArray(a.lanes)) {
        Object.entries(a.lanes).forEach(([k, v]) => v && typeof v === "object" && (objs[k] = v));
      }
      const order = Array.isArray(root.lanes) && root.lanes.length ? root.lanes.filter((n) => objs[n]) : Object.keys(objs).sort((x, y) => x.localeCompare(y, undefined, { numeric: true }));
      current = current || root.current_load || root.current_lane || a.current_load || null;
      state = root.current_state || root.state || null;
      lanes = order.map((name) => {
        const l = objs[name];
        const status = l.filament_status || l.status || null;
        const sensed = l.load ?? l.prep;
        return {
          name,
          color: normColor(l.color),
          material: l.material || null,
          weight: l.weight ?? null,
          status,
          tool: l.map || null,
          extruder: l.extruder || null,
          active: l.tool_loaded === true ? true : null,
          empty: sensed === false || /empty/i.test(status || ""),
          ready: l.prep === true && l.load === true,
          entity: afcCfg.entity,
        };
      });
    }

    // 3) auto-discover lane entities (e.g. sensor.<printer>_lane1_color)
    if (!lanes.length) {
      const pool = [...new Set([...L.moon, ...L.ff, ...Object.keys(this._hass.states).filter((id) => /afc/.test(id) && /lane/.test(id))])];
      const groups = {};
      for (const id of pool) {
        const m = id.match(/[._](?:afc_)?(lane_?\d+)_(color|colour|material|weight|remaining_weight|status|loaded|tool_loaded|map)$/);
        if (!m) continue;
        const name = m[1].replace("_", "");
        const g = (groups[name] = groups[name] || {});
        const k = { colour: "color", remaining_weight: "weight", tool_loaded: "loaded" }[m[2]] || m[2];
        if (!g[k]) g[k] = id;
      }
      lanes = Object.keys(groups)
        .sort((x, y) => x.localeCompare(y, undefined, { numeric: true }))
        .map((name) => {
          const g = groups[name];
          const loaded = this._laneValue(g.loaded);
          const status = this._laneValue(g.status);
          return {
            name,
            color: normColor(this._laneValue(g.color)),
            material: this._laneValue(g.material),
            weight: this._laneValue(g.weight),
            status,
            tool: this._laneValue(g.map),
            active: loaded != null ? ["on", "true", "loaded"].includes(String(loaded).toLowerCase()) : null,
            empty: /empty/i.test(status || ""),
            entity: g.color || g.status || g.material,
          };
        });
    }

    for (const l of lanes) {
      if (l.active == null) l.active = !!current && String(current).toLowerCase() === l.name.toLowerCase();
      if (l.empty == null) l.empty = /empty/i.test(l.status || "");
      const w = parseFloat(l.weight);
      l.weightTxt = isNaN(w) ? null : `${Math.round(w)} g`;
      l.short = (l.name.match(/(\d+)$/) || [null, l.name])[1];
    }
    return { lanes, current, state };
  }

  _model() {
    const c = this._config;
    const r = (k) => this._resolve(k);
    const L = this._lists();

    const printStateObj = this._st(r("print_state"));
    const printerStateObj = this._st(r("printer_state"));
    const ffStatusObj = this._st(r("ff_status"));
    const ps = isBad(printStateObj) ? null : String(printStateObj.state).toLowerCase();
    const prs = isBad(printerStateObj) ? null : String(printerStateObj.state).toLowerCase();

    let key;
    if (!ps && !prs && isBad(ffStatusObj)) key = "offline";
    else if (prs && ["shutdown", "error", "startup"].includes(prs)) key = prs;
    else if (ps && STATUS[ps]) key = ps;
    else if (ps === "printing" || /print|busy|building/.test(ps || "")) key = "printing";
    else if (!ps && ffStatusObj && !isBad(ffStatusObj)) {
      const f = String(ffStatusObj.state).toLowerCase();
      key = /print|build/.test(f) ? "printing" : /pause/.test(f) ? "paused" : /error/.test(f) ? "error" : /complete|finish/.test(f) ? "complete" : "standby";
    } else key = "standby";

    const tools = this._tools();
    const afc = c.show_afc || c.tint_spools ? this._afc() : { lanes: [] };

    // active tool
    let activeIdx = 0;
    const atObj = this._st(r("active_tool"));
    if (!isBad(atObj)) {
      const m = String(atObj.state).match(/(\d+)/);
      activeIdx = m ? parseInt(m[1], 10) : 0;
    } else {
      const al = afc.lanes.find((l) => l.active);
      const ref = al && (al.extruder || al.tool);
      const m = ref && String(ref).match(/(\d+)/);
      if (m) activeIdx = parseInt(m[1], 10);
    }

    // nozzle (active tool on toolchangers)
    const ov = c.entities || {};
    let nozzleId = r("nozzle_temp");
    let nozzleTargetId = r("nozzle_target");
    const activeTool = tools.find((t) => t.idx === activeIdx) || tools[0];
    if (tools.length > 1 && activeTool && !ov.nozzle_temp) {
      nozzleId = activeTool.id;
      nozzleTargetId = activeTool.targetId;
    }
    const nozzle = { id: nozzleId, temp: this._num(nozzleId), target: this._num(nozzleTargetId) };
    const bed = { id: r("bed_temp"), temp: this._num(r("bed_temp")), target: this._num(r("bed_target")) };
    const chamber = { id: r("chamber_temp"), temp: this._num(r("chamber_temp")), target: this._num(r("chamber_target")) };

    const heating = [nozzle, bed].some((x) => x.target > 0 && x.temp != null && x.temp < x.target - 3);
    if (key === "standby" && heating) key = "heating";

    const progressId = r("progress");
    let progress = this._pct(progressId);
    if (progress != null) progress = Math.max(0, Math.min(100, progress));

    const lightId = r("light");
    const lightObj = this._st(lightId);
    const doorObj = this._st(r("door"));
    let doorOpen = null;
    if (!isBad(doorObj)) {
      const s = String(doorObj.state).toLowerCase();
      doorOpen = ["on", "open", "opened", "true"].includes(s);
    }
    const filtId = r("filtration");
    const filtObj = this._st(filtId);

    const filenameObj = this._st(r("filename"));
    const msgObj = this._st(r("message"));
    const thumbId = r("thumbnail");
    const thumbObj = this._st(thumbId);

    const fans = [
      { key: "part_fan", icon: "mdi:fan", label: "Part" },
      { key: "aux_fan", icon: "mdi:fan-chevron-up", label: "Aux" },
      { key: "chamber_fan", icon: "mdi:fan-speed-1", label: "Chamber" },
    ]
      .map((f) => ({ ...f, id: r(f.key) }))
      .filter((f) => f.id)
      .map((f) => ({ ...f, pct: this._pct(f.id) }));

    return {
      key,
      status: STATUS[key],
      ps,
      nozzle,
      bed,
      chamber,
      tools,
      activeIdx,
      progress,
      progressId,
      filename: isBad(filenameObj) ? null : String(filenameObj.state).replace(/\.gcode$/i, ""),
      message: isBad(msgObj) ? null : msgObj.state,
      timeLeft: fmtDuration(toSeconds(this._st(r("time_left")))),
      eta: fmtEta(this._st(r("eta"))),
      duration: fmtDuration(toSeconds(this._st(r("duration")))),
      layer: this._num(r("current_layer")),
      layers: this._num(r("total_layer")),
      speed: this._pct(r("speed_factor")),
      thumb: thumbObj && !isBad(thumbObj) ? thumbObj.attributes.entity_picture : null,
      thumbId,
      fans,
      light: lightId ? { id: lightId, on: lightObj && lightObj.state === "on" } : null,
      door: doorObj ? { id: r("door"), open: doorOpen } : null,
      filtration: filtId ? { id: filtId, on: filtObj && !["off", "unavailable", "unknown", "none", "close"].includes(String(filtObj.state).toLowerCase()), state: filtObj && filtObj.state } : null,
      camera: r("camera"),
      afc,
      buttons: {
        pause: r("pause_button"),
        resume: r("resume_button"),
        cancel: r("cancel_button"),
        estop: r("estop_button"),
      },
      found: L.moon.length + L.ff.length > 0 || Object.keys(c.entities || {}).length > 0,
    };
  }

  /* ---------------- rendering ---------------- */

  _update() {
    if (!this._hass || !this._config || !this._root) return;
    const m = this._model();
    const card = this._root.querySelector("ha-card");
    card.setAttribute("data-theme", this._config.theme === "light" ? "light" : "dark");
    card.style.setProperty("--st-color", m.status.color);
    if (this._config.accent_color) card.style.setProperty("--pf-accent", this._config.accent_color);

    this._set("header", this._renderHeader(m));
    this._set("overlay", this._renderOverlay(m));
    this._set("sbtns", this._renderStageButtons(m));
    this._set("rest", this._renderRest(m));

    const stage = this._root.getElementById("stage");
    const camMode = this._view === "camera" && !!m.camera;
    stage.classList.toggle("camera", camMode);
    this._updateCamera(camMode ? m.camera : null);
  }

  _set(id, html) {
    if (this._parts[id] === html) return;
    this._parts[id] = html;
    this._root.getElementById(id).innerHTML = html;
  }

  _renderHeader(m) {
    const live = ["printing", "heating", "paused"].includes(m.key);
    let sub = m.message || "";
    if (m.key === "printing" || m.key === "paused") sub = m.filename || sub;
    if (!sub) sub = m.key === "offline" ? "No connection to printer" : m.key === "heating" ? "Heating up" : "Ready";
    return `
      <div class="header">
        <div class="h-icon ${live ? "on" : ""}"><ha-icon icon="${m.status.icon}"></ha-icon></div>
        <div class="h-text">
          <div class="h-name">${esc(this._config.name)}</div>
          <div class="h-sub">${esc(sub)}</div>
        </div>
        <div class="badge ${live ? "pulse" : ""}"><span class="dot"></span>${m.status.label}${
      m.key === "printing" && m.progress != null ? ` · ${Math.round(m.progress)}%` : ""
    }</div>
      </div>`;
  }

  _renderOverlay(m) {
    const c = this._config;
    const out = [];
    out.push(`<img class="printer" src="${esc(c.image || DEFAULT_IMAGE)}" alt="">`);
    out.push(`<div class="chamber-light ${m.light && m.light.on ? "on" : ""}"></div>`);

    // Spools tinted with AFC lane colors
    if (c.tint_spools && m.afc.lanes.length) {
      (c.spool_lanes || [0, 1]).slice(0, 2).forEach((laneIdx, i) => {
        const l = m.afc.lanes[laneIdx];
        if (!l) return;
        out.push(`<div class="spool s${i} ${l.empty ? "empty" : ""}" style="--c:${esc(l.color || "#8a8d93")}"></div>`);
        const y = i === 0 ? 51 : 77;
        out.push(
          `<div class="pill l" style="left:82.6%;top:${y}%" data-action="more" data-entity="${esc(l.entity || "")}">` +
            `<span class="sw" style="--c:${esc(l.color || "#8a8d93")}"></span>${esc(l.short)}` +
            `${l.material ? ` <span class="lbl">${esc(l.material)}</span>` : ""}</div>`
        );
      });
    }

    // Touch-screen mirror
    const scrIcon = m.status.icon;
    const scrTxt =
      m.key === "printing" || m.key === "paused" ? `${Math.round(m.progress || 0)}%` : m.status.label;
    out.push(
      `<div class="screen" data-action="more" data-entity="${esc(m.progressId || this._resolve("print_state") || "")}">` +
        `<ha-icon icon="${scrIcon}"></ha-icon><span>${esc(scrTxt)}</span>` +
        (m.key === "printing" || m.key === "paused"
          ? `<div class="mini-bar"><i style="width:${m.progress || 0}%"></i></div>`
          : "") +
        `</div>`
    );

    // Nozzle – next to the toolhead
    const nozHeat = m.nozzle.target > 0 && m.nozzle.temp != null && m.nozzle.temp < m.nozzle.target - 3;
    const toolTag = m.tools.length > 1 ? `<span class="lbl">T${m.activeIdx}</span>` : "";
    if (m.nozzle.id)
      out.push(
        `<div class="pill l ${nozHeat ? "heating" : m.nozzle.target > 0 ? "hot" : ""}" style="left:52%;top:47.5%" data-action="more" data-entity="${esc(m.nozzle.id)}">` +
          `<ha-icon icon="mdi:printer-3d-nozzle-heat"></ha-icon>${toolTag}${fmtTemp(m.nozzle.temp, m.nozzle.target)}</div>`
      );

    // Bed – on the build plate
    const bedHeat = m.bed.target > 0 && m.bed.temp != null && m.bed.temp < m.bed.target - 3;
    if (m.bed.id)
      out.push(
        `<div class="pill ${bedHeat ? "heating" : m.bed.target > 0 ? "hot" : ""}" style="left:44.5%;top:80.5%" data-action="more" data-entity="${esc(m.bed.id)}">` +
          `<ha-icon icon="mdi:radiator"></ha-icon>${fmtTemp(m.bed.temp, m.bed.target)}</div>`
      );

    // Chamber + fans – left column inside the enclosure
    let y = 55;
    if (m.chamber.id) {
      out.push(
        `<div class="pill l" style="left:25.6%;top:${y}%" data-action="more" data-entity="${esc(m.chamber.id)}">` +
          `<ha-icon icon="mdi:home-thermometer-outline"></ha-icon>${fmtTemp(m.chamber.temp, m.chamber.target)}</div>`
      );
      y += 6.5;
    }
    if (c.show_fans) {
      for (const f of m.fans) {
        const on = f.pct > 0;
        const spd = on ? Math.max(0.35, 2.2 - (f.pct / 100) * 1.8).toFixed(2) : 0;
        out.push(
          `<div class="pill l ${on ? "spin" : ""}" style="left:25.6%;top:${y}%;--spd:${spd}s;${on ? "--ic:var(--pf-accent)" : ""}" data-action="more" data-entity="${esc(f.id)}">` +
            `<ha-icon icon="${f.icon}"></ha-icon><span class="lbl">${f.label}</span> ${f.pct == null ? "--" : f.pct + "%"}</div>`
        );
        y += 6.5;
      }
    }

    // Door – above the handle
    if (m.door)
      out.push(
        `<div class="pill round ${m.door.open ? "warn" : ""}" style="left:65.3%;top:58.6%" data-action="more" data-entity="${esc(m.door.id)}" title="Door ${m.door.open ? "open" : "closed"}">` +
          `<ha-icon icon="${m.door.open ? "mdi:door-open" : "mdi:door-closed"}"></ha-icon></div>`
      );

    return out.join("");
  }

  _renderStageButtons(m) {
    const b = [];
    if (m.light)
      b.push(`<div class="sbtn ${m.light.on ? "on" : ""}" data-action="toggle" data-entity="${esc(m.light.id)}" title="Chamber light"><ha-icon icon="mdi:lightbulb${m.light.on ? "" : "-outline"}"></ha-icon></div>`);
    if (this._config.show_camera && m.camera)
      b.push(`<div class="sbtn ${this._view === "camera" ? "active" : ""}" data-action="view" title="Toggle camera"><ha-icon icon="${this._view === "camera" ? "mdi:printer-3d" : "mdi:cctv"}"></ha-icon></div>`);
    return b.join("");
  }

  _renderRest(m) {
    const c = this._config;
    const out = [];

    if (!m.found) {
      out.push(`<div class="warn-box">No printer entities found. Pick your Moonraker printer in the card editor, or set <b>printer</b> / <b>prefix</b>.</div>`);
    }

    // Job
    if (c.show_job && ["printing", "paused", "complete"].includes(m.key)) {
      const meta = [];
      if (m.layer != null && m.layers) meta.push(`<span><ha-icon icon="mdi:layers-triple-outline"></ha-icon>${Math.round(m.layer)} / ${Math.round(m.layers)}</span>`);
      if (m.timeLeft && m.key !== "complete") meta.push(`<span><ha-icon icon="mdi:timer-sand"></ha-icon>${m.timeLeft} left</span>`);
      if (m.eta && m.key !== "complete") meta.push(`<span><ha-icon icon="mdi:flag-checkered"></ha-icon>${esc(m.eta)}</span>`);
      if (m.duration && m.key === "complete") meta.push(`<span><ha-icon icon="mdi:clock-outline"></ha-icon>${m.duration}</span>`);
      if (m.speed != null && m.speed !== 100) meta.push(`<span><ha-icon icon="mdi:speedometer"></ha-icon>${m.speed}%</span>`);
      out.push(`
        <div class="section job">
          <div class="thumb" data-action="more" data-entity="${esc(m.thumbId || "")}">${
        m.thumb ? `<img src="${esc(m.thumb)}" alt="">` : `<ha-icon icon="mdi:cube-outline"></ha-icon>`
      }</div>
          <div class="job-main">
            <div class="job-top"><span class="file">${esc(m.filename || "Print job")}</span><span class="pct">${Math.round(m.progress || 0)}%</span></div>
            <div class="bar"><div class="fill" style="width:${m.progress || 0}%"></div></div>
            <div class="job-meta">${meta.join("")}</div>
          </div>
        </div>`);
    }

    // Toolheads (Creator 5 Pro tool changer)
    if (c.show_tools && m.tools.length > 1) {
      const laneFor = (idx) => m.afc.lanes.find((l) => {
        const ref = l.extruder || l.tool;
        const mm = ref && String(ref).match(/(\d+)/);
        return mm ? parseInt(mm[1], 10) === idx : String(ref) === "extruder" && idx === 0;
      });
      out.push(`<div class="section"><div class="sec-title"><span>Toolheads</span></div><div class="tools">${m.tools
        .map((t) => {
          const l = laneFor(t.idx);
          return `<div class="tool ${t.idx === m.activeIdx ? "active" : ""}" data-action="more" data-entity="${esc(t.id)}">
              <div class="tn">${l && l.color ? `<span class="sw" style="--c:${esc(l.color)}"></span>` : ""}T${t.idx}</div>
              <div class="tt">${fmtTemp(t.temp, t.target)}</div></div>`;
        })
        .join("")}</div></div>`);
    }

    // AFC lanes
    if (c.show_afc && m.afc.lanes.length) {
      out.push(`<div class="section"><div class="sec-title"><span>AFC · Filament</span><span>${esc(m.afc.state || (m.afc.current ? `Loaded: ${m.afc.current}` : ""))}</span></div><div class="lanes">${m.afc.lanes
        .map((l) => {
          const col = l.color || "#8a8d93";
          const rawStatus = l.status && !BAD.includes(String(l.status).toLowerCase()) ? l.status : null;
          const statusTxt = l.active ? "In tool" : l.empty ? "Empty" : rawStatus || (l.ready ? "Ready" : "");
          const lc = l.active ? col : l.empty ? "#616161" : /error|fault/i.test(statusTxt) ? "#e57373" : "#81c784";
          return `<div class="lane ${l.active ? "active" : ""} ${l.empty ? "empty" : ""}" style="--c:${esc(col)};--tc:${textOn(col)}" data-action="more" data-entity="${esc(l.entity || "")}">
              ${l.tool ? `<span class="tag">${esc(l.tool)}</span>` : ""}
              <div class="reel"></div>
              <div class="ln">${esc(l.name.toUpperCase())}</div>
              <div class="lm">${esc(l.empty ? "—" : l.material || "—")}</div>
              ${l.weightTxt && !l.empty ? `<div class="lw">${l.weightTxt}</div>` : ""}
              ${statusTxt ? `<div class="ls" style="--lc:${esc(lc)}"><i></i>${esc(statusTxt)}</div>` : ""}
            </div>`;
        })
        .join("")}</div></div>`);
    }

    // Controls
    if (c.show_controls) {
      const btn = (action, entity, icon, label, cls = "", style = "") =>
        `<button class="cbtn ${cls}" style="${style}" data-action="${action}" data-entity="${esc(entity)}"><span class="ci"><ha-icon icon="${icon}"></ha-icon></span>${label}</button>`;
      const b = [];
      const active = m.key === "printing" || m.key === "paused";
      if (m.key === "paused" && m.buttons.resume) b.push(btn("press", m.buttons.resume, "mdi:play", "Resume"));
      else if (m.buttons.pause) b.push(btn(m.key === "printing" ? "press" : "noop", m.buttons.pause, "mdi:pause", "Pause", m.key === "printing" ? "" : "disabled", m.key === "printing" ? "" : "opacity:.4;pointer-events:none"));
      if (m.buttons.cancel) b.push(btn("confirm-press", m.buttons.cancel, "mdi:stop", "Cancel", "", active ? "" : "opacity:.4;pointer-events:none"));
      if (m.light) b.push(btn("toggle", m.light.id, "mdi:lightbulb", "Light", m.light.on ? "on" : "", "--bc:#ffd54f"));
      if (m.filtration)
        b.push(
          domainOf(m.filtration.id) === "select"
            ? btn("more", m.filtration.id, "mdi:air-filter", esc(m.filtration.state || "Filter"), m.filtration.on ? "on" : "", "--bc:#80deea")
            : btn("toggle", m.filtration.id, "mdi:air-filter", "Filter", m.filtration.on ? "on" : "", "--bc:#80deea")
        );
      if (m.buttons.estop) b.push(btn("confirm-press", m.buttons.estop, "mdi:alert-octagon", "E-Stop", "danger"));
      if (b.length) out.push(`<div class="controls">${b.join("")}</div>`);
    }

    return out.join("");
  }

  _updateCamera(entityId) {
    const host = this._root.getElementById("cam");
    if (!entityId) {
      if (host.firstChild) host.innerHTML = "";
      this._camEl = null;
      return;
    }
    const stateObj = this._hass.states[entityId];
    if (!stateObj) {
      host.innerHTML = `<div class="cam-empty">Camera unavailable</div>`;
      this._camEl = null;
      return;
    }
    if (customElements.get("ha-camera-stream")) {
      if (!this._camEl || this._camEl.tagName !== "HA-CAMERA-STREAM") {
        host.innerHTML = "";
        this._camEl = document.createElement("ha-camera-stream");
        this._camEl.muted = true;
        this._camEl.controls = false;
        this._camEl.allowExoPlayer = true;
        host.appendChild(this._camEl);
      }
      this._camEl.hass = this._hass;
      if (this._camEl.stateObj !== stateObj) this._camEl.stateObj = stateObj;
    } else {
      if (!this._camEl) {
        host.innerHTML = "";
        this._camEl = document.createElement("img");
        host.appendChild(this._camEl);
      }
      const src = stateObj.attributes.entity_picture;
      if (src && this._camEl.getAttribute("src") !== src) this._camEl.setAttribute("src", src);
    }
  }

  /* ---------------- actions ---------------- */

  _onClick(ev) {
    const el = ev.composedPath().find((n) => n instanceof HTMLElement && n.dataset && n.dataset.action);
    if (!el) return;
    const action = el.dataset.action;
    const entity = el.dataset.entity;
    const h = this._hass;
    switch (action) {
      case "more":
        if (entity) this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId: entity }, bubbles: true, composed: true }));
        break;
      case "toggle":
        if (entity) h.callService("homeassistant", "toggle", { entity_id: entity });
        break;
      case "press":
        if (entity) h.callService("button", "press", { entity_id: entity });
        break;
      case "confirm-press": {
        const name = (h.states[entity] && h.states[entity].attributes.friendly_name) || entity;
        if (entity && window.confirm(`${name}?\nThis will interrupt the printer.`)) h.callService("button", "press", { entity_id: entity });
        break;
      }
      case "view":
        this._view = this._view === "camera" ? "image" : "camera";
        this._parts.sbtns = null;
        this._update();
        break;
      default:
        break;
    }
  }
}

function textOn(color) {
  const m = /^#([0-9a-f]{6})$/i.exec(color || "");
  if (!m) return "#000";
  const n = parseInt(m[1], 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.6 ? "#000" : "#fff";
}

/* ------------------------------------------------------------------ *
 * Visual editor
 * ------------------------------------------------------------------ */
const ENTITY_KEYS = [
  ["print_state", "Print state"],
  ["printer_state", "Printer (Klipper) state"],
  ["progress", "Progress"],
  ["filename", "Filename"],
  ["time_left", "Time left"],
  ["eta", "ETA"],
  ["current_layer", "Current layer"],
  ["total_layer", "Total layers"],
  ["nozzle_temp", "Nozzle temperature"],
  ["nozzle_target", "Nozzle target"],
  ["bed_temp", "Bed temperature"],
  ["bed_target", "Bed target"],
  ["chamber_temp", "Chamber temperature"],
  ["part_fan", "Part cooling fan"],
  ["aux_fan", "Auxiliary fan"],
  ["chamber_fan", "Chamber / exhaust fan"],
  ["light", "Chamber light"],
  ["door", "Door sensor"],
  ["filtration", "Filtration"],
  ["camera", "Camera"],
  ["thumbnail", "Thumbnail"],
  ["pause_button", "Pause button"],
  ["resume_button", "Resume button"],
  ["cancel_button", "Cancel button"],
  ["estop_button", "Emergency stop button"],
];

const EDITOR_SCHEMA = [
  { name: "name", selector: { text: {} } },
  { name: "printer", selector: { device: { integration: "moonraker" } } },
  { name: "flashforge_device", selector: { device: {} } },
  {
    type: "grid",
    name: "",
    schema: [
      { name: "theme", selector: { select: { mode: "dropdown", options: [{ value: "dark", label: "Dark glass" }, { value: "light", label: "Light glass" }] } } },
      { name: "accent_color", selector: { text: {} } },
    ],
  },
  {
    type: "grid",
    name: "",
    schema: [
      { name: "show_job", selector: { boolean: {} } },
      { name: "show_tools", selector: { boolean: {} } },
      { name: "show_afc", selector: { boolean: {} } },
      { name: "tint_spools", selector: { boolean: {} } },
      { name: "show_fans", selector: { boolean: {} } },
      { name: "show_camera", selector: { boolean: {} } },
      { name: "show_controls", selector: { boolean: {} } },
    ],
  },
  {
    type: "expandable",
    name: "afc",
    title: "AFC (Automated Filament Control)",
    icon: "mdi:printer-3d-nozzle-outline",
    schema: [
      { name: "entity", selector: { entity: {} } },
      { name: "current_lane", selector: { entity: { domain: "sensor" } } },
    ],
  },
  {
    type: "expandable",
    name: "entities",
    title: "Entity overrides (optional)",
    icon: "mdi:tune-variant",
    schema: ENTITY_KEYS.map(([k]) => ({ name: k, selector: { entity: {} } })),
  },
  { name: "image", selector: { text: {} } },
  { name: "prefix", selector: { text: {} } },
];

const LABELS = {
  name: "Card name",
  printer: "Moonraker printer",
  flashforge_device: "Flashforge device (optional)",
  theme: "Theme",
  accent_color: "Accent color (optional, e.g. #4fc3f7)",
  show_job: "Show job progress",
  show_tools: "Show toolheads",
  show_afc: "Show AFC lanes",
  tint_spools: "Color spools from AFC",
  show_fans: "Show fans",
  show_camera: "Camera toggle",
  show_controls: "Show controls",
  entity: "AFC data entity (attributes from Moonraker)",
  current_lane: "AFC current lane sensor",
  image: "Custom printer image URL (optional)",
  prefix: "Entity prefix fallback (optional)",
  ...Object.fromEntries(ENTITY_KEYS),
};

const HELPERS = {
  printer: "Select which Moonraker instance this card shows.",
  flashforge_device: "Device from the Flashforge integration/add-on (chamber, light, door, filtration, camera).",
  prefix: "Only needed without a device, e.g. 'creator_5_pro' for sensor.creator_5_pro_*.",
};

class PrismFlashforgeCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = { ...config };
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (this._form) this._form.hass = hass;
    else this._render();
  }

  _render() {
    if (!this._hass || !this._config) return;
    if (!this._form) {
      this._form = document.createElement("ha-form");
      this._form.computeLabel = (s) => LABELS[s.name] || s.name;
      this._form.computeHelper = (s) => HELPERS[s.name];
      this._form.addEventListener("value-changed", (ev) => {
        ev.stopPropagation();
        const cfg = clean({ ...ev.detail.value });
        this._config = cfg;
        this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: cfg }, bubbles: true, composed: true }));
      });
      this.appendChild(this._form);
    }
    this._form.hass = this._hass;
    this._form.data = { ...DEFAULTS, ...this._config };
    this._form.schema = EDITOR_SCHEMA;
  }
}

function clean(obj) {
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (v === "" || v == null) delete obj[k];
    else if (v && typeof v === "object" && !Array.isArray(v)) {
      clean(v);
      if (!Object.keys(v).length) delete obj[k];
    }
  }
  return obj;
}

/* ------------------------------------------------------------------ */
if (!customElements.get(CARD_TAG)) customElements.define(CARD_TAG, PrismFlashforgeCard);
if (!customElements.get(EDITOR_TAG)) customElements.define(EDITOR_TAG, PrismFlashforgeCardEditor);

window.customCards = window.customCards || [];
if (!window.customCards.some((c) => c.type === CARD_TAG)) {
  window.customCards.push({
    type: CARD_TAG,
    name: "Prism Flashforge Creator 5 Pro",
    description: "Prism-style card for the Flashforge Creator 5 Pro with Moonraker, Flashforge and AFC data.",
    preview: true,
  });
}

console.info(`%c PRISM-FLASHFORGE %c v${CARD_VERSION} `, "background:#4fc3f7;color:#000;font-weight:700;border-radius:4px 0 0 4px;padding:2px 4px", "background:#1e2024;color:#fff;border-radius:0 4px 4px 0;padding:2px 4px");
