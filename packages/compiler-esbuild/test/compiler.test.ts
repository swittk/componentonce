import type { ComponentOnceDefinition } from "../../core/src/index.js";
import type { ComponentType } from "react";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  COMPONENTONCE_TRUSTED_BUNDLE_FORMAT,
  ComponentOnceCompileError,
  ComponentOnceIntegrityError,
  ComponentOnceMissingExternalError,
  calculateTrustedBundleIntegrity,
  compileTrustedModule,
  compileTrustedReactModule,
  instantiateTrustedBundle,
} from "../src/index.js";

interface CounterProps {
  readonly initial: number;
}

interface HostContext {
  readonly prefix: string;
}

interface RenderPayload {
  readonly suffix: string;
}

interface RenderInput {
  readonly props: CounterProps;
  readonly context: HostContext;
  readonly payload: RenderPayload;
}

type CounterDefinition = ComponentOnceDefinition<
  ComponentType<RenderInput>,
  CounterProps,
  HostContext,
  RenderPayload
>;

interface CounterModule {
  readonly definition: CounterDefinition;
}

const counterSource = `
  import { useState } from "react";

  interface Props { readonly initial: number }
  interface Context { readonly prefix: string }
  interface Payload { readonly suffix: string }

  export const definition = {
    manifest: { id: "example.counter", version: "1.0.0", displayName: "Counter" },
    implementation({ props, context, payload }: {
      props: Props;
      context: Context;
      payload: Payload;
    }) {
      const [count] = useState(props.initial);
      return <button>{context.prefix}:{count}:{payload.suffix}</button>;
    },
  };
`;

describe("compileTrustedReactModule", () => {
  it("compiles TSX to an immutable deterministic artifact", async () => {
    const first = await compileTrustedReactModule({
      source: counterSource,
      sourceFileName: "counter.tsx",
    });
    const second = await compileTrustedReactModule({
      source: counterSource,
      sourceFileName: "counter.tsx",
    });

    expect(first.format).toBe(COMPONENTONCE_TRUSTED_BUNDLE_FORMAT);
    expect(first.code).toBe(second.code);
    expect(first.sha256).toBe(second.sha256);
    expect(first.integrity).toBe(second.integrity);
    expect(first.integrity).toBe(calculateTrustedBundleIntegrity(first.code));
    expect(first.byteLength).toBe(Buffer.byteLength(first.code, "utf8"));
    expect(first.externalModules).toEqual(["react", "react/jsx-runtime"]);
    expect(first.code).toContain('require("react")');
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.metafile)).toBe(true);
  });

  it("instantiates a ComponentOnce-compatible definition with the host React instance", async () => {
    const artifact = await compileTrustedReactModule({
      source: counterSource,
      sourceFileName: "counter.tsx",
    });

    const loaded = instantiateTrustedBundle<CounterModule>(artifact, {
      externals: {
        react: React,
        "react/jsx-runtime": jsxRuntime,
      },
    });
    const definition: CounterDefinition = loaded.definition;
    const html = renderToStaticMarkup(
      React.createElement(definition.implementation, {
        props: { initial: 4 },
        context: { prefix: "host" },
        payload: { suffix: "render" },
      }),
    );

    expect(definition.manifest).toEqual({
      id: "example.counter",
      version: "1.0.0",
      displayName: "Counter",
    });
    expect(html).toBe("<button>host:4:render</button>");
  });

  it("injects an arbitrary host-defined external module", async () => {
    const artifact = await compileTrustedReactModule({
      source: `
        import { decorate } from "@example/host-sdk";
        export const value = decorate("module");
      `,
      sourceFileName: "host-sdk.ts",
      additionalExternalModules: ["@example/host-sdk"],
    });

    const loaded = instantiateTrustedBundle<{ readonly value: string }>(artifact, {
      externals: {
        "@example/host-sdk": {
          decorate: (value: string) => `host:${value}`,
        },
      },
    });

    expect(artifact.externalModules).toEqual(["@example/host-sdk"]);
    expect(loaded.value).toBe("host:module");
  });

  it("fails deterministically when a required external is missing", async () => {
    const artifact = await compileTrustedReactModule({
      source: `import { value } from "@example/missing"; export { value };`,
      sourceFileName: "missing.ts",
      additionalExternalModules: ["@example/missing"],
    });

    const instantiate = () => instantiateTrustedBundle(artifact, { externals: {} });
    const expectedMessage =
      'Missing trusted bundle external "@example/missing". Available externals: (none).';

    expect(instantiate).toThrow(ComponentOnceMissingExternalError);
    expect(instantiate).toThrow(expectedMessage);
    expect(instantiate).toThrow(expectedMessage);
  });

  it("returns useful normalized syntax diagnostics", async () => {
    let failure: unknown;
    try {
      await compileTrustedReactModule({
        source: "export const broken: = 1;",
        sourceFileName: "broken.tsx",
      });
    } catch (error: unknown) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(ComponentOnceCompileError);
    const compileError = failure as ComponentOnceCompileError;
    expect(compileError.message).toContain("broken.tsx:1:");
    expect(compileError.diagnostics).toHaveLength(1);
    expect(compileError.diagnostics[0]).toMatchObject({
      kind: "error",
      location: { file: "broken.tsx", line: 1 },
    });
    expect(compileError.diagnostics[0]?.text.length).toBeGreaterThan(0);
  });

  it("rejects undeclared imports during compilation", async () => {
    await expect(
      compileTrustedReactModule({
        source: `import value from "@example/not-declared"; export { value };`,
      }),
    ).rejects.toMatchObject({
      name: "ComponentOnceCompileError",
      diagnostics: [
        expect.objectContaining({
          text: expect.stringContaining("additionalExternalModules"),
        }),
      ],
    });
  });


  it("compiles and instantiates a plain trusted module without implicit React externals", async () => {
    const artifact = await compileTrustedModule({
      source: `
        export function mount(target: { textContent: string }, value: string) {
          target.textContent = value;
        }
      `,
      sourceFileName: "plain-dom.ts",
    });

    expect(artifact.externalModules).toEqual([]);
    expect(artifact.code).not.toContain('require("react")');

    const loaded = instantiateTrustedBundle<{
      readonly mount: (target: { textContent: string }, value: string) => void;
    }>(artifact, { externals: {} });
    const target = { textContent: "" };
    loaded.mount(target, "plain");
    expect(target.textContent).toBe("plain");
  });

  it("checks stored bundle integrity before executing code", async () => {
    const artifact = await compileTrustedReactModule({
      source: "export const value = 42;",
      sourceFileName: "integrity.ts",
    });

    const storedBytes = new TextEncoder().encode(artifact.code);
    const loaded = instantiateTrustedBundle<{ readonly value: number }>(storedBytes, {
      externals: {},
      expectedIntegrity: artifact.integrity,
    });
    expect(loaded.value).toBe(42);

    expect(() =>
      instantiateTrustedBundle(`${artifact.code}\n// modified`, {
        externals: {},
        expectedIntegrity: artifact.integrity,
      }),
    ).toThrow(ComponentOnceIntegrityError);
  });
});
