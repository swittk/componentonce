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
