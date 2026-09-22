import { describe, expect, it, vi } from "vitest";
import {
  ComponentOnceIntegrityError,
  ComponentOnceMissingExternalError,
  ComponentOncePackageManifestMismatchError,
  calculateTrustedBundleSha256,
  createBrowserBlobAssetUrlResolver,
  instantiateTrustedComponentPackage,
  parseTrustedComponentPackage,
  prepareTrustedComponentPackageAssets,
  type ComponentOnceEmbeddedAsset,
  type ComponentOnceTrustedPackage,
  type ComponentOnceTrustedPackageV2,
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

async function createAsset(
  path: string,
  contentType: string,
  text: string,
): Promise<ComponentOnceEmbeddedAsset> {
  const bytes = new TextEncoder().encode(text);
  const hash = await calculateTrustedBundleSha256(bytes);
  return {
    path,
    contentType,
    encoding: "base64",
    content: encodeBase64(bytes),
    ...hash,
  };
}

async function createAssetPackage(): Promise<ComponentOnceTrustedPackageV2> {
  const code = [
    "module.exports.definition = {",
    '  manifest: { id: "example/assets", version: "1.0.0" },',
    '  implementation: () => "componentonce-asset:/assets/logo.svg",',
    "};",
  ].join("\n");
  const hash = await calculateTrustedBundleSha256(code);
  const assets = await Promise.all([
    createAsset("assets/font.woff2", "font/woff2", "font-bytes"),
    createAsset("assets/logo.svg", "image/svg+xml", "<svg/>") ,
    createAsset(
      "component.css",
      "text/css",
      '.root{background:url(componentonce-asset:/assets/logo.svg)}@font-face{src:url("componentonce-asset:/assets/font.woff2")}',
    ),
  ]);
  return {
    format: "componentonce.trusted-package.v2",
    renderer: "custom",
    manifest: { id: "example/assets", version: "1.0.0" },
    definitionExport: "definition",
    bundle: {
      format: "componentonce.trusted-cjs.v1",
      code,
      ...hash,
      externalModules: [],
    },
    assets,
    stylesheets: ["component.css"],
  };
}

async function createPrefixAssetPackage(): Promise<ComponentOnceTrustedPackageV2> {
  const code = [
    "module.exports.definition = {",
    '  manifest: { id: "example/prefix-assets", version: "1.0.0" },',
    "  implementation: () => ({",
    '    short: "before:componentonce-asset:/assets/a:after",',
    '    long: "left:componentonce-asset:/assets/a.svg:right",',
    "  }),",
    "};",
  ].join("\n");
  const hash = await calculateTrustedBundleSha256(code);
  const assets = await Promise.all([
    createAsset("assets/a", "application/octet-stream", "short"),
    createAsset("assets/a.svg", "image/svg+xml", "<svg/>") ,
    createAsset(
      "component.css",
      "text/css",
      ".one{src:url(componentonce-asset:/assets/a)}.two{src:url(componentonce-asset:/assets/a.svg#glyph)}",
    ),
  ]);
  return {
    format: "componentonce.trusted-package.v2",
    renderer: "custom",
    manifest: { id: "example/prefix-assets", version: "1.0.0" },
    definitionExport: "definition",
    bundle: {
      format: "componentonce.trusted-cjs.v1",
      code,
      ...hash,
      externalModules: [],
    },
    assets,
    stylesheets: ["component.css"],
  };
}

interface FakeDom {
  readonly document: Document;
  readonly styles: Array<{ textContent: string | null; removed: boolean }>;
}

function createFakeDocument(): FakeDom {
  const styles: Array<{ textContent: string | null; removed: boolean }> = [];
  const parent = {
    appendChild(node: { textContent: string | null; removed: boolean }): void {
      styles.push(node);
    },
  };
  const document = {
    nodeType: 9,
    head: parent,
    documentElement: parent,
    createElement(): {
      textContent: string | null;
      removed: boolean;
      setAttribute(): void;
      remove(): void;
    } {
      return {
        textContent: null,
        removed: false,
        setAttribute(): void {},
        remove(): void {
          this.removed = true;
        },
      };
    },
  } as unknown as Document;
  return { document, styles };
}

function createFakeShadowRoot(ownerDocument: Document): {
  readonly root: ShadowRoot;
  readonly styles: Array<{ textContent: string | null; removed: boolean }>;
} {
  const styles: Array<{ textContent: string | null; removed: boolean }> = [];
  const root = {
    nodeType: 11,
    ownerDocument,
    appendChild(node: { textContent: string | null; removed: boolean }): void {
      styles.push(node);
    },
  } as unknown as ShadowRoot;
  return { root, styles };
}

function encodeBase64(bytes: Uint8Array): string {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index]!;
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    const combined = (first << 16) | ((second ?? 0) << 8) | (third ?? 0);
    output += alphabet[(combined >> 18) & 63]!;
    output += alphabet[(combined >> 12) & 63]!;
    output += second === undefined ? "=" : alphabet[(combined >> 6) & 63]!;
    output += third === undefined ? "=" : alphabet[combined & 63]!;
  }
  return output;
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

  it("keeps the public two-argument integrity error constructor", () => {
    const error = new ComponentOnceIntegrityError("expected", "actual");
    expect(error.expectedSha256).toBe("expected");
    expect(error.actualSha256).toBe("actual");
    expect(error.path).toBe("bundle");
    expect(error.message).toBe(
      'Trusted bundle integrity mismatch. Expected SHA-256 "expected" but received "actual".',
    );
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

  it("defaults only legacy v1 packages to the conventional definition export", async () => {
    const v1 = await createPackage(
      'module.exports.definition = { manifest: { id: "example/card", version: "1.0.0" }, implementation: () => 1 };',
    );
    const missingV1Export = { ...v1 } as Record<string, unknown>;
    delete missingV1Export.definitionExport;
    expect(parseTrustedComponentPackage(JSON.stringify(missingV1Export)).definitionExport).toBe("definition");

    const v2 = await createAssetPackage();
    const missingV2Export = { ...v2 } as Record<string, unknown>;
    delete missingV2Export.definitionExport;
    expect(() => parseTrustedComponentPackage(JSON.stringify(missingV2Export))).toThrow(/definitionExport/u);
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

  it("enforces UTF-8 package byte limits before allocating an encoded copy", () => {
    const encode = vi
      .spyOn(TextEncoder.prototype, "encode")
      .mockImplementation(() => {
        throw new Error("TextEncoder.encode must not run before the size rejection");
      });
    try {
      expect(() =>
        parseTrustedComponentPackage("éé", { maxPackageBytes: 3 }),
      ).toThrow(/maxPackageBytes/u);
    } finally {
      encode.mockRestore();
    }
  });

  it("parses, prepares, resolves, mounts, and releases v2 package assets", async () => {
    const parsed = parseTrustedComponentPackage(
      JSON.stringify(await createAssetPackage()),
    );
    expect(parsed.format).toBe("componentonce.trusted-package.v2");
    if (parsed.format !== "componentonce.trusted-package.v2") throw new Error("expected v2");
    const released: string[] = [];
    const prepared = await prepareTrustedComponentPackageAssets(parsed, {
      resolveAssetUrl: (asset) => "https://assets.example/" + asset.path,
      releaseAssetUrl: (asset) => released.push(asset.path),
    });
    const definition = await instantiateTrustedComponentPackage(parsed, {
      externals: {},
      preparedAssets: prepared,
    });
    expect((definition.implementation as () => string)()).toBe(
      "https://assets.example/assets/logo.svg",
    );

    const firstDocument = createFakeDocument();
    const secondDocument = createFakeDocument();
    const shadow = createFakeShadowRoot(firstDocument.document);
    const firstMount = prepared.mountStyles(firstDocument.document);
    const duplicateMount = prepared.mountStyles(firstDocument.document);
    const independentMount = prepared.mountStyles(secondDocument.document);
    const shadowMount = prepared.mountStyles(shadow.root);
    expect(firstDocument.styles).toHaveLength(1);
    expect(secondDocument.styles).toHaveLength(1);
    expect(shadow.styles).toHaveLength(1);
    expect(firstDocument.styles[0]?.textContent).toContain(
      "https://assets.example/assets/font.woff2",
    );

    prepared.dispose();
    expect(released).toEqual([]);
    firstMount.release();
    expect(firstDocument.styles[0]?.removed).toBe(false);
    duplicateMount.release();
    expect(firstDocument.styles[0]?.removed).toBe(true);
    expect(released).toEqual([]);
    independentMount.release();
    expect(released).toEqual([]);
    shadowMount.release();
    expect(released.sort()).toEqual(["assets/font.woff2", "assets/logo.svg"]);
  });

  it("rejects tampered, traversing, duplicate, missing, and oversized v2 assets", async () => {
    const valid = await createAssetPackage();
    const tampered = structuredClone(valid);
    (tampered.assets[0] as { content: string }).content = encodeBase64(
      new TextEncoder().encode("font-byteS"),
    );
    const parsedTampered = parseTrustedComponentPackage(JSON.stringify(tampered));
    if (parsedTampered.format !== "componentonce.trusted-package.v2") throw new Error("expected v2");
    await expect(
      prepareTrustedComponentPackageAssets(parsedTampered, {
        resolveAssetUrl: (asset) => "https://assets.example/" + asset.path,
      }),
    ).rejects.toBeInstanceOf(ComponentOnceIntegrityError);

    const traversal = structuredClone(valid);
    (traversal.assets[0] as { path: string }).path = "../font.woff2";
    expect(() => parseTrustedComponentPackage(JSON.stringify(traversal))).toThrow(
      /Unsafe ComponentOnce asset path/u,
    );

    const duplicate = structuredClone(valid);
    (duplicate.assets[1] as { path: string }).path = duplicate.assets[0]!.path;
    expect(() => parseTrustedComponentPackage(JSON.stringify(duplicate))).toThrow(
      /Duplicate ComponentOnce asset path/u,
    );

    const invalidContentType = structuredClone(valid);
    (invalidContentType.assets[0] as { contentType: string }).contentType =
      "image/svg+xml\u0001";
    expect(() =>
      parseTrustedComponentPackage(JSON.stringify(invalidContentType)),
    ).toThrow(/contentType/u);

    const missing = structuredClone(valid);
    (missing.assets as ComponentOnceEmbeddedAsset[]).splice(1, 1);
    expect(() => parseTrustedComponentPackage(JSON.stringify(missing))).toThrow(
      /generated asset reference/u,
    );

    expect(() =>
      parseTrustedComponentPackage(JSON.stringify(valid), { maxAssets: 2 }),
    ).toThrow(/maxAssets/u);
    expect(() =>
      parseTrustedComponentPackage(JSON.stringify(valid), { maxAssetBytes: 5 }),
    ).toThrow(/maxAssetBytes/u);
  });

  it("replaces exact prefix-related tokens once and preserves CSS URL fragments", async () => {
    const parsed = parseTrustedComponentPackage(
      JSON.stringify(await createPrefixAssetPackage()),
    );
    if (parsed.format !== "componentonce.trusted-package.v2") throw new Error("expected v2");
    const prepared = await prepareTrustedComponentPackageAssets(parsed, {
      resolveAssetUrl: (asset) => "https://assets.example/" + asset.path,
    });
    const definition = await instantiateTrustedComponentPackage(parsed, {
      externals: {},
      preparedAssets: prepared,
    });
    expect(
      (definition.implementation as () => { short: string; long: string })(),
    ).toEqual({
      short: "before:https://assets.example/assets/a:after",
      long: "left:https://assets.example/assets/a.svg:right",
    });
    const fakeDocument = createFakeDocument();
    const mount = prepared.mountStyles(fakeDocument.document);
    expect(fakeDocument.styles[0]?.textContent).toContain(
      "https://assets.example/assets/a.svg#glyph",
    );
    mount.release();
    prepared.dispose();
  });

  it("rolls back a failed prepare without revoking URLs held by a live package", async () => {
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    const revoked: string[] = [];
    let created = 0;
    URL.createObjectURL = () => "blob:shared-" + ++created;
    URL.revokeObjectURL = (url) => revoked.push(url);
    try {
      const resolver = createBrowserBlobAssetUrlResolver();
      const parsed = parseTrustedComponentPackage(
        JSON.stringify(await createAssetPackage()),
      );
      if (parsed.format !== "componentonce.trusted-package.v2") throw new Error("expected v2");
      const live = await prepareTrustedComponentPackageAssets(parsed, {
        resolveAssetUrl: resolver.resolveAssetUrl,
        releaseAssetUrl: resolver.releaseAssetUrl,
      });
      const fakeDocument = createFakeDocument();
      const liveMount = live.mountStyles(fakeDocument.document);
      let calls = 0;
      await expect(
        prepareTrustedComponentPackageAssets(parsed, {
          resolveAssetUrl: async (asset) => {
            calls += 1;
            if (calls === 2) throw new Error("resolver failed");
            return resolver.resolveAssetUrl(asset);
          },
          releaseAssetUrl: resolver.releaseAssetUrl,
        }),
      ).rejects.toThrow("resolver failed");
      expect(revoked).toEqual([]);

      live.dispose();
      expect(revoked).toEqual([]);
      liveMount.release();
      expect(revoked).toHaveLength(2);
      resolver.dispose();
    } finally {
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
    }
  });

  it("rejects execution and URL reads after prepared assets are disposed", async () => {
    const parsed = parseTrustedComponentPackage(
      JSON.stringify(await createAssetPackage()),
    );
    if (parsed.format !== "componentonce.trusted-package.v2") throw new Error("expected v2");
    const released: string[] = [];
    const prepared = await prepareTrustedComponentPackageAssets(parsed, {
      resolveAssetUrl: (asset) => "https://assets.example/" + asset.path,
      releaseAssetUrl: (asset) => released.push(asset.path),
    });

    prepared.dispose();

    expect(() => prepared.resolveAssetUrl("assets/logo.svg")).toThrow(/disposed/u);
    await expect(
      instantiateTrustedComponentPackage(parsed, {
        externals: {},
        preparedAssets: prepared,
      }),
    ).rejects.toThrow(/live assets/u);
    expect(released.sort()).toEqual(["assets/font.woff2", "assets/logo.svg"]);
  });

  it("attempts every URL release even when one releaser throws", async () => {
    const parsed = parseTrustedComponentPackage(
      JSON.stringify(await createAssetPackage()),
    );
    if (parsed.format !== "componentonce.trusted-package.v2") throw new Error("expected v2");
    const attempted: string[] = [];
    const prepared = await prepareTrustedComponentPackageAssets(parsed, {
      resolveAssetUrl: (asset) => "https://assets.example/" + asset.path,
      releaseAssetUrl: (asset) => {
        attempted.push(asset.path);
        if (asset.path.endsWith("font.woff2")) throw new Error("release failed");
      },
    });

    expect(() => prepared.dispose()).toThrow(AggregateError);
    expect(attempted).toEqual(["assets/font.woff2", "assets/logo.svg"]);
    expect(() => prepared.resolveAssetUrl("assets/logo.svg")).toThrow(/disposed/u);
  });

  it("rejects control characters in resolved URLs and rolls back the lease", async () => {
    const parsed = parseTrustedComponentPackage(
      JSON.stringify(await createAssetPackage()),
    );
    if (parsed.format !== "componentonce.trusted-package.v2") throw new Error("expected v2");
    const released: string[] = [];

    await expect(
      prepareTrustedComponentPackageAssets(parsed, {
        resolveAssetUrl: (asset) => "https://assets.example/\u0001" + asset.path,
        releaseAssetUrl: (asset) => released.push(asset.path),
      }),
    ).rejects.toThrow(/unsafe generated-token URL/u);
    expect(released).toEqual(["assets/font.woff2"]);
  });

  it("releases every created URL once when stylesheet preparation fails", async () => {
    const valid = await createAssetPackage();
    const invalidStylesheet = await createAsset(
      "component.css",
      "text/css",
      ".root{background:url(componentonce-asset:/assets/missing.svg)}",
    );
    const invalid: ComponentOnceTrustedPackageV2 = {
      ...valid,
      assets: valid.assets.map((asset) =>
        asset.path === "component.css" ? invalidStylesheet : asset,
      ),
    };
    const released: string[] = [];
    await expect(
      prepareTrustedComponentPackageAssets(invalid, {
        resolveAssetUrl: (asset) => "https://assets.example/" + asset.path,
        releaseAssetUrl: (asset) => released.push(asset.path),
      }),
    ).rejects.toThrow(/No prepared ComponentOnce asset URL/u);
    expect(released.sort()).toEqual(["assets/font.woff2", "assets/logo.svg"]);
  });

  it("shares and revokes browser Blob URLs by asset content", async () => {
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    const revoked: string[] = [];
    let created = 0;
    URL.createObjectURL = () => "blob:asset-" + ++created;
    URL.revokeObjectURL = (url) => revoked.push(url);
    try {
      const resolver = createBrowserBlobAssetUrlResolver();
      const assetPackage = await createAssetPackage();
      const asset = assetPackage.assets[0]!;
      const resolved = {
        path: asset.path,
        contentType: asset.contentType,
        byteLength: asset.byteLength,
        sha256: asset.sha256,
        integrity: asset.integrity,
        bytes: new TextEncoder().encode("font-bytes"),
      };
      const first = await resolver.resolveAssetUrl(resolved);
      const second = await resolver.resolveAssetUrl(resolved);
      expect(first).toBe(second);
      resolver.releaseAssetUrl(resolved, first);
      expect(revoked).toEqual([]);
      resolver.releaseAssetUrl(resolved, second);
      expect(revoked).toEqual([first]);
      const forced = await resolver.resolveAssetUrl(resolved);
      resolver.dispose();
      expect(revoked).toEqual([first, forced]);
    } finally {
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
    }
  });
});
