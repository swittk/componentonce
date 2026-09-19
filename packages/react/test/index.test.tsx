import { ComponentOnceCapabilityVersionError } from "@componentonce/core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import {
  ComponentOnceReactValidatorMissingError,
  createReactHostHelpers,
  createReactRequirement,
  defineReactComponent,
  renderReactComponent,
  renderReactComponentBoundary,
  validateReactComponentBoundary,
  type ComponentOnceReactDefinition,
  type ComponentOnceReactRenderInput,
} from "../src/index.js";

interface CardProps {
  readonly title: string;
}

interface AppContext {
  readonly formatTitle: (title: string) => string;
  readonly services: { readonly audit: (event: string) => void };
}

interface CardPayload {
  readonly recordId: number;
}

function requireRecord(input: unknown): Record<string, unknown> {
  if (typeof input !== "object" || input === null) throw new TypeError("Expected an object");
  return input as Record<string, unknown>;
}

function makeDefinition(
  validateProps = vi.fn((input: unknown): CardProps => {
    const record = requireRecord(input);
    if (typeof record.title !== "string") throw new TypeError("Expected title");
    return { title: record.title.trim() };
  }),
  validatePayload = vi.fn((input: unknown): CardPayload => {
    const record = requireRecord(input);
    if (typeof record.recordId !== "number") throw new TypeError("Expected recordId");
    return { recordId: record.recordId };
  }),
) {
  return {
    definition: defineReactComponent<CardProps, AppContext, CardPayload>({
      manifest: { id: "example/card", version: "1.0.0" },
      component: ({ props, context, payload }) => (
        <article data-record={payload.recordId}>{context.formatTitle(props.title)}</article>
      ),
      validateProps,
      validatePayload,
    }),
    validateProps,
    validatePayload,
  };
}

