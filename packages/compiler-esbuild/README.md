# `@componentonce/compiler-esbuild`

Compile trusted internal TypeScript/TSX modules into immutable, storage-neutral CommonJS artifacts.
React is never bundled: the host supplies its own `react`, `react/jsx-runtime`, and (when imported)
`react/jsx-dev-runtime` module values when the artifact is instantiated. Additional host SDK modules
use the same explicit injection mechanism.

This package is for trusted code. `instantiateTrustedBundle` deliberately uses `new Function`; it is
an evaluator with an explicit `require` map, not a security sandbox.

## Compile, store, load, and instantiate

```ts
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import * as ComponentOnceReact from "@componentonce/react";
import {
  compileTrustedReactModule,
  instantiateTrustedBundle,
} from "@componentonce/compiler-esbuild";

const artifact = await compileTrustedReactModule({
  source: `
    import { useState } from "react";
    import { defineReactComponent } from "@componentonce/react";
    import { formatLabel } from "@my-host/sdk";

    interface Props { readonly initial: number }
    interface HostContext { readonly locale: string }
    interface Payload { readonly emphasis: "normal" | "strong" }

    export const definition = defineReactComponent<Props, HostContext, Payload>({
      manifest: { id: "example.counter", version: "1.0.0" },
      component({ props, context, payload }) {
        const [count] = useState(props.initial);
        return <button>{formatLabel(context, count, payload)}</button>;
      },
    });
  `,
  sourceFileName: "counter.tsx",
  additionalExternalModules: ["@componentonce/react", "@my-host/sdk"],
});

// Persist these values in any storage chosen by the host. The compiler performs no I/O.
await hostBundleStore.put("example.counter@1.0.0", {
  format: artifact.format,
  code: artifact.code,
  integrity: artifact.integrity,
  metafile: artifact.metafile,
});

// Later, load text or UTF-8 bytes through any host-owned adapter.
const stored = await hostBundleStore.get("example.counter@1.0.0");
const module = instantiateTrustedBundle<{ definition: unknown }>(stored.code, {
  expectedIntegrity: stored.integrity,
  externals: {
    react: React,
    "react/jsx-runtime": jsxRuntime,
    "@componentonce/react": ComponentOnceReact,
    "@my-host/sdk": hostSdk,
  },
});
```

`hostBundleStore` and `hostSdk` above are application-owned adapters/values; the compiler does not
define or access either one.

The compiled output is deterministic for the same source, options, and compiler version. Each
artifact includes its UTF-8 byte length, hexadecimal SHA-256 hash, standard `sha256-...` integrity
value, normalized warnings, exact referenced externals, and the esbuild metafile. Passing an artifact
directly to `instantiateTrustedBundle` verifies its integrity automatically; separately loaded text or
bytes can be checked with `expectedIntegrity` as shown above.

Every runtime import must be either React-related or listed exactly in `additionalExternalModules`.
Undeclared imports fail compilation instead of being resolved from the compiler process, which keeps
storage, loading, application SDKs, and dependency selection under host control.

esbuild transpiles TypeScript syntax but does not type-check it. Run `tsc` (or the host project's type
checker) separately when semantic type diagnostics are required.
