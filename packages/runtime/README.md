# @componentonce/runtime

Browser-safe trusted package runtime for ComponentOnce.

Use this package when an application needs to load and execute a previously built ComponentOnce trusted package without importing a compiler. It contains no esbuild, filesystem, transport, or Node builtin dependency.

The runtime parses inspectable package metadata, verifies executable and asset bytes with Web Crypto SHA-256, resolves embedded files through host URL policy, manages styles in an actual `Document` or `ShadowRoot`, and instantiates CommonJS output with an explicit host external map.

Parsing is SSR-safe and does not access `document`, create URLs, or execute component code:

```ts
import { parseTrustedComponentPackage } from "@componentonce/runtime";

const componentPackage = parseTrustedComponentPackage(storedJson, {
  maxPackageBytes: 48 * 1024 * 1024,
  maxAssets: 256,
  maxAssetBytes: 16 * 1024 * 1024,
  maxTotalAssetBytes: 32 * 1024 * 1024,
});

console.log(componentPackage.manifest);
```

These configurable bounds apply once at the untyped package boundary. V1 packages still parse and execute without an asset preparation step. V2 packages add a sorted, integrity-protected asset table and stylesheet references.

## Prepare once, mount where rendered

Use a host URL resolver for HTTP/content-addressed assets, or the provided browser Blob URL helper:

```ts
import {
  createBrowserBlobAssetUrlResolver,
  instantiateTrustedComponentPackage,
  prepareTrustedComponentPackageAssets,
} from "@componentonce/runtime";

if (componentPackage.format !== "componentonce.trusted-package.v2") {
  throw new Error("Expected a v2 package");
}

const blobs = createBrowserBlobAssetUrlResolver();
const assets = await prepareTrustedComponentPackageAssets(componentPackage, {
  resolveAssetUrl: blobs.resolveAssetUrl,
  releaseAssetUrl: blobs.releaseAssetUrl,
});
const definition = await instantiateTrustedComponentPackage(componentPackage, {
  externals: hostExternals,
  preparedAssets: assets,
});
```

For React, attach styles to the container's real owner document, including an iframe document:

```tsx
const styleMount = assets.mountStyles(container.ownerDocument);
const root = createRoot(container);
root.render(<definition.implementation props={props} context={context} payload={payload} />);

// Cleanup:
root.unmount();
styleMount.release();
assets.dispose();
blobs.dispose();
```

For a DOM definition, the same prepared resource owns the same lifecycle:

```ts
const styleMount = assets.mountStyles(container.ownerDocument);
const mounted = definition.implementation.mount(container, {
  props,
  context,
  payload,
});

// Cleanup:
mounted.destroy();
styleMount.release();
assets.dispose();
blobs.dispose();
```

Calling `mountStyles` repeatedly for one prepared package and root inserts one style set and returns reference-counted leases. A different document or `ShadowRoot` gets its own style set. Disposing while mounts remain defers URL release until their leases end.

Plain CSS retains normal global semantics. CSS Modules are the recommended scoped mode; the compiler namespaces their local names across separate package builds. Shadow DOM is optional and never forced.

Trusted evaluation deliberately uses new Function. This is not a security sandbox; only trusted internal code should be loaded.
