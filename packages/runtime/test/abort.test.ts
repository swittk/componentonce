import { describe, expect, it, vi } from "vitest";
import {
  calculateTrustedBundleSha256,
  instantiateTrustedComponentPackage,
  prepareTrustedComponentPackageAssets,
  type ComponentOnceTrustedPackage,
  type InstantiateTrustedComponentOptions,
} from "../src/index.js";

async function createTrackedPackage(format: "v1" | "v2") {
  const evaluated = vi.fn();
  const manifest = { id: "example/cancelable", version: "1.0.0" };
  const code = [
    'require("host").evaluated();',
    "module.exports.definition = {",
    '  manifest: { id: "example/cancelable", version: "1.0.0" },',
    "  implementation: () => 42,",
    "};",
  ].join("\n");
  const bundle = {
    format: "componentonce.trusted-cjs.v1" as const,
    code,
    ...await calculateTrustedBundleSha256(code),
    externalModules: ["host"],
  };
  const common = { renderer: "custom", manifest, definitionExport: "definition", bundle };
  const componentPackage: ComponentOnceTrustedPackage = format === "v1"
    ? { ...common, format: "componentonce.trusted-package.v1" }
    : { ...common, format: "componentonce.trusted-package.v2", assets: [], stylesheets: [] };
  const options: InstantiateTrustedComponentOptions = {
    externals: { host: { evaluated } },
    ...(componentPackage.format === "componentonce.trusted-package.v2"
      ? { preparedAssets: await prepareTrustedComponentPackageAssets(componentPackage, {
        resolveAssetUrl: (asset) => "https://assets.example/" + asset.path,
      }) }
      : {}),
  };
  return { componentPackage, options, evaluated };
}

describe("trusted package evaluation cancellation", () => {
  it.each(["v1", "v2"] as const)("does not evaluate an already-aborted %s package", async (format) => {
    const { componentPackage, options, evaluated } = await createTrackedPackage(format);
    const controller = new AbortController();
    controller.abort();
    try {
      await expect(instantiateTrustedComponentPackage(componentPackage, {
        ...options,
        signal: controller.signal,
      })).rejects.toBe(controller.signal.reason);
      expect(controller.signal.reason).toMatchObject({ name: "AbortError" });
      expect(evaluated).not.toHaveBeenCalled();
    } finally {
      options.preparedAssets?.dispose();
    }
  });

  it("preserves the abort reason and skips evaluation after in-flight integrity verification", async () => {
    const { componentPackage, options, evaluated } = await createTrackedPackage("v1");
    const controller = new AbortController();
    const reason = { cause: "host navigated away" };
    let finishVerification!: () => void;
    const verificationGate = new Promise<void>((resolve) => { finishVerification = resolve; });
    const digest = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);
    const digestSpy = vi.spyOn(globalThis.crypto.subtle, "digest").mockImplementationOnce(
      async (algorithm, data) => {
        await verificationGate;
        return digest(algorithm, data);
      },
    );
    try {
      const pending = instantiateTrustedComponentPackage(componentPackage, {
        ...options,
        signal: controller.signal,
      });
      expect(digestSpy).toHaveBeenCalledOnce();
      expect(evaluated).not.toHaveBeenCalled();
      controller.abort(reason);
      const rejection = expect(pending).rejects.toBe(reason);
      finishVerification();
      await rejection;
      expect(evaluated).not.toHaveBeenCalled();
    } finally {
      finishVerification();
      digestSpy.mockRestore();
    }
  });

  it.each(["v1", "v2"] as const)("evaluates a %s package normally with a live signal", async (format) => {
    const { componentPackage, options, evaluated } = await createTrackedPackage(format);
    const controller = new AbortController();
    try {
      const definition = await instantiateTrustedComponentPackage(componentPackage, {
        ...options,
        signal: controller.signal,
      });
      expect(evaluated).toHaveBeenCalledOnce();
      expect((definition.implementation as () => number)()).toBe(42);
      controller.abort();
      expect((definition.implementation as () => number)()).toBe(42);
    } finally {
      options.preparedAssets?.dispose();
    }
  });
});
