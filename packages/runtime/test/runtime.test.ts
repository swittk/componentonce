import { describe, expect, it } from "vitest";
import {
  ComponentOnceIntegrityError,
  ComponentOnceMissingExternalError,
  ComponentOncePackageManifestMismatchError,
  calculateTrustedBundleSha256,
  instantiateTrustedComponentPackage,
  parseTrustedComponentPackage,
  type ComponentOnceTrustedPackage,
} from "../src/index.js";

async function createPackage(
  code: string,
  manifest = { id: "example/card", version: "1.0.0" },
  externalModules: readonly string[] = [],
): Promise<ComponentOnceTrustedPackage> {
  const hash = await calculateTrustedBundleSha256(code);
  return {
    format: "componentonce.trusted-package.v1",
    renderer: "custom",
    manifest,
    definitionExport: "definition",
    bundle: {
      format: "componentonce.trusted-cjs.v1",
      code,
      byteLength: hash.byteLength,
      sha256: hash.sha256,
      integrity: hash.integrity,
      externalModules,
    },
  };
}

describe("browser-safe trusted runtime", () => {
  it("parses, verifies, and instantiates an exact package with host externals", async () => {
    const hostValue = { marker: "host-singleton" };
    const componentPackage = await createPackage(
      [
        'const host = require("host-value");',
        "module.exports.definition = {",
        '  manifest: { id: "example/card", version: "1.0.0" },',
        "  implementation: () => host,",
        "};",
      ].join("\n"),
      { id: "example/card", version: "1.0.0" },
      ["host-value"],
    );

    const parsed = parseTrustedComponentPackage(
      JSON.stringify(componentPackage),
    );
    const definition = await instantiateTrustedComponentPackage(parsed, {
      externals: { "host-value": hostValue },
    });

    expect(definition.manifest).toEqual({
      id: "example/card",
      version: "1.0.0",
    });
    expect(
      (definition.implementation as () => unknown)(),
    ).toBe(hostValue);
  });

  it("rejects a missing external deterministically", async () => {
    const componentPackage = await createPackage(
      [
        'const host = require("host-value");',
        "module.exports.definition = {",
        '  manifest: { id: "example/card", version: "1.0.0" },',
        "  implementation: () => host,",
        "};",
      ].join("\n"),
      { id: "example/card", version: "1.0.0" },
      ["host-value"],
    );

    await expect(
      instantiateTrustedComponentPackage(componentPackage, {
        externals: {},
      }),
    ).rejects.toBeInstanceOf(ComponentOnceMissingExternalError);
  });

  it("detects tampered executable bytes before evaluation", async () => {
    const componentPackage = await createPackage(
      'module.exports.definition = { manifest: { id: "example/card", version: "1.0.0" }, implementation: () => 1 };',
    );
    const tampered: ComponentOnceTrustedPackage = {
      ...componentPackage,
      bundle: {
        ...componentPackage.bundle,
        code: componentPackage.bundle.code + "\nmodule.exports.tampered = true;",
      },
    };

    await expect(
      instantiateTrustedComponentPackage(tampered, { externals: {} }),
    ).rejects.toBeInstanceOf(ComponentOnceIntegrityError);
  });

  it("rejects an executable definition whose manifest disagrees with package metadata", async () => {
    const componentPackage = await createPackage(
      'module.exports.definition = { manifest: { id: "example/card", version: "2.0.0" }, implementation: () => 1 };',
      { id: "example/card", version: "1.0.0" },
    );

    await expect(
      instantiateTrustedComponentPackage(componentPackage, { externals: {} }),
    ).rejects.toBeInstanceOf(ComponentOncePackageManifestMismatchError);
  });

  it("rejects malformed package metadata without executing code", () => {
    expect(() =>
      parseTrustedComponentPackage(
        JSON.stringify({
          format: "componentonce.trusted-package.v1",
          renderer: "react",
          manifest: { id: "", version: "1" },
          definitionExport: "definition",
          bundle: {},
        }),
      ),
    ).toThrow();
  });
});
