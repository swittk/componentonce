import * as React from "react";
import * as JsxRuntime from "react/jsx-runtime";
import * as JsxDevRuntime from "react/jsx-dev-runtime";
import { createRoot, type Root } from "react-dom/client";
import * as ComponentOnceReact from "@componentonce/react";
import type { ComponentOnceStyleMount } from "@componentonce/runtime";
import type { ComponentOnceReactDevHost } from "./host.js";
import type { ComponentOnceDevArtifact } from "./protocol.js";
import { loadComponentOnceDevArtifact, type ComponentOnceLoadedDevArtifact } from "./client.js";

interface Inputs { readonly props: unknown; readonly payload: unknown; readonly context: unknown }

class PreviewErrorBoundary extends React.Component<{ children: React.ReactNode; onError: (error: Error) => void }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { this.props.onError(error); }
  render() {
    return this.state.error ? <div role="alert" style={{ padding: 16, border: "1px solid #edaaaa", borderRadius: 8, fontFamily: "system-ui" }}>Component render failed. See workbench diagnostics.</div> : this.props.children;
  }
}

/** Mount the iframe's real browser host. No Node-side stand-in or fake external is evaluated. */
export function mountComponentOncePreview(profile: ComponentOnceReactDevHost): () => void {
  const node = document.getElementById("preview-root");
  if (node === null) throw new Error("Missing preview root.");
  const host = ComponentOnceReact.createReactHost({
    ...(profile.capabilities === undefined ? {} : { capabilities: profile.capabilities }),
    ...(profile.capabilityCompatibility === undefined ? {} : { capabilityCompatibility: profile.capabilityCompatibility }),
  });
  const externals = {
    ...profile.externals,
    // These cannot be replaced with an accidentally duplicated React copy in a host profile.
    react: React,
    "react/jsx-runtime": JsxRuntime,
    "react/jsx-dev-runtime": JsxDevRuntime,
    "@componentonce/react": ComponentOnceReact,
  };
  let input: Inputs = { props: {}, payload: {}, context: {} };
  let context: unknown;
  let lastContextJson: string | undefined;
  let loaded: ComponentOnceLoadedDevArtifact | undefined;
  let styleMount: ComponentOnceStyleMount | undefined;
  let root: Root | undefined;
  let generation = 0;
  let revision = 0;
  let renderKey = 0;
  let disposed = false;
  let ready = false;
  const send = (type: string, value: unknown) => window.parent.postMessage({ componentonce: true, type, value }, window.location.origin);
  const fail = (error: unknown) => send("error", error instanceof Error ? error.message : String(error));
  const makeElement = (candidate: ComponentOnceLoadedDevArtifact) => {
    const json = JSON.stringify(input.context);
    if (json !== lastContextJson) {
      context = profile.createContext ? profile.createContext(input.context) : input.context;
      lastContextJson = json;
    }
    const element = host.render({
      definition: candidate.definition,
      props: input.props,
      payload: input.payload,
      context,
      validation: { props: candidate.definition.validateProps !== undefined, payload: candidate.definition.validatePayload !== undefined },
    });
    return profile.wrap ? profile.wrap(element, context) : element;
  };
  const render = () => {
    if (loaded === undefined || disposed) return;
    try {
      const element = makeElement(loaded);
      root ??= createRoot(node);
      renderKey += 1;
      root.render(<PreviewErrorBoundary key={renderKey} onError={fail}>{element}</PreviewErrorBoundary>);
      send("rendered", { revision });
    } catch (error) { fail(error); }
  };
  const load = async () => {
    if (!ready) return;
    const ticket = ++generation;
    let candidate: ComponentOnceLoadedDevArtifact | undefined;
    try {
      const response = await fetch("/artifact", { cache: "no-store" });
      if (!response.ok) throw new Error("Waiting for a successful source build.");
      const update = await response.json() as ComponentOnceDevArtifact;
      candidate = await loadComponentOnceDevArtifact(update, externals);
      if (disposed || ticket !== generation) { candidate.dispose(); return; }
      // Fail missing capabilities/invalid fixture values before replacing the last good mount.
      const element = makeElement(candidate);
      root?.unmount();
      root = undefined;
      styleMount?.release();
      loaded?.dispose();
      loaded = candidate;
      candidate = undefined;
      revision = update.revision;
      styleMount = loaded.assets.mountStyles(document);
      root = createRoot(node);
      renderKey += 1;
      root.render(<PreviewErrorBoundary key={renderKey} onError={fail}>{element}</PreviewErrorBoundary>);
      send("loaded", {
        revision,
        manifest: loaded.componentPackage.manifest,
        bytes: update.artifact.byteLength,
        externals: update.artifact.externalModules,
        assets: update.artifact.assets.map(({ path, contentType, byteLength }) => ({ path, contentType, byteLength })),
      });
    } catch (error) { candidate?.dispose(); if (!disposed && ticket === generation) fail(error); }
  };
  const onMessage = (event: MessageEvent) => {
    if (event.source !== window.parent || event.origin !== window.location.origin || event.data?.componentonce !== true) return;
    const { type, value } = event.data as { type: string; value: Inputs };
    if (type === "inputs") { input = value; render(); }
    if (type === "reload") void load();
    if (type === "remount") render();
    if (type === "download" && loaded !== undefined) send("download", JSON.stringify(loaded.componentPackage, null, 2));
    if (type === "theme") {
      const theme = String(value);
      if (profile.applyTheme) profile.applyTheme(theme);
      else if (theme) document.documentElement.dataset.theme = theme;
    }
  };
  window.addEventListener("message", onMessage);
  const onUnhandled = (event: PromiseRejectionEvent) => fail(event.reason);
  window.addEventListener("unhandledrejection", onUnhandled);
  const dispose = () => {
    if (disposed) return;
    disposed = true; generation += 1;
    window.removeEventListener("message", onMessage);
    window.removeEventListener("unhandledrejection", onUnhandled);
    root?.unmount(); styleMount?.release(); loaded?.dispose(); profile.dispose?.();
  };
  window.addEventListener("pagehide", dispose, { once: true });
  void Promise.resolve().then(() => profile.setup?.()).then(() => {
    if (disposed) return;
    ready = true;
    send("ready", {
      name: profile.name ?? "React host",
      react: React.version,
      externals: Object.keys(externals),
      capabilities: [{ name: "react", version: React.version }, ...(profile.capabilities ?? [])],
      fixtures: profile.fixtures ?? [{ name: "Default", props: {}, payload: {}, context: {} }],
      themes: profile.themes ?? [],
    });
    // The parent sends the selected fixture then requests the artifact: no fixture/load race.
  }).catch(fail);
  return dispose;
}
