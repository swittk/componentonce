import {
  createReactRequirement,
  defineReactComponent,
} from "@componentonce/react";

interface CardProps {
  readonly label: string;
}

interface HostContext {
  readonly formatAmount: (value: number) => string;
}

interface CardPayload {
  readonly amount: number;
}

/**
 * A component module only exports a normal ComponentOnce definition.
 * The CLI/compiler discovers this manifest once at trusted build time and stores it in the package.
 */
export const definition = defineReactComponent<CardProps, HostContext, CardPayload>({
  manifest: {
    id: "example/amount-card",
    version: "1.0.0",
    requirements: [createReactRequirement("19.3.0")],
  },
  component({ props, context, payload }) {
    return <strong>{props.label}: {context.formatAmount(payload.amount)}</strong>;
  },
});
