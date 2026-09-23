#!/usr/bin/env node
import { existsSync, realpathSync } from "node:fs";
import { resolve as resolveEsm } from "import-meta-resolve";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, extname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  buildTrustedDefinitionPackage,
  buildTrustedReactPackage,
  serializeTrustedComponentPackage,
} from "./package.js";
import type { ComponentOnceAdditionalLoader } from "./compiler.js";

interface CliBuildOptions {
  readonly entry: string;
  readonly renderer: string;
  readonly out: string;
  readonly definitionExport?: string;
  readonly externalModules: readonly string[];
  readonly loaders: Readonly<Record<string, ComponentOnceAdditionalLoader>>;
  readonly contentTypes: Readonly<Record<string, string>>;
}

const REACT_HOST_EXTERNALS = [
  "react",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
  "@componentonce/react",
] as const;
const DOM_HOST_EXTERNALS = ["@componentonce/dom"] as const;

/** Run the ComponentOnce command line interface with ordinary process arguments. */
export async function runComponentOnceCli(args: readonly string[]): Promise<void> {
  if (args[0] === "dev") {
    // Optional tooling is resolved from the consuming workspace: no dependency cycle.
    const requireFromConsumer = createRequire(resolve(process.cwd(), "package.json"));
    let entry: string | undefined;
    try { entry = requireFromConsumer.resolve("@componentonce/dev"); }
    catch {
      // Source-workspace fallback for this monorepo only. Published consumers resolve above.
      const sibling = resolve(dirname(fileURLToPath(import.meta.url)), "../../dev/dist/index.js");
      if (existsSync(sibling)) entry = sibling;
    }
    if (entry === undefined) throw new Error("Install @componentonce/dev in this workspace to use componentonce dev.");
    const tooling = await import(pathToFileURL(entry).href) as { runComponentOnceDevCli(args: readonly string[]): Promise<void> };
    await tooling.runComponentOnceDevCli(args.slice(1));
    return;
  }
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    process.stdout.write(usage());
    return;
  }
  if (args[0] !== "build") {
    throw new Error("Unknown command \"" + String(args[0]) + "\".\n\n" + usage());
  }

  const options = parseBuildArgs(args.slice(1));
  const entryPath = resolve(options.entry);
  const source = await readFile(entryPath, "utf8");
  const sourceDir = dirname(entryPath);
  const externalNames = uniqueStrings([
    ...(options.renderer === "react" ? REACT_HOST_EXTERNALS : []),
    ...(options.renderer === "dom" ? DOM_HOST_EXTERNALS : []),
    ...options.externalModules,
  ]);
  const externals = await loadExternals(externalNames, sourceDir);

  const componentPackage =
    options.renderer === "react"
      ? await buildTrustedReactPackage({
          source,
          sourceFileName: basename(entryPath),
          resolveDir: sourceDir,
          externals,
          loaders: options.loaders,
          contentTypes: options.contentTypes,
          ...(options.definitionExport === undefined
            ? {}
            : { definitionExport: options.definitionExport }),
        })
      : await buildTrustedDefinitionPackage({
          source,
          sourceFileName: basename(entryPath),
          resolveDir: sourceDir,
          renderer: options.renderer,
          externals,
          loaders: options.loaders,
          contentTypes: options.contentTypes,
          ...(options.definitionExport === undefined
            ? {}
            : { definitionExport: options.definitionExport }),
        });

  const outPath = resolve(options.out);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, serializeTrustedComponentPackage(componentPackage) + "\n", "utf8");
  process.stdout.write(
    "Built " +
      componentPackage.manifest.id +
      "@" +
      componentPackage.manifest.version +
      " (" +
      componentPackage.renderer +
      ") -> " +
      outPath +
      "\n",
  );
}

