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
--external <name>  Host-owned module kept outside the JSON artifact
--bundle <name>    Bare implementation package compiled into the JSON artifact
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

CSS file references may omit `./` and may include query or fragment suffixes; the emitted package keeps the suffix while resolving the exact file bytes. Root-relative and remote CSS asset URLs are rejected because they are not portable package assets. Explicit `data:` URLs remain inline.

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

Plain `.css` is global CSS. It is not automatically isolated. Prefer `.module.css` for scoped class names; ComponentOnce adds a deterministic namespace derived from the portable input/dependency graph, so changing a referenced image, font, or imported style also changes local class names while identical static dependency graphs retain those class names across directories. A host may instead mount styles in a `ShadowRoot`, but Shadow DOM is never forced.

Build output is independent of the process working directory. Absolute `sourceFileName` values are reduced to their basename, and build-machine paths are not persisted in bundle comments, source maps, or metafile data.

## Low-level compilation

`compileTrustedModule` compiles JavaScript/TypeScript into an immutable CommonJS artifact. Caller-declared package imports remain external. Relative imports can be bundled when `resolveDir` is supplied.

`compileTrustedReactModule` adds automatic JSX transformation and React/JSX host externals while still never bundling React.

Artifacts contain deterministic bundle text, byte length, SHA-256 hash/integrity, normalized diagnostics, exact external imports, and esbuild metafile data.

## Trust model

`instantiateTrustedBundle` deliberately uses `new Function` with a narrow injected require map. It is for trusted internal code and is not a security sandbox.

esbuild transpiles TypeScript syntax but does not perform semantic type checking; hosts that need that guarantee should run their TypeScript checker separately.


## Bundle vs external package imports

Bare package imports have an explicit ownership boundary.

```sh
componentonce build ./src/card.tsx \
  --external @my-app/host-sdk \
  --bundle @my-team/card-formatters
```

External means the host owns that module and must inject it while loading the
component. Bundle means it is an implementation dependency: esbuild follows the
package and its subpath imports and stores that code in the ComponentOnce JSON.
A bundled package does not appear in bundle.externalModules, so the host does
not need to install or know about it. Transitive bare imports also need an explicit
`--bundle` or `--external` entry; selecting one package does not automatically allow
all of its dependencies. Package subpaths are included, but similarly named packages
are not. Packages without an exports map resolve their `module` field before `main`.
Package-private `#imports` that resolve within their package are followed like
relative files, including native patterns and conditions. Aliases to other
packages still need an explicit bundle or host-external choice for that alias.
Selected CSS package imports also resolve through the package; CSS Modules retain
the compilation namespace, including direct package subpaths. CSS class names use
graph-based dependency identities and source contents, so statically resolved
imports retain their class names across linked package target locations.

JavaScript dependencies retain esbuild's native file identities and per-file
tsconfig behavior, including inherited JSX factories, class-field settings, and
`verbatimModuleSyntax`. Static and glob imports share native module instances.
Source maps and global CSS can contain installation paths, so bundle and stylesheet
hashes may change across installations. Repeated builds with the same sources,
settings, and layout remain deterministic; integrity hashes identify emitted
bytes, not an installation-independent build cache key. Package resolution follows
real package locations, including unhoisted transitive dependencies.

For CSS Modules, glob JavaScript entries that import their CSS; direct CSS globs
bypass content-based class isolation. Original sources stay
available in inline source maps.

Trusted artifacts replace `process.env.NODE_ENV` with `"production"` at compile
time, regardless of the build machine's environment. This does not inject other
Node globals. Dynamic imports of declared host externals use the same injected
host modules as static imports and retain their asynchronous result. Imports whose
names cannot be resolved statically, such as `import(specifier)`, remain runtime
lookups in the injected host module map. Selecting a package with `--bundle` does
not include code that is referenced only through an unresolved variable import.
Use statically resolvable imports for implementation dependencies that must travel
inside the artifact. The artifact's external-module list describes statically
discovered imports, not all names a dynamic lookup might request.

The React helpers keep React and its JSX runtimes host-owned automatically. The
build and dev CLIs also externalize the ComponentOnce React adapter. Programmatic
callers choose adapter ownership through their external module options. Unknown
bare package imports still fail. This keeps
host singletons deliberate without turning reusable implementation libraries
into host ABI.

React aliases use the same explicit ownership rule. Declare aliases such as
`react-private` and `react-private/jsx-runtime` in `additionalExternalModules`,
then supply the host's React and JSX runtime objects under those exact keys in
the loader's `externals` map. Do not select those aliases for bundling when the
component is rendered by the host React instance: bundling them embeds a separate
React copy whose hooks do not share the host renderer's state.

Programmatic callers use `bundleModules` with `compileTrustedModule` and
`additionalBundleModules` with `compileTrustedReactModule` / `buildTrustedReactPackage`.
