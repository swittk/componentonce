# @componentonce/compiler-esbuild

Optional trusted compiler, packager, and evaluator tooling for ComponentOnce.

This package is not part of the core runtime ABI. It owns no storage or transport.

## CLI: source file to self-describing package

Install the renderer adapter you use plus this compiler, then:

```sh
componentonce build ./src/amount-card.tsx \
  --renderer react \
  --out ./dist/amount-card.componentonce.json
```

The default renderer is `react`, so this is also valid:

```sh
componentonce build ./src/amount-card.tsx
```

Useful options:

```text
--renderer <id>    Renderer id recorded in the package
-o, --out <file>   Output JSON package
--export <name>    Definition export name (default: definition)
--external <name>  Additional host module kept external and loaded for trusted build discovery
--loader <ext=kind> Additional esbuild loader, for example .bin=file or .svg=dataurl
--content-type <ext=type> Media type override for an emitted file-loader asset
```

React builds automatically externalize `react`, the JSX runtimes, and `@componentonce/react`. DOM builds automatically externalize `@componentonce/dom`. Relative imports are bundled from the entry file directory; undeclared package imports still fail rather than being silently pulled from the compiler process.

Ordinary relative static imports are packaged automatically:

```tsx
import "./card.css";
import styles from "./card.module.css";
import logoUrl from "./logo.svg";

// CSS may use @import and url("./font.woff2").
```

Common image and font extensions use esbuild's `file` loader by default. Configure any other extension instead of relying on a fixed media whitelist:

```sh
componentonce build ./src/card.tsx \
  --loader .mesh=file \
  --content-type .mesh=application/vnd.example.mesh
```

Use `--loader .svg=dataurl` only when deliberately inlining a small file. The default `file` path keeps binary bytes out of executable JavaScript. JSON and `.txt` retain esbuild's normal `json` and `text` behavior.

The source module normally exports one definition:

```tsx
import {
  createReactRequirement,
  defineReactComponent,
} from "@componentonce/react";

export const definition = defineReactComponent<Props, HostContext, Payload>({
  manifest: {
    id: "example/amount-card",
    version: "1.0.0",
    requirements: [createReactRequirement("19.3.0")],
  },
  component({ props, context, payload }) {
    return <strong>{props.label}: {context.formatAmount(payload.amount)}</strong>;
  },
});
```

The high-level builder evaluates trusted source once during build to discover the exported manifest. The resulting package stores that manifest next to the bundle, so catalogs can inspect identity, version, and requirements without executing the component.

## Programmatic packaging

```ts
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import * as ComponentOnceReact from "@componentonce/react";
import {
  buildTrustedReactPackage,
  serializeTrustedComponentPackage,
} from "@componentonce/compiler-esbuild";

const componentPackage = await buildTrustedReactPackage({
  source,
  sourceFileName: "amount-card.tsx",
  resolveDir: sourceDirectory,
  externals: {
    react: React,
    "react/jsx-runtime": jsxRuntime,
    "@componentonce/react": ComponentOnceReact,
  },
  loaders: { ".mesh": "file" },
  contentTypes: { ".mesh": "application/vnd.example.mesh" },
});

await store.put(
  componentPackage.manifest.id,
  serializeTrustedComponentPackage(componentPackage),
);
```

At runtime use `@componentonce/runtime`, so a browser does not import esbuild or Node builtins:

```ts
import {
  createBrowserBlobAssetUrlResolver,
  instantiateTrustedComponentPackage,
  parseTrustedComponentPackage,
  prepareTrustedComponentPackageAssets,
} from "@componentonce/runtime";

const componentPackage = parseTrustedComponentPackage(await store.get(...));

console.log(componentPackage.manifest); // no component execution

if (componentPackage.format !== "componentonce.trusted-package.v2") {
  throw new Error("Expected an asset-capable package");
}
const blobs = createBrowserBlobAssetUrlResolver();
const assets = await prepareTrustedComponentPackageAssets(componentPackage, {
  resolveAssetUrl: blobs.resolveAssetUrl,
  releaseAssetUrl: blobs.releaseAssetUrl,
});
const definition = await instantiateTrustedComponentPackage(componentPackage, {
  externals: {
    react: React,
    "react/jsx-runtime": jsxRuntime,
    "@componentonce/react": ComponentOnceReact,
  },
  preparedAssets: assets,
});

const styleMount = assets.mountStyles(container.ownerDocument);
// Render or mount the definition into container.
styleMount.release();
assets.dispose();
blobs.dispose();
```

Preparation verifies the executable bundle and every embedded asset before producing URLs or styles. Instantiation verifies that the definition inside the executable bundle still has the same manifest as the package envelope.

The v2 package has sorted `assets` entries with safe relative `path`, `contentType`, exact byte length, SHA-256/SRI values, and base64 bytes. `stylesheets` contains exact references into that table. Generated `componentonce-asset:` tokens are the only strings the runtime resolves. Node tooling may instantiate with only `{ externals }` for manifest/build inspection; file imports remain deliberate tokens until a URL resolver is supplied. Existing v1 packages without assets remain readable and executable.

Plain `.css` is global CSS. It is not automatically isolated. Prefer `.module.css` for scoped class names; ComponentOnce adds a deterministic namespace derived from the portable input/dependency graph, so changing a referenced image, font, or imported style also changes local class names while identical packages in different absolute directories remain reproducible. A host may instead mount styles in a `ShadowRoot`, but Shadow DOM is never forced.

## Low-level compilation

`compileTrustedModule` compiles JavaScript/TypeScript into an immutable CommonJS artifact. Caller-declared package imports remain external. Relative imports can be bundled when `resolveDir` is supplied.

`compileTrustedReactModule` adds automatic JSX transformation and React/JSX host externals while still never bundling React.

Artifacts contain deterministic bundle text, byte length, SHA-256 hash/integrity, normalized diagnostics, exact external imports, and esbuild metafile data.

## Trust model

`instantiateTrustedBundle` deliberately uses `new Function` with a narrow injected require map. It is for trusted internal code and is not a security sandbox.

esbuild transpiles TypeScript syntax but does not perform semantic type checking; hosts that need that guarantee should run their TypeScript checker separately.
