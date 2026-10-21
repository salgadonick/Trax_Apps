// =============================================================================
// dashboards/generic.js — fallback for a machine this app version does not
// know (or a protocol version it cannot parse): shows the raw lines so the
// unit is never a black box, and tells the user to update the app.
// Dashboard contract: { id, mount(ctx), render(d), onLine(line), unmount() }.
// =============================================================================
export const id = "generic";
let ctx = null;

export function mount(c) {
  ctx = c;
  const $ = ctx.$;
  $("gen-title").textContent = ctx.identity ? `${ctx.identity.info.name} · ${ctx.identity.code} · firmware ${ctx.identity.fw}` : "Unknown machine";
  $("gen-text").textContent = ctx.identity && ctx.identity.info.protocol
    ? `This app cannot read protocol version ${ctx.identity.tlmVersion} from this unit. Update the app.`
    : "This app version does not have a dashboard for this machine. Update the app; the raw data is shown below.";
}
export function render() {}
export function onLine(line) {
  const box = ctx.$("gen-lines");
  const d = document.createElement("div"); d.textContent = line; box.appendChild(d);
  while (box.children.length > 40) box.firstChild.remove();
}
export function unmount() { ctx = null; }
