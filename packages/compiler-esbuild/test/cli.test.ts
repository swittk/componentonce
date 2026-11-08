import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { runComponentOnceCli } from "../src/cli.js";
import { parseTrustedComponentPackage } from "../src/package.js";

const execFileAsync = promisify(execFile);

it("resolves import-only ESM externals from the component entry directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "componentonce-cli-esm-"));
  try {
    const packageDirectory = join(root, "node_modules", "fixture-import-only");
    await mkdir(packageDirectory, { recursive: true });
    await writeFile(
      join(packageDirectory, "package.json"),
      JSON.stringify({
        name: "fixture-import-only",
        version: "1.0.0",
        type: "module",
        exports: {
          ".": {
            import: "./index.js",
          },
        },
      }),
    );
    await writeFile(
      join(packageDirectory, "index.js"),
      'export const manifestId = "consumer.esm-external";\n',
    );

    const entry = join(root, "entry.ts");
    const out = join(root, "component.componentonce.json");
    await writeFile(
      entry,
      [
        'import * as external from "fixture-import-only";',
        "export const definition = {",
        '  manifest: { id: external.manifestId, version: "1.0.0" },',
        "  implementation: () => null,",
        "};",
      ].join("\n"),
    );

    await runComponentOnceCli([
      "build",
      entry,
      "--renderer",
      "test",
      "--external",
      "fixture-import-only",
      "--out",
      out,
    ]);

    const componentPackage = parseTrustedComponentPackage(await readFile(out));
    expect(componentPackage.manifest.id).toBe("consumer.esm-external");
    expect(componentPackage.bundle.externalModules).toContain(
      "fixture-import-only",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});


it("runs the built CLI when invoked through a symlink", async () => {
  const root = await mkdtemp(join(tmpdir(), "componentonce-cli-link-"));
  try {
    const target = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
    const link = join(root, "componentonce");
    await symlink(target, link);
    const { stdout, stderr } = await execFileAsync(process.execPath, [link, "--help"]);
    expect(stdout).toContain("ComponentOnce trusted component builder");
    expect(stdout).toContain("Usage:");
    expect(stderr).toBe("");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});


it.each(["test", "react"])("bundles both required packages from repeated --bundle options for %s", async (renderer) => {
  const root = await mkdtemp(join(tmpdir(), "componentonce-cli-bundle-"));
  try {
    if (renderer === "react") {
      await mkdir(join(root, "node_modules", "@componentonce"), { recursive: true });
      await symlink(
        fileURLToPath(new URL("../node_modules/react", import.meta.url)),
        join(root, "node_modules", "react"),
      );
      await symlink(
        fileURLToPath(new URL("../../react", import.meta.url)),
        join(root, "node_modules", "@componentonce", "react"),
      );
    }
    const packageDirectory = join(root, "node_modules", "fixture-cli-bundle");
    await mkdir(packageDirectory, { recursive: true });
    await writeFile(
      join(packageDirectory, "package.json"),
      JSON.stringify({
        name: "fixture-cli-bundle",
        version: "1.0.0",
        type: "module",
        exports: "./index.js",
      }),
    );
    await writeFile(
      join(packageDirectory, "index.js"),
      'import { suffix } from "fixture-cli-helper"; export const id = "consumer." + suffix;\n',
    );
    const helperDirectory = join(root, "node_modules", "fixture-cli-helper");
    await mkdir(helperDirectory, { recursive: true });
    await writeFile(join(helperDirectory, "package.json"), JSON.stringify({
      name: "fixture-cli-helper", version: "1.0.0", type: "module", exports: "./index.js",
    }));
    await writeFile(join(helperDirectory, "index.js"), 'export const suffix = "bundled";');
    const entry = join(root, "entry.ts");
    const out = join(root, "component.componentonce.json");
    await writeFile(
      entry,
      [
        'import { id } from "fixture-cli-bundle";',
        "export const definition = {",
        '  manifest: { id, version: "1.0.0" },',
        "  implementation: () => null,",
        "};",
      ].join("\n"),
    );

    await runComponentOnceCli([
      "build",
      entry,
      "--renderer",
      renderer,
      "--bundle",
      "fixture-cli-bundle",
      "--bundle",
      "fixture-cli-helper",
      "--out",
      out,
    ]);
    const componentPackage = parseTrustedComponentPackage(await readFile(out));
    expect(componentPackage.renderer).toBe(renderer);
    expect(componentPackage.manifest.id).toBe("consumer.bundled");
    expect(componentPackage.bundle.externalModules).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
