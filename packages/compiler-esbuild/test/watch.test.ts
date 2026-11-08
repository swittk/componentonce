import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { compileTrustedModule, instantiateTrustedBundle, watchTrustedModuleFile, type ComponentOnceWatchResult } from "../src/index.js";

async function until(predicate: () => boolean) {
  const end = Date.now() + 10000;
  while (!predicate()) { if (Date.now() > end) throw new Error("Timed out waiting for watch rebuild"); await new Promise((r) => setTimeout(r, 30)); }
}

it("watches imports, CSS Modules and assets; recovers syntax and missing imports; matches the production compiler", async () => {
  const dir = await mkdtemp(join(tmpdir(), "componentonce-watch-"));
  const entry = join(dir, "entry.tsx");
  const source = 'import { label } from "./label"; import css from "./styles.module.css"; import image from "./image.svg"; export const value={label,css,image};';
  await writeFile(entry, source);
  await writeFile(join(dir, "label.ts"), 'export const label="first";');
  await writeFile(join(dir, "styles.module.css"), '.card { color: red; background: url("./image.svg") }');
  await writeFile(join(dir, "image.svg"), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  const results: ComponentOnceWatchResult[] = [];
  const watcher = await watchTrustedModuleFile({ entry, jsx: "automatic", onBuild(result) { results.push(result); } });
  try {
    await until(() => results.some((r) => r.ok));
    const canonical = await compileTrustedModule({ source, sourceFileName: "entry.tsx", resolveDir: dir, jsx: "automatic" });
    const first = results.find((r) => r.ok);
    expect(first?.ok && first.artifact.sha256).toBe(canonical.sha256);
    let count = results.length;
    await writeFile(join(dir, "label.ts"), 'export const label="second";');
    await until(() => results.length > count && results.at(-1)?.ok === true);
    expect(results.at(-1)?.ok && (results.at(-1) as Extract<ComponentOnceWatchResult, {ok:true}>).artifact.code).toContain("second");
    count = results.length;
    await writeFile(join(dir, "styles.module.css"), '.card { color: blue; background: url("./image.svg") }');
    await until(() => results.length > count && results.at(-1)?.ok === true);
    count = results.length;
    await writeFile(join(dir, "image.svg"), '<svg xmlns="http://www.w3.org/2000/svg"><title>updated</title></svg>');
    await until(() => results.length > count && results.at(-1)?.ok === true);
    count = results.length;
    await writeFile(entry, 'export const = syntax error');
    await until(() => results.length > count && results.at(-1)?.ok === false);
    count = results.length;
    await writeFile(entry, source + 'import { x } from "./missing"; export {x};');
    await until(() => results.length > count && results.at(-1)?.ok === false);
    count = results.length;
    await writeFile(join(dir, "missing.ts"), 'export const x=42;');
    await until(() => results.length > count && results.at(-1)?.ok === true);
    count = results.length;
    await writeFile(entry, 'import fs from "node:fs"; export {fs};');
    await until(() => results.length > count && results.at(-1)?.ok === false);
    const error = results.at(-1);
    expect(error && !error.ok && error.diagnostics[0]?.text).toContain("neither a bundled implementation module nor an allowed host external");
    await writeFile(entry, source);
    await watcher.rebuild();
    expect(results.at(-1)?.ok).toBe(true);
    expect(await readFile(entry, "utf8")).toBe(source);
  } finally { await watcher.dispose(); await watcher.dispose(); await rm(dir, { recursive: true, force: true }); }
}, 30000);


it.each(["exports", "main"] as const)("watches a bundled package resolved through %s", async (field) => {
  const dir = await mkdtemp(join(tmpdir(), "componentonce-watch-bundle-"));
  const entry = join(dir, "entry.ts");
  const packageDir = join(dir, "node_modules", "fixture-watch-bundle");
  await mkdir(packageDir, { recursive: true });
  await writeFile(
    join(packageDir, "package.json"),
    JSON.stringify({
      name: "fixture-watch-bundle",
      version: "1.0.0",
      type: "module",
      [field]: "./entry.js",
    }),
  );
  await writeFile(join(packageDir, "entry.js"), [
    'if (process.env.NODE_ENV !== "production") require("development-only");',
    'export const label = "first";',
  ].join("\n"));
  await writeFile(
    entry,
    'import { label } from "fixture-watch-bundle"; export { label };',
  );
  const results: ComponentOnceWatchResult[] = [];
  const watcher = await watchTrustedModuleFile({
    entry,
    bundleModules: ["fixture-watch-bundle"],
    onBuild(result) {
      results.push(result);
    },
  });
  try {
    await until(() => results.some((result) => result.ok));
    const first = results.find(
      (result): result is Extract<ComponentOnceWatchResult, { ok: true }> =>
        result.ok,
    );
    expect(first?.artifact.externalModules).toEqual([]);
    expect(first).toBeDefined();
    expect(instantiateTrustedBundle<{ label: string }>(first!.artifact, { externals: {} }).label).toBe("first");

    const count = results.length;
    await writeFile(
      join(packageDir, "entry.js"),
      'export const label = "second";\n',
    );
    await until(
      () =>
        results.length > count &&
        results.at(-1)?.ok === true &&
        (
          results.at(-1) as Extract<ComponentOnceWatchResult, { ok: true }>
        ).artifact.code.includes("second"),
    );
    const rebuilt = results.at(-1);
    expect(rebuilt?.ok).toBe(true);
    if (rebuilt?.ok) {
      expect(instantiateTrustedBundle<{ label: string }>(rebuilt.artifact, { externals: {} }).label).toBe("second");
    }
  } finally {
    await watcher.dispose();
    await rm(dir, { recursive: true, force: true });
  }
}, 20000);

it("refreshes private import scopes when a nested package manifest changes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "componentonce-watch-scopes-"));
  const entry = join(dir, "entry.ts");
  const nested = join(dir, "nested");
  await mkdir(nested);
  const manifest = JSON.stringify({ type: "module", imports: { "#value": "./value.js" } });
  await writeFile(join(dir, "package.json"), manifest);
  await writeFile(join(nested, "package.json"), manifest);
  await writeFile(join(dir, "value.js"), 'export const label = "ancestor";');
  await writeFile(join(nested, "value.js"), 'export const label = "nested";');
  await writeFile(join(nested, "index.js"), 'export { label } from "#value";');
  await writeFile(entry, 'export { label } from "./nested/index.js";');
  const results: ComponentOnceWatchResult[] = [];
  const watcher = await watchTrustedModuleFile({
    entry,
    onBuild(result) { results.push(result); },
  });
  const latestLabel = () => {
    const result = results.at(-1);
    expect(result?.ok).toBe(true);
    if (!result?.ok) return undefined;
    return instantiateTrustedBundle<{ label: string }>(result.artifact, { externals: {} }).label;
  };
  try {
    await until(() => results.some((result) => result.ok));
    expect(latestLabel()).toBe("nested");
    await rm(join(nested, "package.json"));
    await watcher.rebuild();
    expect(latestLabel()).toBe("ancestor");
    await writeFile(join(nested, "package.json"), manifest);
    await watcher.rebuild();
    expect(latestLabel()).toBe("nested");
  } finally {
    await watcher.dispose();
    await rm(dir, { recursive: true, force: true });
  }
}, 20000);
