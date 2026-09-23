import { execFile } from "node:child_process";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, expect, it, vi } from "vitest";
import { runComponentOnceDevCli } from "../dist/index.js";

const execFileAsync = promisify(execFile);

afterEach(() => {
  vi.restoreAllMocks();
});

it("does not let help flags satisfy an option that requires a value", async () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  await expect(
    runComponentOnceDevCli(["entry.tsx", "--host", "-h"]),
  ).rejects.toThrow("--host requires a value.");
  await expect(
    runComponentOnceDevCli(["entry.tsx", "--port", "--help"]),
  ).rejects.toThrow("--port requires a value.");
  expect(log).not.toHaveBeenCalled();
});

it("still handles help as an operand-free flag", async () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  await expect(runComponentOnceDevCli(["-h"])).resolves.toBeUndefined();
  await expect(
    runComponentOnceDevCli(["entry.tsx", "--help"]),
  ).resolves.toBeUndefined();
  expect(log).toHaveBeenCalledTimes(2);
  expect(log).toHaveBeenLastCalledWith(expect.stringContaining("Usage:"));
});


it("runs the dev CLI when invoked through a symlink", async () => {
  const root = await mkdtemp(join(tmpdir(), "componentonce-dev-cli-link-"));
  try {
    const target = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
    const link = join(root, "componentonce-dev");
    await symlink(target, link);
    const { stdout, stderr } = await execFileAsync(process.execPath, [link, "--help"]);
    expect(stdout).toContain("Usage: componentonce dev");
    expect(stderr).toBe("");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