function parseBuildArgs(args: readonly string[]): CliBuildOptions {
  const entry = args[0];
  if (entry === undefined || entry.startsWith("-")) {
    throw new Error("componentonce build requires an entry source file.\n\n" + usage());
  }

  let renderer = "react";
  let out: string | undefined;
  let definitionExport: string | undefined;
  const externalModules: string[] = [];
  const loaders: Record<string, ComponentOnceAdditionalLoader> = {};
  const contentTypes: Record<string, string> = {};

  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case "--renderer": {
        renderer = requireOptionValue(args, ++index, "--renderer");
        break;
      }
      case "--out":
      case "-o": {
        out = requireOptionValue(args, ++index, String(arg));
        break;
      }
      case "--export": {
        definitionExport = requireOptionValue(args, ++index, "--export");
        break;
      }
      case "--external": {
        externalModules.push(requireOptionValue(args, ++index, "--external"));
        break;
      }
      case "--loader": {
        const [extension, loader] = parseAssignment(
          requireOptionValue(args, ++index, "--loader"),
          "--loader",
        );
        if (!isAdditionalLoader(loader)) {
          throw new Error("Unsupported --loader value " + JSON.stringify(loader) + ".");
        }
        loaders[extension] = loader;
        break;
      }
      case "--content-type": {
        const [extension, contentType] = parseAssignment(
          requireOptionValue(args, ++index, "--content-type"),
          "--content-type",
        );
        contentTypes[extension] = contentType;
        break;
      }
      default:
        throw new Error("Unknown build option \"" + String(arg) + "\".\n\n" + usage());
    }
  }

  return {
    entry,
    renderer,
    out: out ?? defaultOutputPath(entry),
    ...(definitionExport === undefined ? {} : { definitionExport }),
    externalModules,
    loaders,
    contentTypes,
  };
}

function parseAssignment(value: string, option: string): [string, string] {
  const separator = value.indexOf("=");
  if (separator <= 0 || separator === value.length - 1) {
    throw new Error(option + " requires <extension>=<value>.");
  }
  return [value.slice(0, separator), value.slice(separator + 1)];
}

function isAdditionalLoader(value: string): value is ComponentOnceAdditionalLoader {
  return [
    "base64",
    "binary",
    "css",
    "dataurl",
    "file",
    "global-css",
    "json",
    "local-css",
    "text",
  ].includes(value);
}

function requireOptionValue(
  args: readonly string[],
  index: number,
  option: string,
): string {
  const value = args[index];
  if (value === undefined || value.startsWith("-")) {
    throw new Error(option + " requires a value.");
  }
  return value;
}

function defaultOutputPath(entry: string): string {
  const extension = extname(entry);
  const base = extension === "" ? entry : entry.slice(0, -extension.length);
  return base + ".componentonce.json";
}

async function loadExternals(
  specifiers: readonly string[],
  sourceDir: string,
): Promise<Record<string, unknown>> {
  const parentUrl = pathToFileURL(
    resolve(sourceDir, "__componentonce_resolve__.mjs"),
  ).href;
  const resolver = createRequire(parentUrl);
  const externals: Record<string, unknown> = {};
  for (const specifier of specifiers) {
    externals[specifier] = await loadExternal(specifier, resolver, parentUrl);
  }
  return externals;
}

async function loadExternal(
  specifier: string,
  resolver: NodeJS.Require,
  parentUrl: string,
): Promise<unknown> {
  try {
    return resolver(specifier);
  } catch (error: unknown) {
    if (!canRetryAsEsm(error)) throw error;
    let resolved: string;
    try {
      resolved = resolveEsm(specifier, parentUrl);
    } catch {
      throw error;
    }
    return import(resolved);
  }
}

function canRetryAsEsm(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  const code = (error as { readonly code?: unknown }).code;
  return code === "ERR_REQUIRE_ESM" || code === "ERR_PACKAGE_PATH_NOT_EXPORTED";
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function usage(): string {
  return [
    "ComponentOnce trusted component builder",
    "",
    "Usage:",
    "  componentonce dev <entry> [--host <browser-profile.ts>] [--port <port>] [--bind <address>] (requires @componentonce/dev)",
    "  componentonce build <entry> [options]",
    "",
    "Options:",
    "  --renderer <id>    Renderer id recorded in the package (default: react)",
    "  -o, --out <file>   Output JSON package (default: <entry>.componentonce.json)",
    "  --export <name>    Definition export name (default: definition)",
    "  --external <name>  Host module to keep external and load for trusted build-time discovery",
    "  --loader <ext=kind> Additional esbuild loader, for example .bin=file or .svg=dataurl",
    "  --content-type <ext=type>  Media type override for an emitted file-loader asset",
    "  -h, --help         Show this help",
    "",
    "React builds automatically externalize react, JSX runtimes, and @componentonce/react.",
    "DOM builds automatically externalize @componentonce/dom.",
    "Relative imports are bundled from the entry file directory.",
    "",
  ].join("\n");
}

function isDirectExecution(): boolean {
  const invoked = process.argv[1];
  if (invoked === undefined) return false;
  try {
    return (
      realpathSync(resolve(invoked)) ===
      realpathSync(fileURLToPath(import.meta.url))
    );
  } catch {
    return false;
  }
}

if (isDirectExecution()) {
  runComponentOnceCli(process.argv.slice(2)).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write("componentonce: " + message + "\n");
    process.exitCode = 1;
  });
}
