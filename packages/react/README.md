# @componentonce/react

React integration for trusted ComponentOnce modules. React is a peer dependency, so dynamically loaded modules render with the host application's React instance.

## Define and render

```tsx
import {
  defineReactComponent,
  renderReactComponent,
} from "@componentonce/react";

interface Props { title: string }
interface HostContext { format: (value: string) => string; services: object }
interface Payload { recordId: number }

const card = defineReactComponent<Props, HostContext, Payload>({
  manifest: { id: "reports/card", version: "1.0.0" },
  component: ({ props, context, payload }) => (
    <article data-record={payload.recordId}>{context.format(props.title)}</article>
  ),
});

const element = renderReactComponent({
  definition: card,
  props: { title: "Quarterly report" },
  context: appRuntime,
  payload: { recordId: 42 },
});
```

The renderer receives an exact definition and the three separate values. It makes no assumptions about Context or Payload.

## Boundary validation

Typed rendering does not run validators by default. A host can explicitly request validation for trusted typed values:

```tsx
renderReactComponent({
  definition: card,
  props,
  context,
  payload,
  validation: { props: true, payload: true },
});
```

For raw values from JSON, editor state, or another untyped boundary, validate once and then render:

```tsx
const input = validateReactComponentBoundary(card, {
  props: rawProps,
  context: appRuntime,
  payload: rawPayload,
});

const element = renderReactComponent({ definition: card, ...input });
```

`renderReactComponentBoundary` provides the combined form. Boundary helpers require both validators and throw `ComponentOnceReactValidatorMissingError` when one is absent. Context is host-owned and passes through unchanged.

## Host-specific helpers

`createReactHostHelpers<HostContext, Payload>()` fixes an application's context and payload types while leaving each component's props type to be inferred:

```tsx
const components = createReactHostHelpers<AppRuntime, SelectionPayload>();
const card = components.define<CardProps>({ manifest, component: Card });
const element = components.render({ definition: card, props, context, payload });
```

See [`examples/two-hosts.tsx`](./examples/two-hosts.tsx) for one exact React definition rendered with two unrelated host context and payload shapes.
