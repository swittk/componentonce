import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildTrustedReactPackage,
  serializeTrustedComponentPackage,
} from "../src/index.js";
import {
  instantiateTrustedComponentPackage as instantiateInBrowserRuntime,
  parseTrustedComponentPackage as parseInBrowserRuntime,
  prepareTrustedComponentPackageAssets,
} from "../../runtime/src/index.js";

function createFakeDocument(): {
  readonly document: Document;
  readonly styles: Array<{ textContent: string | null }>;
} {
  const styles: Array<{ textContent: string | null }> = [];
  const parent = {
    appendChild(node: { textContent: string | null }): void {
      styles.push(node);
    },
  };
  const document = {
    nodeType: 9,
    head: parent,
    documentElement: parent,
    createElement(): {
      textContent: string | null;
      setAttribute(): void;
      remove(): void;
    } {
      return {
        textContent: null,
        setAttribute(): void {},
        remove(): void {},
      };
    },
  } as unknown as Document;
  return { document, styles };
}

describe("compiler-to-browser-runtime asset roundtrip", () => {
  it("renders a resolved SVG import and mounts resolved CSS from one stored package", async () => {
    const componentPackage = await buildTrustedReactPackage({
      source: `
        import styles from "./card.module.css";
        import logoUrl from "./logo.svg";
        export const definition = {
          manifest: { id: "example/roundtrip-card", version: "1.0.0" },
          implementation({ props }: { props: { title: string } }) {
            return <article className={styles.card}><img src={logoUrl} alt="" />{props.title}</article>;
          },
        };
      `,
      sourceFileName: "roundtrip-card.tsx",
      resolveDir: fileURLToPath(
        new URL("./fixtures/collision-a", import.meta.url),
      ),
      externals: {
        react: React,
        "react/jsx-runtime": jsxRuntime,
      },
    });

    const parsed = parseInBrowserRuntime(
      serializeTrustedComponentPackage(componentPackage),
    );
    if (parsed.format !== "componentonce.trusted-package.v2") {
      throw new Error("Expected a v2 package.");
    }
    const prepared = await prepareTrustedComponentPackageAssets(parsed, {
      resolveAssetUrl: (asset) => "https://assets.example/" + asset.path,
    });
    const definition = await instantiateInBrowserRuntime(parsed, {
      externals: {
        react: React,
        "react/jsx-runtime": jsxRuntime,
      },
      preparedAssets: prepared,
    });
    const html = renderToStaticMarkup(
      React.createElement(
        definition.implementation as React.ComponentType<{
          readonly props: { readonly title: string };
        }>,
        { props: { title: "Roundtrip" } },
      ),
    );
    expect(html).toContain('src="https://assets.example/assets/');
    expect(html).toContain("Roundtrip");

    const fakeDocument = createFakeDocument();
    const styleMount = prepared.mountStyles(fakeDocument.document);
    expect(fakeDocument.styles).toHaveLength(1);
    expect(fakeDocument.styles[0]?.textContent).toContain(
      "https://assets.example/assets/",
    );
    styleMount.release();
    prepared.dispose();
  });
});
