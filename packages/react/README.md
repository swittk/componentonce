# @componentonce/react

React adapter for trusted ComponentOnce modules.

React is a peer dependency. Dynamically compiled modules must use the host application's actual React and JSX-runtime instances rather than bundling another React copy.

## Define a component

```tsx
import {
  createReactRequirement,
  defineReactComponent,
} from "@componentonce/react";

export const definition = defineReactComponent<
  { readonly label: string },
  { readonly format: (value: string) => string },
  { readonly count: number }
>({
  manifest: {
    id: "example/counter-label",
    version: "1.0.0",
    requirements: [createReactRequirement("19.3.0")],
  },
  component({ props, context, payload }) {
    return <strong>{context.format(props.label)}: {payload.count}</strong>;
  },
});
```

React requirements are intentionally explicit. A dynamic module must not derive its requirement from the runtime host React, because that would let old code silently claim compatibility with a newer runtime.

## Bind a host once

For application integrations, `createReactHost<HostContext>()` is the normal ergonomic entry point. It binds only the host context/runtime policy; each component still chooses its own Props and Payload types:

```ts
const components = createReactHost<HostContext>({
  capabilities: [
    { name: "example-api", version: "2" },
  ],
  capabilityCompatibility,
});

const definition = components.define<Props, Payload>({ ... });

const element = components.render({
  definition,
  props,
  context,
  payload,
});
```

The helper binds application capabilities and compatibility policy once. The actual React capability is supplied automatically from the peer React singleton and cannot be spoofed by a repeated per-render value.

The lower-level `defineReactComponent`, `renderReactComponent`, boundary helpers, and `createReactHostHelpers` remain available when a host wants to manage those inputs manually.

## Validation boundaries

Typed rendering does not revalidate values by default. Raw JSON/editor/storage boundaries can use `validateReactComponentBoundary`, `renderReactComponentBoundary`, or the equivalent methods on a bound host.

Props and Payload validators are optional and only run when a boundary or explicit validation request needs them.

## Runtime compatibility

A component can declare any number of generic requirements. React requirements use the stable capability name `react`.

Exact version matching is the core default. A host that intentionally supports a version range can supply a capability compatibility predicate. Sharing the React singleton solves duplicate-React hook problems; capability matching solves API-version compatibility.
