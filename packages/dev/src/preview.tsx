import * as React from "react";
import * as JsxRuntime from "react/jsx-runtime";
import * as JsxDevRuntime from "react/jsx-dev-runtime";
import { createRoot, type Root } from "react-dom/client";
import * as ComponentOnceReact from "@componentonce/react";
import type { ComponentOnceStyleMount } from "@componentonce/runtime";
import type {
  ComponentOnceDevFunctionEntry,
  ComponentOnceReactDevHost,
} from "./host.js";
import type { ComponentOnceDevArtifact } from "./protocol.js";
import {
  loadComponentOnceDevArtifact,
  type ComponentOnceLoadedDevArtifact,
} from "./client.js";

interface Inputs {
  readonly props: unknown;
  readonly payload: unknown;
  readonly context: unknown;
}

class PreviewErrorBoundary extends React.Component<
  { children: React.ReactNode; onError: (error: Error) => void },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    this.props.onError(error);
  }
  render() {
    return this.state.error ? (
      <div
        role="alert"
        style={{
          padding: 16,
          border: "1px solid #edaaaa",
          borderRadius: 8,
          fontFamily: "system-ui",
        }}
      >
        Component render failed. See workbench diagnostics.
      </div>
    ) : (
      this.props.children
    );
  }
}

function summarizeForWorkbench(
  value: unknown,
  depth = 0,
  seen = new WeakSet<object>(),
): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "undefined"
  ) {
    return value;
  }
  if (typeof value === "bigint") return value.toString() + "n";
  if (typeof value === "symbol") return String(value);
  if (typeof value === "function") {
    return "[Function " + (value.name || "anonymous") + "]";
  }
  if (value instanceof Error) {
    return { error: value.name, message: value.message };
  }
  if (typeof Event !== "undefined" && value instanceof Event) {
    const target =
      value.target instanceof Element
        ? value.target.tagName.toLowerCase() +
          (value.target.id ? "#" + value.target.id : "")
        : undefined;
    return { event: value.type, ...(target ? { target } : {}) };
  }
  if (typeof value !== "object") return String(value);
  if (seen.has(value)) return "[Circular]";
  if (depth >= 3) return "[Object]";
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const output = value
        .slice(0, 20)
        .map((item) => summarizeForWorkbench(item, depth + 1, seen));
      if (value.length > 20) output.push("… " + (value.length - 20) + " more");
      return output;
    }
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value).slice(0, 30)) {
      output[key] = summarizeForWorkbench(item, depth + 1, seen);
    }
    return output;
  } finally {
    seen.delete(value);
  }
}

function assertFixtureHasNoRawFunctions(
  value: unknown,
  path: string,
  seen = new WeakSet<object>(),
): void {
  if (typeof value === "function") {
    throw new Error(
      path +
        " contains a raw function. Put the function in host.functions and use " +
        '{"$componentonceFunction":"name"} in the fixture instead.',
    );
  }
  if (value === null || typeof value !== "object") return;
  if (seen.has(value)) throw new Error(path + " contains a circular fixture value.");
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      value.forEach((item, index) =>
        assertFixtureHasNoRawFunctions(item, path + "[" + index + "]", seen),
      );
      return;
    }
    for (const [key, item] of Object.entries(value)) {
      assertFixtureHasNoRawFunctions(item, path + "." + key, seen);
    }
  } finally {
    seen.delete(value);
  }
}

function isFunctionReference(
  value: unknown,
): value is {
  readonly $componentonceFunction: string;
  readonly bind?: readonly unknown[];
} {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  return (
    typeof record.$componentonceFunction === "string" &&
    keys.every(
      (key) => key === "$componentonceFunction" || key === "bind",
    ) &&
    (record.bind === undefined || Array.isArray(record.bind))
  );
}

