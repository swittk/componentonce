import type { ComponentOnceDevStatus } from "./protocol.js";

const root = document.getElementById("workbench");
if (!root) throw new Error("Missing workbench root.");
root.innerHTML = `
<header class="toolbar">
  <div class="brand"><span class="brand-mark">C<span>1</span></span><div><strong>ComponentOnce</strong><span class="tag">DEV WORKBENCH</span></div></div>
  <span class="status" id="status" role="status">Starting compiler…</span>
  <div class="toolbar-actions"><button id="remount">Remount</button><button class="primary" id="download" disabled>Export package</button></div>
</header>
<div class="work-area">
  <aside class="inputs panel">
    <div class="section-title">HOST & SCENARIO</div>
    <div class="host-name" id="host-name">Loading browser host…</div><div class="hint" id="react-version"></div>
    <label for="fixtures">Fixture</label><select id="fixtures" aria-label="Fixture"></select>
    <div class="field-heading"><label for="props">Props</label><span>Saved configuration</span></div><textarea id="props" spellcheck="false">{}</textarea>
    <div class="field-heading"><label for="payload">Payload</label><span>Per-render data</span></div><textarea id="payload" spellcheck="false">{}</textarea>
    <div class="field-heading"><label for="context">Context input</label><span>Host builds functions</span></div><textarea id="context" spellcheck="false">{}</textarea>
    <button id="apply" class="primary wide">Apply inputs</button><div class="hint">Ctrl / ⌘ + Enter to apply. Fixtures stay in memory; nothing is written to your app.</div>
  </aside>
  <main class="preview-area">
    <div class="preview-toolbar"><div><strong>Live preview</strong><span id="build-time" class="hint">Waiting for first build</span></div>
      <div class="preview-options"><select id="viewport" aria-label="Preview width"><option value="100%">Responsive</option><option value="375px">Mobile · 375</option><option value="768px">Tablet · 768</option></select><select id="theme" aria-label="Preview theme"><option value="light">Light</option><option value="dark">Dark</option></select></div>
    </div>
    <div class="preview-stage"><iframe id="preview" title="Component preview"></iframe></div>
    <div class="preview-footer"><span class="live-dot"></span>Source save → compile → remount <span>Same compiler · real host externals</span></div>
    <section class="diagnostics"><div class="section-title">DIAGNOSTICS <span id="diagnostic-count">0</span></div><pre id="diagnostics" role="log">No diagnostics.</pre></section>
  </main>
  <aside class="inspector panel">
    <div class="section-title">PACKAGE</div><div id="component-name" class="component-name">No component loaded</div><div id="component-id" class="hint"></div>
    <dl class="stats"><div><dt>Revision</dt><dd id="revision">—</dd></div><div><dt>JavaScript</dt><dd id="bundle-size">—</dd></div><div><dt>Assets</dt><dd id="asset-count">—</dd></div></dl>
    <details open><summary>Requirements</summary><pre id="requirements">—</pre></details>
    <details open><summary>Host capabilities</summary><pre id="capabilities">—</pre></details>
    <details open><summary>External imports</summary><pre id="externals">—</pre></details>
    <details open><summary>Packaged assets</summary><div id="assets" class="asset-list">—</div></details>
    <div class="trust-note">LOCAL / TRUSTED CODE<br><span>Preview CSS is isolated in an iframe. This is not a sandbox for untrusted packages.</span></div>
  </aside>
</div>`;
function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error("Missing workbench element " + id);
  return value as T;
}
const frame = element<HTMLIFrameElement>("preview");
const props = element<HTMLTextAreaElement>("props");
const payload = element<HTMLTextAreaElement>("payload");
const context = element<HTMLTextAreaElement>("context");
const fixtureSelect = element<HTMLSelectElement>("fixtures");
let fixtures: Array<{ name: string; props: unknown; payload: unknown; context?: unknown }> = [];
let hasInputs = false;
let ready = false;
let revision = 0;
let hostRevision = 0;
let requestedRevision = 0;
let runtimeError = "";
let sourceDiagnostics: string[] = [];
let hostDiagnostics: string[] = [];
let latest: { source: ComponentOnceDevStatus; host: ComponentOnceDevStatus } | undefined;
const send = (type: string, value?: unknown) => frame.contentWindow?.postMessage({ componentonce: true, type, value }, window.location.origin);
const display = (id: string, text: string) => { element(id).textContent = text; };
const formatBytes = (bytes: number) => bytes < 1024 ? bytes + " B" : (bytes / 1024).toFixed(1) + " KB";
function diagnostics() {
  const all = [...hostDiagnostics, ...sourceDiagnostics, ...(runtimeError ? [runtimeError] : [])];
  display("diagnostics", all.join("\n\n") || "No diagnostics.");
  display("diagnostic-count", String(all.length));
  element("diagnostics").classList.toggle("has-errors", all.length > 0);
}
function apply(): boolean {
  try {
    const input = { props: JSON.parse(props.value), payload: JSON.parse(payload.value), context: JSON.parse(context.value) };
    hasInputs = true;
    runtimeError = ""; diagnostics();
    if (ready) send("inputs", input);
    return true;
  } catch (error) { runtimeError = "Invalid fixture JSON: " + String(error); diagnostics(); return false; }
}
function selectFixture(index: number) {
  const fixture = fixtures[index];
  if (!fixture) return;
  props.value = JSON.stringify(fixture.props ?? {}, null, 2);
  payload.value = JSON.stringify(fixture.payload ?? {}, null, 2);
  context.value = JSON.stringify(fixture.context ?? {}, null, 2);
  apply();
}
function updateStatus() {
  const status = element("status");
  const failed = latest && (!latest.source.ok || !latest.host.ok || runtimeError !== "");
  status.dataset.state = failed ? "error" : revision ? "ready" : "loading";
  status.textContent = failed ? (revision ? "Needs attention · last build retained" : "Needs attention") : revision ? "Live · revision " + revision : "Building…";
}
function requestArtifact() {
  if (ready && latest && latest.source.revision > requestedRevision) {
    requestedRevision = latest.source.revision;
    send("reload");
  }
}
const events = new EventSource("/events");
events.addEventListener("status", (event) => {
  latest = JSON.parse((event as MessageEvent<string>).data) as typeof latest;
  if (!latest) return;
  sourceDiagnostics = latest.source.diagnostics.map((item) => (item.location ? item.location.file + ":" + item.location.line + " " : "") + item.text);
  hostDiagnostics = latest.host.diagnostics.map((item) => "Host: " + item.text);
  if (latest.host.hostRevision !== hostRevision && latest.host.hostRevision > 0) {
    hostRevision = latest.host.hostRevision;
    ready = false; requestedRevision = 0;
    frame.src = "/preview?host=" + hostRevision;
  }
  requestArtifact();
  display("build-time", "Compiler " + latest.source.durationMs.toFixed(0) + " ms");
  diagnostics(); updateStatus();
});
events.onerror = () => { display("status", "Disconnected · retrying…"); };
window.addEventListener("message", (event) => {
  if (event.source !== frame.contentWindow || event.origin !== window.location.origin || event.data?.componentonce !== true) return;
  const { type, value } = event.data;
  if (type === "ready") {
    ready = true;
    display("host-name", value.name);
    display("react-version", "React " + value.react + " · shared singleton");
    display("capabilities", value.capabilities.map((item: { name: string; version: string }) => item.name + "  " + item.version).join("\n") || "None");
    fixtures = value.fixtures;
    fixtureSelect.replaceChildren(...fixtures.map((fixture, index) => {
      const option = document.createElement("option"); option.value = String(index); option.textContent = fixture.name; return option;
    }));
    if (!hasInputs) selectFixture(0); else apply();
    send("theme", element<HTMLSelectElement>("theme").value);
    requestArtifact();
  }
  if (type === "loaded") {
    revision = value.revision;
    runtimeError = "";
    display("component-name", value.manifest.displayName ?? value.manifest.id);
    display("component-id", value.manifest.id + " @ " + value.manifest.version);
    display("revision", String(revision));
    display("bundle-size", formatBytes(value.bytes));
    display("asset-count", String(value.assets.length));
    display("requirements", (value.manifest.requirements ?? []).map((item: { name: string; version: string }) => item.name + "  " + item.version).join("\n") || "None");
    display("externals", value.externals.join("\n") || "None");
    element("assets").replaceChildren(...value.assets.map((asset: { path: string; byteLength: number }) => {
      const row = document.createElement("div"); row.textContent = asset.path + " · " + formatBytes(asset.byteLength); return row;
    }));
    element<HTMLButtonElement>("download").disabled = false;
    diagnostics(); updateStatus();
  }
  if (type === "rendered") { runtimeError = ""; diagnostics(); updateStatus(); }
  if (type === "error") { runtimeError = String(value); diagnostics(); updateStatus(); }
  if (type === "download") {
    const url = URL.createObjectURL(new Blob([value], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "component.componentonce.json"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
});
element("apply").onclick = () => { if (apply()) { requestedRevision = revision; requestArtifact(); } };
fixtureSelect.onchange = () => selectFixture(Number(fixtureSelect.value));
element("remount").onclick = () => { if (apply()) { runtimeError = ""; requestedRevision = latest?.source.revision ?? revision; send("reload"); } };
element("download").onclick = () => send("download");
element<HTMLSelectElement>("viewport").onchange = (event) => { frame.style.width = (event.target as HTMLSelectElement).value; };
element<HTMLSelectElement>("theme").onchange = (event) => send("theme", (event.target as HTMLSelectElement).value);
window.addEventListener("keydown", (event) => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); if (apply()) { requestedRevision = revision; requestArtifact(); } } });
window.addEventListener("pagehide", () => events.close(), { once: true });
