# ComponentOnce

Small FOSS-ready contracts for registering, loading, packaging, and rendering trusted, versioned, application-specific components.

ComponentOnce keeps three values distinct:

- **Props** are persisted/configured component values.
- **HostContext** is an arbitrary rich runtime object owned by the host application.
- **Payload** is arbitrary application/domain data supplied for one render or mount.

## Quick React flow

A component author writes an ordinary typed definition:

```tsx
import {
  createReactRequirement,
  defineReactComponent,
} from "@componentonce/react";

interface Props {
  readonly title: string;
}

interface HostContext {
  readonly format: (value: number) => string;
}

interface Payload {
  readonly total: number;
}

export const definition = defineReactComponent<Props, HostContext, Payload>({
  manifest: {
    id: "example/total-card",
    version: "1.0.0",
    requirements: [createReactRequirement("19.3.0")],
  },
  component({ props, context, payload }) {
    return <strong>{props.title}: {context.format(payload.total)}</strong>;
  },
});
```

The React requirement is explicit and persisted. Choose the exact version, or a stable version convention, that your host compatibility policy understands.

Build a self-describing package:

```sh
componentonce build ./src/total-card.tsx \
  --renderer react \
  --out ./dist/total-card.componentonce.json
```

The package contains the manifest, integrity-protected executable bundle, and any CSS, images, fonts, or configured file-loader outputs reached through ordinary relative imports. A catalog can read `package.manifest` without executing component code. The trusted high-level builder evaluates the module once during build to discover that manifest.

Application integrations bind the host context type and runtime policy once; each component still owns its Props and Payload types:

```ts
import { createReactHost } from "@componentonce/react";

const components = createReactHost<HostContext>({
  capabilities: [{ name: "example-api", version: "1" }],
});

const element = components.render({
  definition,
  props: { title: "Total" },
  context,
  payload,
});
```

The React adapter automatically advertises the actual peer React singleton/version. Callers do not repeat React or application capabilities on every render.

## Packages

### `@componentonce/core`

Renderer-agnostic exact identities, versioned registries, loader contracts, validators, and generic runtime/application capability requirements. It imports no React, compiler, storage, transport, database, or application code.

### `@componentonce/react`

React definitions and rendering using the host React singleton, boundary validation, automatic React capability reporting, and host-bound helpers.

### `@componentonce/dom`

React-free ordinary DOM components with explicit `mount -> update -> destroy` lifecycle, automatic DOM capability reporting, and host-bound helpers.

### `@componentonce/runtime`

Browser-safe trusted package loading and execution. It parses the same self-describing package envelope emitted by compiler adapters, verifies executable and embedded asset bytes with Web Crypto SHA-256, prepares host-resolved asset URLs, attaches styles to an explicit `Document` or `ShadowRoot`, and evaluates trusted bundles with an explicit host-external map. It imports no compiler or Node builtin.

### `@componentonce/compiler-esbuild`

Optional trusted build tooling. It supports low-level compilation plus self-describing package helpers and the `componentonce build` CLI. Relative JavaScript, CSS, CSS Module, and static-file imports can be bundled; package/runtime imports stay explicit host externals.

### `@componentonce/dev`

Optional local React development workbench. `componentonce dev` watches the full source/import/asset graph through the production compiler, executes the result against a browser-only real host profile and shared React singleton, keeps Props/Context/Payload fixtures separate, retains the last good preview across compile failures, and can export an ordinary v2 package. It is loopback-only trusted-code tooling, not a production server or sandbox.

## Compatibility

A manifest can require multiple named capabilities, for example React plus an application SDK. Exact name/version equality is the default. Hosts can supply another compatibility predicate when they intentionally support ranges or other version policies.

Sharing the host React singleton prevents duplicate-React hook failures. Capability checks separately prevent a component authored against an incompatible React/API version from rendering accidentally.

## Trust model

The v0 target is trusted internal component code. The esbuild evaluator uses `new Function`; it is not a security sandbox. Storage, transport, databases, visual editors, and marketplace policy remain host concerns.
