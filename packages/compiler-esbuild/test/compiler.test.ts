import type { ComponentOnceDefinition } from "../../core/src/index.js";
import type { ComponentType } from "react";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  COMPONENTONCE_ASSET_URL_PREFIX,
  COMPONENTONCE_TRUSTED_BUNDLE_FORMAT,
  COMPONENTONCE_TRUSTED_PACKAGE_FORMAT,
  ComponentOnceCompileError,
  ComponentOnceIntegrityError,
  ComponentOnceMissingExternalError,
  ComponentOncePackageManifestMismatchError,
  buildTrustedReactPackage,
  calculateTrustedBundleIntegrity,
  compileTrustedModule,
  compileTrustedReactModule,
  instantiateTrustedBundle,
  instantiateTrustedComponentPackage,
  parseTrustedComponentPackage,
  serializeTrustedComponentPackage,
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


  it("bundles relative source imports when resolveDir is supplied", async () => {
    const artifact = await compileTrustedModule({
      source: `
        import { decorate } from "./helper";
        export const value = decorate("relative");
      `,
      sourceFileName: "entry.ts",
      resolveDir: fileURLToPath(new URL("./fixtures", import.meta.url)),
    });

    expect(artifact.externalModules).toEqual([]);
    const loaded = instantiateTrustedBundle<{ readonly value: string }>(artifact, {
      externals: {},
    });
    expect(loaded.value).toBe("[RELATIVE]");
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

  it("builds a self-describing React package that can be inspected before execution", async () => {
    const componentPackage = await buildTrustedReactPackage({
      source: counterSource,
      sourceFileName: "counter.tsx",
      externals: {
        react: React,
        "react/jsx-runtime": jsxRuntime,
      },
    });

    expect(componentPackage.format).toBe(COMPONENTONCE_TRUSTED_PACKAGE_FORMAT);
    expect(componentPackage.renderer).toBe("react");
    expect(componentPackage.manifest).toEqual({
      id: "example.counter",
      version: "1.0.0",
      displayName: "Counter",
    });
    expect(componentPackage.definitionExport).toBe("definition");

    const stored = serializeTrustedComponentPackage(componentPackage);
    const parsed = parseTrustedComponentPackage(stored);
    expect(parsed.manifest.id).toBe("example.counter");

    const definition = instantiateTrustedComponentPackage<CounterDefinition>(parsed, {
      externals: {
        react: React,
        "react/jsx-runtime": jsxRuntime,
      },
    });
    const html = renderToStaticMarkup(
      React.createElement(definition.implementation, {
        props: { initial: 6 },
        context: { prefix: "packaged" },
        payload: { suffix: "ok" },
      }),
    );
    expect(html).toBe("<button>packaged:6:ok</button>");
  });

  it("rejects a package envelope whose manifest no longer matches its executable definition", async () => {
    const componentPackage = await buildTrustedReactPackage({
      source: counterSource,
      sourceFileName: "counter.tsx",
      externals: {
        react: React,
        "react/jsx-runtime": jsxRuntime,
      },
    });
    const stalePackage = {
      ...componentPackage,
      manifest: { ...componentPackage.manifest, version: "9.9.9" },
    };

    expect(() =>
      instantiateTrustedComponentPackage(stalePackage, {
        externals: {
          react: React,
          "react/jsx-runtime": jsxRuntime,
        },
      }),
    ).toThrow(ComponentOncePackageManifestMismatchError);
  });

  it("packages CSS, CSS Modules, nested CSS imports, file URLs, and arbitrary bytes", async () => {
    const resolveDir = fileURLToPath(new URL("./fixtures", import.meta.url));
    const artifact = await compileTrustedModule({
      source: `
        import "./styles.css";
        import styles from "./card.module.css";
        import logo from "./logo.svg";
        import pixel from "./pixel.png";
        import payload from "./payload.bin";
        import data from "./data.json";
        import note from "./note.txt";
        export const values = { styles, logo, pixel, payload, data, note };
      `,
      sourceFileName: "asset-entry.ts",
      resolveDir,
      loaders: { ".bin": "file" },
      contentTypes: { ".bin": "application/x-example-binary" },
    });

    expect(artifact.stylesheets).toEqual(["component.css"]);
    const assets = artifact.assets ?? [];
    expect(assets).toHaveLength(5);
    expect(assets.map((asset) => asset.path)).toEqual(
      expect.arrayContaining([
        "component.css",
        expect.stringMatching(/^assets\/[A-Z0-9]+\.bin$/u),
        expect.stringMatching(/^assets\/[A-Z0-9]+\.png$/u),
        expect.stringMatching(/^assets\/[A-Z0-9]+\.svg$/u),
        expect.stringMatching(/^assets\/[A-Z0-9]+\.woff2$/u),
      ]),
    );
    expect(assets.find((asset) => asset.path.endsWith(".bin"))?.contentType).toBe(
      "application/x-example-binary",
    );
    expect(assets.find((asset) => asset.path.endsWith(".png"))?.contentType).toBe(
      "image/png",
    );
    const stylesheet = Buffer.from(
      assets.find((asset) => asset.path === "component.css")!.content,
      "base64",
    ).toString("utf8");
    expect(stylesheet).toContain(".nested-rule");
    expect(stylesheet).toContain(COMPONENTONCE_ASSET_URL_PREFIX);
    expect(artifact.code).toContain(COMPONENTONCE_ASSET_URL_PREFIX);

    const loaded = instantiateTrustedBundle<{
      readonly values: {
        readonly styles: { readonly root: string };
        readonly logo: string;
        readonly pixel: string;
        readonly payload: string;
        readonly data: { readonly answer: number };
        readonly note: string;
      };
    }>(artifact, { externals: {} });
    expect(loaded.values.styles.root).toMatch(/root/u);
    expect(loaded.values.logo).toContain(COMPONENTONCE_ASSET_URL_PREFIX);
    expect(loaded.values.pixel).toContain(COMPONENTONCE_ASSET_URL_PREFIX);
    expect(loaded.values.payload).toContain(COMPONENTONCE_ASSET_URL_PREFIX);
    expect(loaded.values.data.answer).toBe(42);
    expect(loaded.values.note).toBe("ordinary text import\n");
  });

  it("allows explicit small data URLs without adding emitted assets", async () => {
    const artifact = await compileTrustedModule({
      source: `import logo from "./logo.svg"; export { logo };`,
      sourceFileName: "inline-entry.ts",
      resolveDir: fileURLToPath(new URL("./fixtures", import.meta.url)),
      loaders: { ".svg": "dataurl" },
    });
    const loaded = instantiateTrustedBundle<{ readonly logo: string }>(artifact, {
      externals: {},
    });
    expect(loaded.logo).toMatch(/^data:image\/svg\+xml/u);
    expect(artifact.assets).toEqual([]);
  });

  it("names CSS Module classes by content so separate package builds cannot collide", async () => {
    const compileModule = (resolveDir: string) =>
      compileTrustedModule({
        source: `import styles from "./card.module.css"; export { styles };`,
        sourceFileName: "module-entry.ts",
        resolveDir,
      });
    const first = await compileModule(fileURLToPath(new URL("./fixtures", import.meta.url)));
    const second = await compileModule(
      fileURLToPath(new URL("./fixtures/alternate", import.meta.url)),
    );
    const firstStyles = instantiateTrustedBundle<{
      readonly styles: { readonly root: string };
    }>(first, { externals: {} }).styles;
    const secondStyles = instantiateTrustedBundle<{
      readonly styles: { readonly root: string };
    }>(second, { externals: {} }).styles;
    expect(firstStyles.root).not.toBe(secondStyles.root);
  });

  it("names equal CSS Modules by dependency content without using absolute directories", async () => {
    const compileModule = async (fixture: string) => {
      const artifact = await compileTrustedModule({
        source: `import styles from "./card.module.css"; export { styles };`,
        sourceFileName: "module-entry.ts",
        resolveDir: fileURLToPath(new URL("./fixtures/" + fixture + "/", import.meta.url)),
      });
      return instantiateTrustedBundle<{
        readonly styles: { readonly card: string };
      }>(artifact, { externals: {} }).styles.card;
    };

    const first = await compileModule("collision-a");
    const changedDependency = await compileModule("collision-b");
    const identicalCopy = await compileModule("collision-copy");
    expect(first).not.toBe(changedDependency);
    expect(first).toBe(identicalCopy);
  });

  it("serializes and parses a deterministic v2 package with every emitted file", async () => {
    const buildInput = {
      source: `
        import logo from "./logo.svg";
        import styles from "./card.module.css";
        export const definition = {
          manifest: { id: "example.asset-card", version: "1.0.0" },
          implementation: () => ({ logo, className: styles.root }),
        };
      `,
      sourceFileName: "asset-card.tsx",
      resolveDir: fileURLToPath(new URL("./fixtures", import.meta.url)),
      externals: {
        react: React,
        "react/jsx-runtime": jsxRuntime,
      },
    };
    const componentPackage = await buildTrustedReactPackage(buildInput);
    const repeatedPackage = await buildTrustedReactPackage(buildInput);
    expect(componentPackage.format).toBe("componentonce.trusted-package.v2");
    expect(componentPackage.assets.map((asset) => asset.path)).toEqual(
      expect.arrayContaining([
        "component.css",
        expect.stringMatching(/^assets\/[A-Z0-9]+\.svg$/u),
      ]),
    );
    const serialized = serializeTrustedComponentPackage(componentPackage);
    expect(serializeTrustedComponentPackage(repeatedPackage)).toBe(serialized);
    const parsed = parseTrustedComponentPackage(serialized);
    expect(serializeTrustedComponentPackage(parsed)).toBe(serialized);
    const inspected = instantiateTrustedComponentPackage<{
      readonly manifest: { readonly id: string; readonly version: string };
      readonly implementation: () => { readonly logo: string; readonly className: string };
    }>(parsed, {
      externals: {
        react: React,
        "react/jsx-runtime": jsxRuntime,
      },
    });
    expect(inspected.implementation().logo).toContain(
      COMPONENTONCE_ASSET_URL_PREFIX,
    );
    const loaded = instantiateTrustedComponentPackage<{
      readonly manifest: { readonly id: string; readonly version: string };
      readonly implementation: () => { readonly logo: string; readonly className: string };
    }>(parsed, {
      externals: {
        react: React,
        "react/jsx-runtime": jsxRuntime,
      },
      resolveAssetUrl: (asset) => "https://assets.example/" + asset.path,
    });
    expect(loaded.implementation().logo).toMatch(
      /^https:\/\/assets\.example\/assets\//u,
    );

    const tampered = JSON.parse(serialized) as {
      assets: Array<{ content: string }>;
    };
    tampered.assets[0]!.content = tampered.assets[0]!.content.replace(/A/u, "B");
    expect(() => parseTrustedComponentPackage(JSON.stringify(tampered))).toThrow(
      /integrity metadata/u,
    );
    expect(() => parseTrustedComponentPackage(serialized, { maxAssets: 1 })).toThrow(
      /maxAssets/u,
    );
    expect(() =>
      parseTrustedComponentPackage(serialized, { maxAssetBytes: 5 }),
    ).toThrow(/maxAssetBytes/u);
  });
});
