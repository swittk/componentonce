import { afterEach, expect, it, vi } from "vitest";
import { runComponentOnceDevCli } from "../dist/index.js";

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
