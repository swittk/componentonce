import { createServer, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import { basename, dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuildBuild, context as esbuildContext, type BuildContext, type Plugin } from "esbuild";
import { watchTrustedModuleFile, type ComponentOnceModuleWatcher, type ComponentOnceDiagnostic } from "@componentonce/compiler-esbuild";
import type { ComponentOnceDevArtifact, ComponentOnceDevStatus } from "./protocol.js";

/** Local development inputs. Only explicitly supplied entry/profile modules are compiled. */
export interface ComponentOnceDevServerOptions {
  readonly entry: string;
  /** Browser module exporting a default defineReactDevHost(...) profile. */
  readonly host?: string;
  readonly port?: number;
  /** Network interface/address to listen on. Defaults to loopback; use 0.0.0.0 explicitly for LAN access. */
  readonly bind?: string;
  /** Extra HTTP Host names accepted when intentionally exposing the trusted-code workbench. */
  readonly allowedHosts?: readonly string[];
  readonly cwd?: string;
  /** Additional exact imports allowed by the production compiler; values come from the profile. */
  readonly externalModules?: readonly string[];
  readonly definitionExport?: string;
}

/** A managed development workbench. Loopback is the safe default; broader binding must be explicit. */
export interface ComponentOnceDevServer {
  readonly url: string;
  readonly urls: readonly string[];
  readonly bind: string;
  readonly port: number;
  close(): Promise<void>;
}

const runtimeDirectory = dirname(fileURLToPath(import.meta.url));
const defaultExternals = ["react", "react/jsx-runtime", "react/jsx-dev-runtime", "@componentonce/react"];

function diagnostic(text: string): ComponentOnceDiagnostic { return { kind: "error", text, notes: [] }; }

function normalizeHostName(value: string): string | undefined {
  try {
    const hostname = new URL("http://" + value).hostname.toLowerCase();
    return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
  } catch {
    return undefined;
  }
}

function formatUrlHost(host: string): string {
  return host.includes(":") && !host.startsWith("[") ? "[" + host + "]" : host;
}

function localNetworkAddresses(): string[] {
  const output = new Set<string>(["127.0.0.1", "::1", "localhost"]);
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) output.add(entry.address.toLowerCase());
  }
  return [...output];
}

function advertisedNetworkAddresses(family: "IPv4" | "IPv6"): string[] {
  const output = new Set<string>(family === "IPv4" ? ["127.0.0.1", "localhost"] : ["::1", "localhost"]);
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      const matchesFamily =
        family === "IPv4"
          ? entry.family === "IPv4"
          : entry.family === "IPv6";
      if (!entry.internal && matchesFamily && !entry.address.toLowerCase().startsWith("fe80:")) {
        output.add(entry.address.toLowerCase());
      }
    }
  }
  return [...output];
}

