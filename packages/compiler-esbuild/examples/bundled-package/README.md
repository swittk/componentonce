# Bundled implementation package example

A component may use a package as implementation without making it part of the
host ABI.

Component source:

    import * as React from "react";
    import { createReactRequirement, defineReactComponent } from "@componentonce/react";
    import { formatAmount } from "@example/card-formatters";

    export const definition = defineReactComponent({
      manifest: {
        id: "example/amount-card",
        version: "1.0.0",
        requirements: [createReactRequirement(React.version)],
      },
      component({ props }: { props: { amount: number } }) {
        return <strong>{formatAmount(props.amount)}</strong>;
      },
    });

Build it with the formatter inside the ComponentOnce JSON:

    componentonce build ./src/amount-card.tsx \
      --renderer react \
      --bundle @example/card-formatters \
      --out ./dist/amount-card.componentonce.json

The host provides React, its JSX runtime, and `@componentonce/react`. It does not
install or inject `@example/card-formatters` because that implementation package
was compiled into the artifact. If the formatter imports other bare packages, list
those explicitly with `--bundle` or `--external` according to who owns them.
