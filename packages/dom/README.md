# @componentonce/dom

Trusted ordinary DOM adapter for ComponentOnce. It has no React dependency.

A DOM component receives the same three independent channels as every ComponentOnce renderer: persisted Props, host-owned Context, and per-render Payload. Its implementation mounts into a host-owned Element and returns explicit update/destroy lifecycle methods.

## Define

```ts
import {
  createDomRequirement,
  defineDomComponent,
} from "@componentonce/dom";

export const definition = defineDomComponent<
  { readonly label: string },
  { readonly format: (value: string) => string },
  { readonly count: number }
>({
  manifest: {
    id: "example/plain-card",
    version: "1.0.0",
    requirements: [createDomRequirement("1")],
  },
  implementation: {
    mount(target, input) {
      const render = (next: typeof input) => {
        target.textContent =
          next.context.format(next.props.label) + ": " + next.payload.count;
      };
      render(input);

      return {
        update(next) {
          render(next);
        },
        destroy() {
          target.replaceChildren();
        },
      };
    },
  },
});
```

## Bind a host once

```ts
const components = createDomHost<HostContext>({
  capabilities: [{ name: "example-api", version: "1" }],
});

const mounted = components.mount({
  definition,
  target,
  props,
  context,
  payload,
});
```

The DOM adapter automatically supplies its own `browser-dom@1` capability. Application-specific capabilities and compatibility policy are bound once by `createDomHost`; each component still chooses its own Props and Payload types.

Low-level `mountDomComponent` and boundary helpers remain available.

## Validation

Typed mounts do not revalidate values unless explicitly requested. `mountDomComponentBoundary` and the bound host's `mountBoundary` method validate unknown Props/Payload once before mounting.
