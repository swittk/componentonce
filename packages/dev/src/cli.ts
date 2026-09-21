#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { createComponentOnceDevServer } from "./server.js";

/** Run the local workbench CLI; Ctrl-C disposes compilers and releases its port. */
export async function runComponentOnceDevCli(args: readonly string[]): Promise<void> {
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    console.log("Usage: componentonce dev <entry.tsx> [--host browser-host.ts] [--external exact/specifier] [--port 4173] [--bind 127.0.0.1] [--allowed-host name] [--export definition]\n       componentonce-dev <entry.tsx> [same options]\nLocal trusted-code React workbench. Loopback is the default; --bind 0.0.0.0 explicitly exposes it to local interfaces.");
    return;
  }
  const entry = args[0];
  if (entry === undefined || entry.startsWith("-")) throw new Error("A component entry file is required.");
  let host: string | undefined;
  let port = 4173;
  let bind = "127.0.0.1";
  let definitionExport = "definition";
  const externalModules: string[] = [];
  const allowedHosts: string[] = [];
  for (let index = 1; index < args.length; index += 1) {
    const flag = args[index];
    const value = args[++index];
    if (value === undefined || value.startsWith("--")) throw new Error(String(flag) + " requires a value.");
    switch (flag) {
      case "--host": host = value; break;
      case "--port": port = Number(value); break;
      case "--bind": bind = value; break;
      case "--allowed-host": allowedHosts.push(value); break;
      case "--export": definitionExport = value; break;
      case "--external": externalModules.push(value); break;
      default: throw new Error("Unknown dev option " + flag);
    }
  }
  const server = await createComponentOnceDevServer({ entry, port, bind, allowedHosts, externalModules, definitionExport, ...(host === undefined ? {} : { host }) });
  console.log(
    "ComponentOnce Dev\n" +
      server.urls.map((url) => "  " + url).join("\n") +
      "\nListening on " + server.bind + ":" + server.port +
      "\nWatching " + entry +
      "\nSource changes remount the component; fixtures stay in memory. Trusted local code only.",
  );
  await new Promise<void>((done) => {
    const stop = () => {
      process.off("SIGINT", stop); process.off("SIGTERM", stop);
      void server.close().then(done, (error: unknown) => { console.error(error); done(); });
    };
    process.once("SIGINT", stop); process.once("SIGTERM", stop);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runComponentOnceDevCli(process.argv.slice(2)).catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
}
