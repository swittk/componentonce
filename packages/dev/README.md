# @componentonce/dev

Optional local development workbench for trusted ComponentOnce React modules.

It is deliberately not a new runtime, framework, backend, or sandbox. Source changes are watched through the same @componentonce/compiler-esbuild compilation path used for production packages, while the component executes in a real browser host profile with the host's React singleton, external modules, providers, context, and capabilities.

## Quick start

```sh
componentonce dev ./src/card.tsx --host ./dev/componentonce-host.ts
```

You can also invoke the package directly:

```sh
componentonce-dev ./src/card.tsx --host ./dev/componentonce-host.ts
```

The server binds to loopback only. The default URL is http://127.0.0.1:4173.

## Browser host profile

The host profile is a normal browser module. It is never evaluated by the Node compiler, so application SDK initialization, Parse/browser clients, React providers, query caches, theme providers, and other browser-owned values can remain real.

```ts
import { defineReactDevHost } from "@componentonce/dev/host";
import * as AppSdk from "@my-app/sdk";

export default defineReactDevHost({
  name: "My application",
  capabilities: [{ name: "my-app-sdk", version: "3" }],
  externals: {
    "@my-app/sdk": AppSdk,
  },
  fixtures: [
    {
      name: "Customer A",
      props: { title: "Overview" },
      payload: { recordId: "abc123" },
      context: { locale: "en-US" },
    },
  ],
  async setup() {
    await AppSdk.initialize();
  },
  createContext(input) {
    return { sdk: AppSdk, locale: input.locale };
  },
});
```

React, react/jsx-runtime, react/jsx-dev-runtime, and @componentonce/react are pinned to the workbench/browser host singleton. A host profile cannot accidentally replace them with another React copy.

Use --external exact/specifier for every additional import allowed by the production component compiler.

## What the workbench shows

- live component preview in an iframe;
- Props, Payload, and Context-input JSON kept separate;
- named fixtures supplied by the real host profile;
- host capabilities and external import list;
- manifest requirements, bundle size, packaged assets, and compiler/runtime diagnostics;
- responsive/mobile preview widths and light/dark host theme signal;
- an Export package action that emits a normal componentonce.trusted-package.v2 envelope.

Source dependency edits (TS/JS, CSS/CSS Modules, images/fonts/assets) trigger rebuilds. Successful source updates remount only the preview component, preserving fixture inputs and the workbench shell. Syntax/import failures keep the last good component mounted while diagnostics update.

## HMR semantics

v0 intentionally uses a safe remount rather than React Fast Refresh state preservation:

```text
source change
  -> esbuild graph notices dependency
  -> canonical ComponentOnce compiler produces the new artifact
  -> browser verifies bundle/assets and host requirements
  -> old component/styles/assets dispose
  -> preview component root remounts
```

This avoids inventing a second module/runtime format or letting stale React state mask compatibility changes. Props/Payload/Context fixtures remain in memory.

## Trust and network boundary

ComponentOnce dev executes trusted local code. It is not an untrusted-code sandbox.

The development HTTP server binds to 127.0.0.1 only, accepts only localhost/127.0.0.1 Host values, rejects cross-origin/cross-site requests, exposes only generated workbench/preview assets plus status/artifact endpoints, never serves repository files, and uses Cache-Control: no-store.

## Example

The package includes examples/card.tsx and examples/host.ts.

```sh
cd packages/dev
componentonce dev ./examples/card.tsx --host ./examples/host.ts
```

The browser regression test uses the same example and verifies hooks/host context, CSS Module + image rebuilds, fixtures, syntax-error recovery, repeated rebuild cleanup, responsive preview, and exported production-package compatibility.
