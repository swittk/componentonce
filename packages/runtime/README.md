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

Preparation is transactional: if a later URL resolution or stylesheet step fails, every URL already obtained by that attempt is released exactly once. The Blob resolver shares URLs by content and reference count, so that rollback does not revoke a URL still held by another prepared package. `assets.dispose()` is lease-safe; `blobs.dispose()` is an explicit force-revoke operation and must only be called after all prepared packages using it have been disposed and their style leases released.

Resolution uses a one-pass reader for the exact generated asset path, so paths such as `assets/a` and `assets/a.svg` cannot replace each other's prefixes. CSS URL fragments such as `url(componentonce-asset:/assets/icons.svg#check)` are preserved after the exact asset path is resolved. Resolver results must use the documented safe URL grammar: non-empty URLs without whitespace, quotes, parentheses, backslashes, or control characters.

Plain CSS retains normal global semantics. CSS Modules are the recommended scoped mode; the compiler namespaces their local names across separate package builds. Shadow DOM is optional and never forced.

Trusted evaluation deliberately uses new Function. This is not a security sandbox; only trusted internal code should be loaded.
