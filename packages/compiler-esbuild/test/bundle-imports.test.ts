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