/** Mount the iframe's real browser host. No Node-side stand-in or fake external is evaluated. */
export function mountComponentOncePreview(
  profile: ComponentOnceReactDevHost,
): () => void {
  const node = document.getElementById("preview-root");
  if (node === null) throw new Error("Missing preview root.");
  const host = ComponentOnceReact.createReactHost({
    ...(profile.capabilities === undefined
      ? {}
      : { capabilities: profile.capabilities }),
    ...(profile.capabilityCompatibility === undefined
      ? {}
      : { capabilityCompatibility: profile.capabilityCompatibility }),
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
  let resolvedInput:
    | {
        readonly json: string;
        readonly props: unknown;
        readonly payload: unknown;
        readonly contextInput: unknown;
      }
    | undefined;
  let context: unknown;
  let loaded: ComponentOnceLoadedDevArtifact | undefined;
  let styleMount: ComponentOnceStyleMount | undefined;
  let root: Root | undefined;
  let generation = 0;
  let revision = 0;
  let renderKey = 0;
  let callSequence = 0;
  let disposed = false;
  let ready = false;
  const send = (type: string, value: unknown) =>
    window.parent.postMessage(
      { componentonce: true, type, value },
      window.location.origin,
    );
  const fail = (error: unknown) =>
    send("error", error instanceof Error ? error.message : String(error));

  const resolveInputValue = (
    value: unknown,
    path: string,
    seen = new WeakSet<object>(),
  ): unknown => {
    if (isFunctionReference(value)) {
      const catalogValue = profile.functions?.[value.$componentonceFunction];
      if (catalogValue === undefined) {
        throw new Error(
          path +
            ' references unknown host function "' +
            value.$componentonceFunction +
            '".',
        );
      }
      const entry: ComponentOnceDevFunctionEntry =
        typeof catalogValue === "function"
          ? { call: catalogValue }
          : catalogValue;
      const call = entry.call as (...args: unknown[]) => unknown;
      const boundArgs = (value.bind ?? []).map((item, index) =>
        resolveInputValue(item, path + ".bind[" + index + "]"),
      );
      return (...args: unknown[]) => {
        const callId = ++callSequence;
        send("function-call", {
          id: callId,
          name: value.$componentonceFunction,
          mode: entry.mode ?? "actual",
          bound: summarizeForWorkbench(boundArgs),
          args: summarizeForWorkbench(args),
        });
        try {
          const result = call(...boundArgs, ...args);
          if (
            result !== null &&
            (typeof result === "object" || typeof result === "function") &&
            "then" in result &&
            typeof (result as { then?: unknown }).then === "function"
          ) {
            void Promise.resolve(result).then(
              (resolved) =>
                send("function-result", {
                  id: callId,
                  status: "resolved",
                  result: summarizeForWorkbench(resolved),
                }),
              (error) =>
                send("function-result", {
                  id: callId,
                  status: "rejected",
                  result: summarizeForWorkbench(error),
                }),
            );
          } else {
            send("function-result", {
              id: callId,
              status: "returned",
              result: summarizeForWorkbench(result),
            });
          }
          return result;
        } catch (error) {
          send("function-result", {
            id: callId,
            status: "threw",
            result: summarizeForWorkbench(error),
          });
          throw error;
        }
      };
    }
    if (value === null || typeof value !== "object") return value;
    if (seen.has(value)) {
      throw new Error(path + " contains a circular fixture value.");
    }
    seen.add(value);
    try {
      if (Array.isArray(value)) {
        return value.map((item, index) =>
          resolveInputValue(item, path + "[" + index + "]", seen),
        );
      }
      const output: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value)) {
        output[key] = resolveInputValue(item, path + "." + key, seen);
      }
      return output;
    } finally {
      seen.delete(value);
    }
  };

  const resolveCurrentInput = () => {
    const json = JSON.stringify(input);
    if (resolvedInput?.json === json) return resolvedInput;
    const next = {
      json,
      props: resolveInputValue(input.props, "props"),
      payload: resolveInputValue(input.payload, "payload"),
      contextInput: resolveInputValue(input.context, "context"),
    };
    resolvedInput = next;
    context = profile.createContext
      ? profile.createContext(next.contextInput)
      : next.contextInput;
    return next;
  };

  const makeElement = (candidate: ComponentOnceLoadedDevArtifact) => {
    const current = resolveCurrentInput();
    const element = host.render({
      definition: candidate.definition,
      props: current.props,
      payload: current.payload,
      context,
      validation: {
        props: candidate.definition.validateProps !== undefined,
        payload: candidate.definition.validatePayload !== undefined,
      },
    });
    return profile.wrap ? profile.wrap(element, context) : element;
  };

  const render = () => {
    if (loaded === undefined || disposed) return;
    try {
      const element = makeElement(loaded);
      root ??= createRoot(node);
      renderKey += 1;
      root.render(
        <PreviewErrorBoundary key={renderKey} onError={fail}>
          {element}
        </PreviewErrorBoundary>,
      );
      send("rendered", { revision });
    } catch (error) {
      fail(error);
    }
  };

  const load = async () => {
    if (!ready) return;
    const ticket = ++generation;
    let candidate: ComponentOnceLoadedDevArtifact | undefined;
    try {
      const response = await fetch("/artifact", { cache: "no-store" });
      if (!response.ok) {
        throw new Error("Waiting for a successful source build.");
      }
      const update = (await response.json()) as ComponentOnceDevArtifact;
      candidate = await loadComponentOnceDevArtifact(update, externals);
      if (disposed || ticket !== generation) {
        candidate.dispose();
        return;
      }
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
      root.render(
        <PreviewErrorBoundary key={renderKey} onError={fail}>
          {element}
        </PreviewErrorBoundary>,
      );
      send("loaded", {
        revision,
        manifest: loaded.componentPackage.manifest,
        bytes: update.artifact.byteLength,
        externals: update.artifact.externalModules,
        assets: update.artifact.assets.map(
          ({ path, contentType, byteLength }) => ({
            path,
            contentType,
            byteLength,
          }),
        ),
      });
    } catch (error) {
      candidate?.dispose();
      if (!disposed && ticket === generation) fail(error);
    }
  };

  const onMessage = (event: MessageEvent) => {
    if (
      event.source !== window.parent ||
      event.origin !== window.location.origin ||
      event.data?.componentonce !== true
    ) {
      return;
    }
    const { type, value } = event.data as { type: string; value: Inputs };
    if (type === "inputs") {
      input = value;
      resolvedInput = undefined;
      render();
    }
    if (type === "reload") void load();
    if (type === "remount") render();
    if (type === "download" && loaded !== undefined) {
      send("download", JSON.stringify(loaded.componentPackage, null, 2));
    }
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
    disposed = true;
    generation += 1;
    window.removeEventListener("message", onMessage);
    window.removeEventListener("unhandledrejection", onUnhandled);
    root?.unmount();
    styleMount?.release();
    loaded?.dispose();
    profile.dispose?.();
  };
  window.addEventListener("pagehide", dispose, { once: true });

  void Promise.resolve()
    .then(() => profile.setup?.())
    .then(() => {
      if (disposed) return;
      ready = true;
      const fixtures = profile.fixtures ?? [
        { name: "Default", props: {}, payload: {}, context: {} },
      ];
      fixtures.forEach((fixture, index) =>
        assertFixtureHasNoRawFunctions(
          fixture,
          "fixtures[" + index + "]",
        ),
      );
      const functions = Object.entries(profile.functions ?? {})
        .map(([name, value]) => {
          const entry: ComponentOnceDevFunctionEntry =
            typeof value === "function" ? { call: value } : value;
          return {
            name,
            mode: entry.mode ?? "actual",
            ...(entry.description === undefined
              ? {}
              : { description: entry.description }),
          };
        })
        .sort((left, right) => left.name.localeCompare(right.name));
      send("ready", {
        name: profile.name ?? "React host",
        react: React.version,
        externals: Object.keys(externals),
        capabilities: [
          { name: "react", version: React.version },
          ...(profile.capabilities ?? []),
        ],
        fixtures,
        themes: profile.themes ?? [],
        functions,
      });
      // The parent sends the selected fixture then requests the artifact: no fixture/load race.
    })
    .catch(fail);
  return dispose;
}
