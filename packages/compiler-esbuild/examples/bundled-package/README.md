# Bundled implementation package example

A component may use a package as implementation without making it part of the
host ABI.

Component source:

    import { formatAmount } from "@example/card-formatters";

    export const definition = defineReactComponent({
      manifest: {
        id: "example/amount-card",
        version: "1.0.0",
        requirements: [createReactRequirement(React.version)],
      },
      component({ props }) {
        return <strong>{formatAmount(props.amount)}</strong>;
      },
    });

Build it with the formatter inside the ComponentOnce JSON:

    componentonce build ./src/amount-card.tsx \
      --renderer react \
      --bundle @example/card-formatters \
      --external @example/host-sdk \
      --out ./dist/amount-card.componentonce.json

The host must provide @example/host-sdk. It does not install or inject
@example/card-formatters because that implementation package was compiled into
the artifact.
