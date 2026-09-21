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

The safe default is loopback-only at http://127.0.0.1:4173. Port and bind address are configurable:

    componentonce dev ./src/card.tsx --host ./dev/host.ts --port 4300
    componentonce dev ./src/card.tsx --host ./dev/host.ts --bind 0.0.0.0 --port 4300

When binding beyond loopback, ComponentOnce still validates HTTP Host values. Local interface addresses are allowed automatically; use repeatable --allowed-host name.example only for an intentional custom hostname/reverse proxy.

## Browser host profile

The host profile is a normal browser module. It is never evaluated by the Node compiler, so application SDK initialization, Parse/browser clients, React providers, query caches, theme providers, and other browser-owned values can remain real.

```ts
import { defineReactDevHost } from "@componentonce/dev/host";
import * as AppSdk from "@my-app/sdk";

export default defineReactDevHost({
  name: "My application",
  capabilities: [{ name: "my-app-sdk", version: "3" }],
  themes: [
    { value: "light", label: "Light" },
    { value: "dark", label: "Dark" },
  ],
  applyTheme(value) {
    // This is host policy. It could toggle a class, CSS variables, a provider, etc.
    document.documentElement.dataset.theme = value;
  },
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

## Function-valued Props / Payload

ComponentOnce Props and Payload are generic and may legitimately contain functions. The workbench editor itself stays serializable, so a browser host profile provides a named callable catalog and fixtures reference those callables declaratively:

```ts
export default defineReactDevHost({
  functions: {
    openClient: realOpenClient,
    saveDraft: {
      mode: "mock",
      description: "Local no-op save used by this fixture.",
      call: async (input) => ({ ok: true, input }),
    },
  },
  fixtures: [
    {
      name: "Interactive",
      props: {
        onOpen: { $componentonceFunction: "openClient" },
        onSave: {
          $componentonceFunction: "saveDraft",
          bind: [{ source: "dev-fixture" }],
        },
      },
      payload: {},
    },
  ],
});
```

Before ComponentOnce validation/rendering, the preview host resolves those markers to ordinary function values. `bind` supplies optional leading arguments; arguments from the component are appended at call time.

The catalog can point at real application functions or mocks. The workbench shows every available callable and keeps a bounded call log with bound arguments, runtime arguments, and synchronous/async outcomes. Unknown function references fail visibly while retaining the last good preview.

Raw function objects are intentionally rejected inside fixtures because they cannot cross the iframe/editor transport reliably; put them in `functions` and reference them by name instead. These markers are development-fixture syntax only and do not change persisted ComponentOnce package/Props contracts.

## What the workbench shows

- live component preview in an iframe;
- Props, Payload, and Context-input JSON kept separate;
- named fixtures supplied by the real host profile;
- host-defined actual/mock callable catalogs for function-valued Props/Payload, with invocation logs;
- host capabilities and external import list;
- manifest requirements, bundle size, packaged assets, and compiler/runtime diagnostics;
- responsive/mobile width presets plus free drag-resize with live width × height;
- host-defined visual/theme variants (the workbench assumes no Tailwind, class name, CSS-variable, or theme convention);
- an Export package action that emits a normal componentonce.trusted-package.v2 envelope.

Source dependency edits (TS/JS, CSS/CSS Modules, images/fonts/assets) trigger rebuilds. Successful source updates remount only the preview component, preserving fixture inputs and the workbench shell. Syntax/import/runtime failures keep the last good component mounted, update the diagnostics panel, and show an auto-clearing redbox-style overlay over the preview.

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

The development HTTP server binds to 127.0.0.1 by default. Broader binding is opt-in with --bind; even then it accepts only local-interface or explicitly allowlisted Host values, rejects cross-origin/cross-site requests, exposes only generated workbench/preview assets plus status/artifact endpoints, never serves repository files, and uses Cache-Control: no-store.

## Example

The package includes examples/card.tsx and examples/host.ts.

```sh
cd packages/dev
componentonce dev ./examples/card.tsx --host ./examples/host.ts
```

The browser regression test uses the same example and verifies hooks/host context, CSS Module + image rebuilds, fixtures, syntax-error recovery, repeated rebuild cleanup, responsive preview, and exported production-package compatibility.
