import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { compileTrustedModule, watchTrustedModuleFile, type ComponentOnceWatchResult } from "../src/index.js";

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
    expect(error && !error.ok && error.diagnostics[0]?.text).toContain("not an allowed host external");
    await writeFile(entry, source);
    await watcher.rebuild();
    expect(results.at(-1)?.ok).toBe(true);
    expect(await readFile(entry, "utf8")).toBe(source);
  } finally { await watcher.dispose(); await watcher.dispose(); await rm(dir, { recursive: true, force: true }); }
}, 30000);
