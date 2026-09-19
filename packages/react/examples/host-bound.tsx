import { createReactHost, createReactRequirement } from "@componentonce/react";

interface HostContext {
  readonly format: (value: string) => string;
}

interface Payload {
  readonly recordId: number;
}

/**
 * Application integrations bind their context/payload types and runtime capabilities once.
 * Individual components only choose their own persisted Props type.
 */
export const components = createReactHost<HostContext>({
  capabilities: [{ name: "example-api", version: "1" }],
});

export const card = components.define<{ readonly title: string }, Payload>({
  manifest: {
    id: "example/host-bound-card",
    version: "1.0.0",
    requirements: [
      createReactRequirement("19.3.0"),
      { name: "example-api", version: "1" },
    ],
  },
  component({ props, context, payload }) {
    return <article data-record={payload.recordId}>{context.format(props.title)}</article>;
  },
});

export const element = components.render({
  definition: card,
  props: { title: "Status" },
  context: { format: (value) => value.toUpperCase() },
  payload: { recordId: 42 },
});