describe("React definitions and rendering", () => {
  it("keeps Props, HostContext, and Payload distinct and renders with the host React", () => {
    const { definition, validateProps, validatePayload } = makeDefinition();
    const context: AppContext = {
      formatTitle: (title) => title.toUpperCase(),
      services: { audit: () => undefined },
    };

    expectTypeOf(definition).toEqualTypeOf<
      ComponentOnceReactDefinition<CardProps, AppContext, CardPayload>
    >();
    expectTypeOf(definition.implementation).parameter(0).toEqualTypeOf<
      ComponentOnceReactRenderInput<CardProps, AppContext, CardPayload>
    >();

    const markup = renderToStaticMarkup(
      renderReactComponent({
        definition,
        props: { title: "Report" },
        context,
        payload: { recordId: 42 },
      }),
    );

    expect(markup).toBe('<article data-record="42">REPORT</article>');
    expect(validateProps).not.toHaveBeenCalled();
    expect(validatePayload).not.toHaveBeenCalled();
  });

  it("validates typed values only when explicitly requested", () => {
    const { definition, validateProps, validatePayload } = makeDefinition();
    const markup = renderToStaticMarkup(
      renderReactComponent({
        definition,
        props: { title: "  Report  " },
        context: {
          formatTitle: (title) => title,
          services: { audit: () => undefined },
        },
        payload: { recordId: 7 },
        validation: true,
      }),
    );

    expect(markup).toContain(">Report</article>");
    expect(validateProps).toHaveBeenCalledOnce();
    expect(validatePayload).toHaveBeenCalledOnce();
  });

  it("validates raw unknown values once through the boundary helper", () => {
    const { definition, validateProps, validatePayload } = makeDefinition();
    const context: AppContext = {
      formatTitle: (title) => `[${title}]`,
      services: { audit: () => undefined },
    };
    const input = validateReactComponentBoundary(definition, {
      props: { title: "  queued  " } as unknown,
      context,
      payload: { recordId: 9 } as unknown,
    });

    expect(input).toEqual({
      props: { title: "queued" },
      context,
      payload: { recordId: 9 },
    });
    expect(renderToStaticMarkup(renderReactComponent({ definition, ...input }))).toContain(
      ">[queued]</article>",
    );
    expect(validateProps).toHaveBeenCalledOnce();
    expect(validatePayload).toHaveBeenCalledOnce();
  });

  it("validates and renders raw boundary values without a second validation pass", () => {
    const { definition, validateProps, validatePayload } = makeDefinition();
    const markup = renderToStaticMarkup(
      renderReactComponentBoundary({
        definition,
        props: { title: " boundary " } as unknown,
        context: {
          formatTitle: (title) => title,
          services: { audit: () => undefined },
        },
        payload: { recordId: 11 } as unknown,
      }),
    );

    expect(markup).toContain(">boundary</article>");
    expect(validateProps).toHaveBeenCalledOnce();
    expect(validatePayload).toHaveBeenCalledOnce();
  });

  it("reports a missing validator when boundary validation is requested", () => {
    const definition = defineReactComponent<CardProps, AppContext, CardPayload>({
      manifest: { id: "example/unvalidated", version: "1.0.0" },
      component: () => null,
    });

    expect(() =>
      renderReactComponent({
        definition,
        props: { title: "Report" },
        context: {
          formatTitle: (title) => title,
          services: { audit: () => undefined },
        },
        payload: { recordId: 1 },
        validation: { props: true },
      }),
    ).toThrow(ComponentOnceReactValidatorMissingError);
  });

  it("creates host-specific helpers without importing application types into the package", () => {
    const host = createReactHostHelpers<AppContext, CardPayload>();
    const definition = host.define<CardProps>({
      manifest: { id: "example/host-card", version: "1.0.0" },
      component: ({ props, payload }) => (
        <span>{props.title}:{payload.recordId}</span>
      ),
    });

    const element = host.render({
      definition,
      props: { title: "item" },
      context: {
        formatTitle: (title) => title,
        services: { audit: () => undefined },
      },
      payload: { recordId: 5 },
    });
    expect(renderToStaticMarkup(element)).toBe("<span>item:5</span>");

    if (false) {
      host.render({
        definition,
        props: { title: "item" },
        context: {
          formatTitle: (title) => title,
          services: { audit: () => undefined },
        },
        // @ts-expect-error Props cannot be used as the per-render Payload.
        payload: { title: "wrong" },
      });
    }
  });

  it("rejects a React runtime version mismatch before rendering", () => {
    const definition = defineReactComponent<CardProps, AppContext, CardPayload>({
      manifest: {
        id: "example/react-19-card",
        version: "1.0.0",
        requirements: [createReactRequirement("19")],
      },
      component: () => <span>never rendered</span>,
    });

    expect(() =>
      renderReactComponent({
        definition,
        props: { title: "Report" },
        context: {
          formatTitle: (title) => title,
          services: { audit: () => undefined },
        },
        payload: { recordId: 1 },
        hostCapabilities: [{ name: "react", version: "18" }],
      }),
    ).toThrow(ComponentOnceCapabilityVersionError);
  });

  it("lets a host deliberately accept a compatible React runtime range", () => {
    const definition = defineReactComponent<CardProps, AppContext, CardPayload>({
      manifest: {
        id: "example/react-compatible-card",
        version: "1.0.0",
        requirements: [createReactRequirement("18")],
      },
      component: ({ props }) => <span>{props.title}</span>,
    });

    const element = renderReactComponent({
      definition,
      props: { title: "compatible" },
      context: {
        formatTitle: (title) => title,
        services: { audit: () => undefined },
      },
      payload: { recordId: 1 },
      hostCapabilities: [{ name: "react", version: "19" }],
      capabilityCompatibility: (requirement, available) =>
        requirement.name === available.name &&
        Number(available.version) >= Number(requirement.version),
    });

    expect(renderToStaticMarkup(element)).toBe("<span>compatible</span>");
  });

});