/** Start an in-memory source compiler and a separate browser-host/workbench compiler. */
export async function createComponentOnceDevServer(options: ComponentOnceDevServerOptions): Promise<ComponentOnceDevServer> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const entry = resolve(cwd, options.entry);
  const profile = options.host === undefined ? undefined : resolve(cwd, options.host);
  if (!(await stat(entry)).isFile()) throw new Error("Component entry must be a file.");
  if (profile !== undefined && !(await stat(profile)).isFile()) throw new Error("Host profile must be a file.");
  const portOption = options.port ?? 4173;
  if (!Number.isInteger(portOption) || portOption < 0 || portOption > 65535) throw new Error("Port must be an integer between 0 and 65535.");
  const bind = (options.bind ?? "127.0.0.1").trim();
  if (!bind || bind.includes("://") || /[/?#]/.test(bind)) throw new Error("Bind must be a host/address without a scheme, port, path, query, or hash.");
  const allowedHosts = new Set(localNetworkAddresses());
  allowedHosts.add(bind.toLowerCase());
  for (const host of options.allowedHosts ?? []) {
    const normalized = normalizeHostName(host);
    if (normalized === undefined) throw new Error("Invalid allowed host " + JSON.stringify(host) + ".");
    allowedHosts.add(normalized);
  }
  const sourceExternals = [...new Set([...defaultExternals, ...(options.externalModules ?? [])])];
  let revision = 0;
  let hostRevision = 0;
  let currentArtifact: ComponentOnceDevArtifact | undefined;
  let sourceStatus: ComponentOnceDevStatus = { revision, hostRevision, stage: "source", ok: false, durationMs: 0, diagnostics: [] };
  let hostStatus: ComponentOnceDevStatus = { revision, hostRevision, stage: "host", ok: false, durationMs: 0, diagnostics: [] };
  const connections = new Set<ServerResponse>();
  let builtFiles = new Map<string, Uint8Array>();
  let closed = false;
  const snapshot = () => ({ source: sourceStatus, host: hostStatus });
  const broadcast = () => {
    for (const connection of connections) connection.write("event: status\ndata: " + JSON.stringify(snapshot()) + "\n\n");
  };
  const stylesheet = await readFile(resolve(runtimeDirectory, "workbench.css"));
  const uiBuild = await esbuildBuild({ entryPoints: [resolve(runtimeDirectory, "ui.js")], bundle: true, write: false, format: "esm", platform: "browser", target: "es2022", logLevel: "silent" });
  const uiBytes = uiBuild.outputFiles[0]?.contents;
  if (uiBytes === undefined) throw new Error("Could not compile the workbench UI.");
  const html = (preview: boolean) => '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ComponentOnce Dev</title>' +
    (preview ? '<link rel="stylesheet" href="/preview.css">' : '<link rel="stylesheet" href="/workbench.css">') +
    '</head><body>' + (preview ? '<div id="preview-root"></div>' : '<div id="workbench"></div>') +
    '<script type="module" src="/' + (preview ? 'preview' : 'ui') + '.js"></script></body></html>';
  let port = 0;
  const http = createServer((request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("X-Frame-Options", "SAMEORIGIN");
    // No arbitrary hostnames/CORS: prevent DNS rebinding and drive-by source/credential reads.
    const requestHost = request.headers.host ?? "";
    const requestHostName = normalizeHostName(requestHost);
    if (requestHostName === undefined || !allowedHosts.has(requestHostName)) { response.writeHead(403).end("Invalid development host"); return; }
    if (request.headers.origin) {
      let originHost: string | undefined;
      try { originHost = new URL(request.headers.origin).host.toLowerCase(); } catch { originHost = undefined; }
      if (originHost !== requestHost.toLowerCase()) { response.writeHead(403).end("Cross-origin requests are not allowed"); return; }
    }
    if (request.headers["sec-fetch-site"] === "cross-site") { response.writeHead(403).end("Cross-site requests are not allowed"); return; }
    if (request.method !== "GET" && request.method !== "HEAD") { response.writeHead(405, { Allow: "GET, HEAD" }).end(); return; }
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    const send = (contentType: string, data: string | Uint8Array, status = 200) => {
      response.writeHead(status, { "Content-Type": contentType });
      response.end(request.method === "HEAD" ? undefined : data);
    };
    if (pathname === "/" || pathname === "/preview") { send("text/html; charset=utf-8", html(pathname === "/preview")); return; }
    if (pathname === "/ui.js") { send("text/javascript; charset=utf-8", uiBytes); return; }
    if (pathname === "/workbench.css") { send("text/css; charset=utf-8", stylesheet); return; }
    if (pathname === "/preview.css" && !builtFiles.has(pathname)) { send("text/css; charset=utf-8", "body{margin:0;padding:24px;font-family:system-ui,sans-serif}*{box-sizing:border-box}"); return; }
    if (pathname === "/status") { send("application/json", JSON.stringify(snapshot())); return; }
    if (pathname === "/artifact") {
      if (currentArtifact === undefined) { send("application/json", JSON.stringify({ error: "No successful source build yet" }), 503); return; }
      send("application/json", JSON.stringify(currentArtifact)); return;
    }
    if (pathname === "/events" && request.method === "GET") {
      if (connections.size >= 32) { response.writeHead(503).end("Too many preview connections"); return; }
      response.writeHead(200, { "Content-Type": "text/event-stream", Connection: "keep-alive" });
      response.write("event: status\ndata: " + JSON.stringify(snapshot()) + "\n\n");
      connections.add(response);
      request.on("close", () => connections.delete(response));
      return;
    }
    const file = builtFiles.get(pathname);
    if (file !== undefined) {
      const extension = pathname.slice(pathname.lastIndexOf('.'));
      const type: Record<string, string> = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.woff2': 'font/woff2', '.woff': 'font/woff', '.json': 'application/json' };
      send(type[extension] ?? "application/octet-stream", file); return;
    }
    send("text/plain; charset=utf-8", "Not found", 404);
  });
  const heartbeat = setInterval(() => { for (const connection of connections) connection.write(": heartbeat\n\n"); }, 15000);
  heartbeat.unref();
  let watcher: ComponentOnceModuleWatcher | undefined;
  let harness: BuildContext | undefined;
  const close = async () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    for (const connection of connections) connection.end();
    connections.clear();
    await Promise.all([watcher?.dispose(), harness?.dispose()]);
    await new Promise<void>((done) => { http.close(() => done()); http.closeAllConnections(); });
    builtFiles.clear();
    currentArtifact = undefined;
  };
  try {
    await new Promise<void>((done, reject) => {
      http.once("error", reject);
      http.listen(portOption, bind, () => { http.off("error", reject); done(); });
    });
    const address = http.address();
    if (address === null || typeof address === "string") throw new Error("Missing HTTP address.");
    port = address.port;
    const outputDirectory = resolve(cwd, ".componentonce-dev-output");
    // Resolve the import condition, not Node's require condition (many hosts are ESM-only).
    // Pin the entire host graph to the consuming workspace's React/adapter singleton.
    const pinSingletons: Plugin = {
      name: "componentonce-dev-singletons",
      setup(api) {
        api.onResolve({ filter: /^(react(?:\/.*)?|react-dom(?:\/.*)?|@componentonce\/(?:react|core|runtime)|@componentonce\/dev\/host)$/ }, async (args) => {
          if (args.pluginData?.componentOncePinned === true) return undefined;
          if (args.path === "@componentonce/dev/host") return { path: resolve(runtimeDirectory, "host.js") };
          const options = { kind: "import-statement" as const, pluginData: { componentOncePinned: true } };
          const consumer = await api.resolve(args.path, { ...options, resolveDir: cwd });
          return consumer.errors.length === 0 ? consumer : api.resolve(args.path, { ...options, resolveDir: runtimeDirectory });
        });
      },
    };
    const previewEntry = (profile === undefined ? 'const profile = {};\n' : 'import profile from ' + JSON.stringify(profile) + ';\n') +
      'import { mountComponentOncePreview } from ' + JSON.stringify(resolve(runtimeDirectory, "preview.js")) + ';\nmountComponentOncePreview(profile);';
    harness = await esbuildContext({
      absWorkingDir: cwd,
      entryPoints: { preview: "componentonce-dev:preview" },
      bundle: true, write: false, format: "esm", platform: "browser", target: "es2022",
      outdir: outputDirectory, assetNames: "host-assets/[hash]", publicPath: "/", sourcemap: "inline",
      jsx: "automatic", logLevel: "silent", define: { "process.env.NODE_ENV": '"development"' },
      loader: { '.png': 'file', '.jpg': 'file', '.jpeg': 'file', '.svg': 'file', '.webp': 'file', '.woff': 'file', '.woff2': 'file' },
      plugins: [pinSingletons, {
        name: "componentonce-dev-browser-entries",
        setup(api) {
          api.onResolve({ filter: /^componentonce-dev:/ }, (args) => ({ path: args.path, namespace: "componentonce-dev" }));
          api.onLoad({ filter: /.*/, namespace: "componentonce-dev" }, (args) => ({ contents: args.path.endsWith(":preview") ? previewEntry : 'import ' + JSON.stringify(resolve(runtimeDirectory, "ui.js")), resolveDir: cwd, loader: "ts" }));
          let start = 0;
          api.onStart(() => { start = performance.now(); });
          api.onEnd((result) => {
            if (result.errors.length > 0 || result.outputFiles === undefined) {
              hostStatus = { stage: "host", ok: false, revision, hostRevision, durationMs: performance.now() - start, diagnostics: result.errors.map((error) => diagnostic(error.text)) };
            } else {
              builtFiles = new Map(result.outputFiles.map((file) => ["/" + relative(outputDirectory, file.path).replaceAll("\\", "/"), file.contents]));
              hostRevision += 1;
              hostStatus = { stage: "host", ok: true, revision, hostRevision, durationMs: performance.now() - start, diagnostics: result.warnings.map((warning) => ({ ...diagnostic(warning.text), kind: "warning" })) };
            }
            broadcast();
          });
        },
      }],
    });
    // The independent workbench remains usable after an initial host compilation failure.
    try { await harness.rebuild(); } catch { /* onEnd reports errors; keep watching for a fix. */ }
    await harness.watch();
    watcher = await watchTrustedModuleFile({
      entry, jsx: "automatic", externalModules: sourceExternals,
      onBuild(result) {
        if (result.ok) {
          revision += 1;
          currentArtifact = { revision, definitionExport: options.definitionExport ?? "definition", artifact: result.artifact };
        }
        sourceStatus = {
          stage: "source", ok: result.ok, revision, hostRevision,
          durationMs: result.durationMs,
          diagnostics: result.ok ? result.artifact.diagnostics : result.diagnostics,
        };
        broadcast();
      },
    });
    const hostsForUrls =
      bind === "0.0.0.0"
        ? advertisedNetworkAddresses("IPv4")
        : bind === "::"
          ? advertisedNetworkAddresses("IPv6")
          : [bind];
    const urls = [...new Set(hostsForUrls.map((host) => "http://" + formatUrlHost(host) + ":" + port))];
    const loopbackUrl = urls.find((url) => url.startsWith("http://127.0.0.1:")) ?? urls[0] ?? "http://127.0.0.1:" + port;
    return { url: loopbackUrl, urls, bind, port, close };
  } catch (error) { await close(); throw error; }
}
