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
```

React builds automatically externalize `react`, the JSX runtimes, and `@componentonce/react`. DOM builds automatically externalize `@componentonce/dom`. Relative imports are bundled from the entry file directory; undeclared package imports still fail rather than being silently pulled from the compiler process.

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
});

await store.put(
  componentPackage.manifest.id,
  serializeTrustedComponentPackage(componentPackage),
);
```

At runtime:

```ts
import {
  instantiateTrustedComponentPackage,
  parseTrustedComponentPackage,
} from "@componentonce/compiler-esbuild";

const componentPackage = parseTrustedComponentPackage(await store.get(...));

console.log(componentPackage.manifest); // no component execution

const definition = instantiateTrustedComponentPackage(componentPackage, {
  externals: {
    react: React,
    "react/jsx-runtime": jsxRuntime,
    "@componentonce/react": ComponentOnceReact,
  },
});
```

Instantiation verifies that the definition inside the executable bundle still has the same manifest as the package envelope.

## Low-level compilation

`compileTrustedModule` compiles JavaScript/TypeScript into an immutable CommonJS artifact. Caller-declared package imports remain external. Relative imports can be bundled when `resolveDir` is supplied.

`compileTrustedReactModule` adds automatic JSX transformation and React/JSX host externals while still never bundling React.

Artifacts contain deterministic bundle text, byte length, SHA-256 hash/integrity, normalized diagnostics, exact external imports, and esbuild metafile data.

## Trust model

`instantiateTrustedBundle` deliberately uses `new Function` with a narrow injected require map. It is for trusted internal code and is not a security sandbox.

esbuild transpiles TypeScript syntax but does not perform semantic type checking; hosts that need that guarantee should run their TypeScript checker separately.
