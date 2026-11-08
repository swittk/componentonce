import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import {
  buildTrustedReactPackage,
  compileTrustedModule,
  compileTrustedReactModule,
  instantiateTrustedBundle,
  instantiateTrustedComponentPackage,
} from "../src/index.js";

async function withPackageFixture(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "componentonce-bundle-imports-"));
  try {
    const formatter = join(root, "node_modules", "@fixture", "formatter");
    const helper = join(root, "node_modules", "@fixture", "helper");
    await mkdir(formatter, { recursive: true });
    await mkdir(helper, { recursive: true });
    await writeFile(join(formatter, "package.json"), JSON.stringify({
      name: "@fixture/formatter", version: "1.0.0", type: "module",
      exports: { ".": "./format.js", "./format": "./format.js" },
    }));
    await writeFile(join(formatter, "format.js"),
      'import { wrap } from "@fixture/helper"; export const format = (value) => wrap(value);');
    await writeFile(join(helper, "package.json"), JSON.stringify({
      name: "@fixture/helper", version: "1.0.0", type: "module", exports: "./index.js",
    }));
    await writeFile(join(helper, "index.js"), 'export const wrap = (value) => "[" + value + "]";');
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

it("bundles scoped package subpaths and explicitly selected transitive dependencies", async () => {
  await withPackageFixture(async (root) => {
    const artifact = await compileTrustedModule({
      source: 'import { format } from "@fixture/formatter/format"; export const value = format("ok");',
      sourceFileName: "entry.ts", resolveDir: root,
      bundleModules: ["@fixture/formatter", "@fixture/helper"],
    });
    expect(artifact.externalModules).toEqual([]);
    expect(instantiateTrustedBundle<{ value: string }>(artifact, { externals: {} }).value).toBe("[ok]");

    await expect(compileTrustedModule({
      source: 'import { format } from "@fixture/formatter-extra"; export { format };',
      sourceFileName: "entry.ts", resolveDir: root,
      bundleModules: ["@fixture/formatter"],
    })).rejects.toThrow('Import "@fixture/formatter-extra" is neither');
  });
});

it("requires an explicit ownership choice for transitive bare imports", async () => {
  await withPackageFixture(async (root) => {
    await expect(compileTrustedModule({
      source: 'import { format } from "@fixture/formatter"; export { format };',
      sourceFileName: "entry.ts", resolveDir: root,
      bundleModules: ["@fixture/formatter"],
    })).rejects.toThrow('Import "@fixture/helper" is neither');
  });
});

it("forwards additionalBundleModules through React package building and keeps host React external", async () => {
  await withPackageFixture(async (root) => {
    const externals = { react: React, "react/jsx-runtime": jsxRuntime };
    const componentPackage = await buildTrustedReactPackage({
      source: `
        import * as React from "react";
        import { format } from "@fixture/formatter/format";
        export const definition = {
          manifest: { id: "example/bundled", version: "1.0.0" },
          implementation: () => <strong>{format(React.version)}</strong>,
        };
      `,
      sourceFileName: "entry.tsx", resolveDir: root, externals,
      additionalBundleModules: ["@fixture/formatter", "@fixture/helper"],
    });
    expect(componentPackage.bundle.externalModules).toEqual(["react", "react/jsx-runtime"]);
    const definition = instantiateTrustedComponentPackage(componentPackage, { externals });
    const html = renderToStaticMarkup(React.createElement(definition.implementation as React.ComponentType));
    expect(html).toBe("<strong>[" + React.version + "]</strong>");
  });
});

it.each(["react", "react/jsx-runtime", "react/jsx-dev-runtime"])(
  "rejects bundling the host-owned React module %s", async (specifier) => {
    await expect(compileTrustedReactModule({
      source: "export const value = 1;", sourceFileName: "entry.ts",
      additionalBundleModules: [specifier],
    })).rejects.toThrow("cannot be both bundled and external");
  },
);

it("rejects a bundled package that contains an explicitly external subpath", async () => {
  await expect(compileTrustedModule({
    source: "export const value = 1;", sourceFileName: "entry.ts",
    bundleModules: ["@fixture/formatter"],
    externalModules: ["@fixture/formatter/format"],
  })).rejects.toThrow("cannot be both bundled and external");
});


it.each([
  { fields: { main: "./common.cjs" }, expected: "common" },
  { fields: { main: "./common.cjs", module: "./module.js" }, expected: "module" },
])("resolves package main fields consistently: $fields", async ({ fields, expected }) => {
  await withPackageFixture(async (root) => {
    const helper = join(root, "node_modules", "@fixture", "helper");
    await writeFile(join(helper, "package.json"), JSON.stringify({
      name: "@fixture/helper", version: "1.0.0", type: "module", ...fields,
    }));
    await rm(join(helper, "index.js"));
    await writeFile(join(helper, "common.cjs"), 'exports.value = "common";');
    await writeFile(join(helper, "module.js"), 'export const value = "module";');
    const artifact = await compileTrustedModule({
      source: 'export { value } from "@fixture/helper";',
      sourceFileName: "entry.ts", resolveDir: root, bundleModules: ["@fixture/helper"],
    });
    expect(instantiateTrustedBundle<{ value: string }>(artifact, { externals: {} }).value).toBe(expected);
  });
});

it.each(["card.module.css", "card"])("namespaces bundled CSS subpath %s by content and portable dependency paths", async (subpath) => {
  const compile = async (color: string) => {
    let className = "";
    await withPackageFixture(async (root) => {
      const helper = join(root, "node_modules", "@fixture", "helper");
      await writeFile(join(helper, "package.json"), JSON.stringify({
        name: "@fixture/helper", version: color === "red" ? "1.0.0" : "2.0.0",
        exports: { "./card.module.css": "./card.module.css", "./card": "./card.module.css" },
      }));
      await writeFile(join(helper, "card.module.css"), ".root { color: " + color + "; }");
      const artifact = await compileTrustedModule({
        source: 'import styles from "@fixture/helper/' + subpath + '"; export { styles };',
        sourceFileName: "entry.ts", resolveDir: root, bundleModules: ["@fixture/helper"],
      });
      className = instantiateTrustedBundle<{ styles: { root: string } }>(artifact, { externals: {} }).styles.root;
      const css = Buffer.from(artifact.assets!.find((asset) => asset.path === "component.css")!.content, "base64").toString("utf8");
      expect(css).toContain("." + className);
    });
    return className;
  };
  const first = await compile("red");
  expect(await compile("blue")).not.toBe(first);
  expect(await compile("red")).toBe(first);
});

it.each(["css", "module.css"])("resolves selected CSS package imports from %s while keeping local references", async (extension) => {
  await withPackageFixture(async (root) => {
    const helper = join(root, "node_modules", "@fixture", "helper");
    await writeFile(join(helper, "package.json"), JSON.stringify({
      name: "@fixture/helper", version: "1.0.0",
      exports: { "./theme.css": "./theme.css", "./base.module.css": "./base.module.css" },
    }));
    await writeFile(join(helper, "theme.css"), ".package-theme { color: green; }");
    await writeFile(join(helper, "base.module.css"), ".base { color: blue; }");
    await writeFile(join(root, "local.css"), ".local-rule { color: red; }");
    await writeFile(join(root, "image.svg"), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    await writeFile(join(root, "styles." + extension), [
      '@import "@fixture/helper/theme.css";',
      '@import "local.css";',
      '.root {',
      extension === "module.css" ? 'composes: base from "@fixture/helper/base.module.css";' : "",
      'background: url("image.svg?variant=small#icon");',
      '}',
    ].join("\n"));
    const artifact = await compileTrustedModule({
      source: 'import "./styles.' + extension + '"; export const value = 1;',
      sourceFileName: "entry.ts", resolveDir: root, bundleModules: ["@fixture/helper"],
    });
    const css = Buffer.from(artifact.assets!.find((asset) => asset.path === "component.css")!.content, "base64").toString("utf8");
    expect(css).toContain("package-theme");
    expect(css).toContain("local-rule");
    expect(css).toContain("?variant=small#icon");
    if (extension === "module.css") expect(css).toContain("color: blue");
  });
});

it.each(["C:/workspace/helper.js", "C:\\workspace\\helper.js", "\\\\server\\share\\helper.js", "\\workspace\\helper.js"])(
  "rejects Windows filesystem bundle selections: %s", async (specifier) => {
    await expect(compileTrustedModule({
      source: "export const value = 1;", sourceFileName: "entry.ts", bundleModules: [specifier],
    })).rejects.toThrow("Invalid bundled module specifier");
  },
);
