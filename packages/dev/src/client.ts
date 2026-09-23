import type { ComponentOnceReactDefinition } from "@componentonce/react";
import {
  parseTrustedComponentPackage,
  prepareTrustedComponentPackageAssets,
  createBrowserBlobAssetUrlResolver,
  type ComponentOncePreparedPackageAssets,
  type ComponentOnceTrustedPackageV2,
} from "@componentonce/runtime";
import type { ComponentOnceDevArtifact } from "./protocol.js";

/** Browser-resolved development component with a production-format export and explicit cleanup. */
export interface ComponentOnceLoadedDevArtifact {
  readonly definition: ComponentOnceReactDefinition<unknown, unknown, unknown>;
  readonly componentPackage: ComponentOnceTrustedPackageV2;
  readonly assets: ComponentOncePreparedPackageAssets;
  dispose(): void;
}

/**
 * Discover a trusted source definition in the real browser host (not a fake Node host).
 * Development has no previously-pinned manifest: bytes/assets are verified first,
 * then the resulting definition supplies the manifest for a normal v2 package export.
 * Production installers must still use instantiateTrustedComponentPackage.
 */
export async function loadComponentOnceDevArtifact(
  update: ComponentOnceDevArtifact,
  externals: Readonly<Record<string, unknown>>,
): Promise<ComponentOnceLoadedDevArtifact> {
  const { assets: embeddedAssets, stylesheets, ...bundle } = update.artifact;
  const envelope = {
    format: "componentonce.trusted-package.v2" as const,
    renderer: "react",
    // Resource preparation does not execute or trust a manifest. Discovery replaces this below.
    manifest: { id: "componentonce-dev/metadata-discovery", version: "0" },
    definitionExport: update.definitionExport,
    bundle,
    assets: embeddedAssets,
    stylesheets,
  };
  const provisional = parseTrustedComponentPackage(JSON.stringify(envelope));
  if (provisional.format !== "componentonce.trusted-package.v2") throw new Error("Expected v2 artifact.");
  const blobs = createBrowserBlobAssetUrlResolver();
  let prepared: ComponentOncePreparedPackageAssets | undefined;
  try {
    // Verifies executable code and every asset before any code or asset is used.
    prepared = await prepareTrustedComponentPackageAssets(provisional, {
      resolveAssetUrl: blobs.resolveAssetUrl,
      releaseAssetUrl: blobs.releaseAssetUrl,
    });
    for (const name of bundle.externalModules) {
      if (!Object.prototype.hasOwnProperty.call(externals, name)) {
        throw new Error('Missing host external "' + name + '". Supply it in the browser host profile.');
      }
    }
    let code = bundle.code;
    const css = new Set(stylesheets);
    // Package parsing has already checked all references; preserve any URL fragment/query suffix.
    for (const asset of [...embeddedAssets].sort((a, b) => b.path.length - a.path.length)) {
      if (!css.has(asset.path)) {
        code = code.split("componentonce-asset:/" + asset.path).join(prepared.resolveAssetUrl(asset.path));
        code = code.split("componentonce-asset:" + asset.path).join(prepared.resolveAssetUrl(asset.path));
      }
    }
    const module = { exports: {} as Record<string, unknown> };
    const requireExternal = (name: string): unknown => {
      if (!Object.prototype.hasOwnProperty.call(externals, name)) throw new Error('Missing host external "' + name + '".');
      return externals[name];
    };
    // Same trusted CJS/exact-external boundary as runtime; deliberately not a code sandbox.
    const execute = new Function("module", "exports", "require", '"use strict";\n' + code + '\n//# sourceURL=componentonce-dev-source.js');
    execute(module, module.exports, requireExternal);
    const definition = module.exports[update.definitionExport];
    if (typeof definition !== "object" || definition === null || !("manifest" in definition) || !("implementation" in definition)) {
      throw new Error('Export "' + update.definitionExport + '" is not a ComponentOnce definition.');
    }
    const componentPackage = parseTrustedComponentPackage(JSON.stringify({ ...envelope, manifest: definition.manifest }));
    if (componentPackage.format !== "componentonce.trusted-package.v2") throw new Error("Expected v2 package.");
    let disposed = false;
    const resources = prepared;
    return {
      definition: definition as ComponentOnceReactDefinition<unknown, unknown, unknown>,
      componentPackage,
      assets: resources,
      dispose() {
        if (disposed) return;
        disposed = true;
        // URLs live until the final stylesheet lease ends.
        resources.dispose();
      },
    };
  } catch (error) {
    prepared?.dispose();
    blobs.dispose();
    throw error;
  }
}
