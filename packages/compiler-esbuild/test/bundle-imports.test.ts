import { mkdir, mkdtemp, rename, rm, symlink, writeFile } from "node:fs/promises";
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

it.each(["static", "dynamic"])("requires an explicit ownership choice for %s transitive bare imports", async (kind) => {
  await withPackageFixture(async (root) => {
    if (kind === "dynamic") {
      await writeFile(join(root, "node_modules", "@fixture", "formatter", "format.js"),
        'export const format = () => import("@fixture/helper");');
    }
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
    await writeFile(join(root, "node_modules", "@fixture", "formatter", "format.js"), `
      import * as React from "react";
      import { jsx } from "react/jsx-runtime";
      import { wrap } from "@fixture/helper";
      export const format = (value) => wrap(value);
      export const hostReact = React;
      export const hostJsx = jsx;
    `);
    const componentPackage = await buildTrustedReactPackage({
      source: `
        import * as React from "react";
        import { jsx } from "react/jsx-runtime";
        import { format, hostReact, hostJsx } from "@fixture/formatter/format";
        if (hostReact.createElement !== React.createElement || hostReact.useState !== React.useState || hostJsx !== jsx) throw new Error("Duplicate host runtime");
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

it.each(["card.module.css", "card", "card.skin", "skin", "relative.skin", "composed.skin", "extensionless"])("namespaces bundled CSS subpath %s by content and portable dependency paths", async (subpath) => {
  const compile = async (color: string) => {
    let className = "";
    await withPackageFixture(async (root) => {
      const helper = join(root, "node_modules", "@fixture", "helper");
      await writeFile(join(helper, "package.json"), JSON.stringify({
        name: "@fixture/helper", version: color === "red" ? "1.0.0" : "2.0.0",
        exports: {
          "./card.module.css": "./card.module.css", "./card": "./card.module.css",
          "./card.skin": "./card.skin", "./skin": "./card.skin",
          "./relative.skin": "./relative.js", "./composed.skin": "./composed.skin",
          "./extensionless": "./extensionless.js",
        },
      }));
      const stylesheet = subpath.includes("skin") ? "card.skin" : "card.module.css";
      await writeFile(join(helper, stylesheet), ".root { color: " + color + "; }");
      await writeFile(join(helper, "relative.js"), 'export { default } from "./card.skin";');
      await writeFile(join(helper, "extensionless.js"), 'export { default } from "./card.module";');
      await writeFile(join(helper, "composed.skin"), '.root { composes: root from "./card.skin"; }');
      const artifact = await compileTrustedModule({
        source: 'import styles from "@fixture/helper/' + subpath + '"; export { styles };',
        sourceFileName: "entry.ts", resolveDir: root, bundleModules: ["@fixture/helper"],
        ...(stylesheet.endsWith(".skin") ? { loaders: { ".skin": "local-css" as const } } : {}),
      });
      className = instantiateTrustedBundle<{ styles: { root: string } }>(artifact, { externals: {} }).styles.root;
      const css = Buffer.from(artifact.assets!.find((asset) => asset.path === "component.css")!.content, "base64").toString("utf8");
      for (const token of className.split(" ")) expect(css).toContain("." + token);
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
      source: extension === "module.css"
        ? 'import styles from "./styles.module.css"; export { styles };'
        : 'import "./styles.css"; export const value = 1;',
      sourceFileName: "entry.ts", resolveDir: root, bundleModules: ["@fixture/helper"],
    });
    const css = Buffer.from(artifact.assets!.find((asset) => asset.path === "component.css")!.content, "base64").toString("utf8");
    expect(css).toContain("package-theme");
    expect(css).toContain("local-rule");
    expect(css).toContain("?variant=small#icon");
    if (extension === "module.css") {
      expect(css).toContain("color: blue");
      const { styles } = instantiateTrustedBundle<{ styles: { root: string } }>(artifact, { externals: {} });
      const baseClass = /\.([\w-]+)\s*\{\s*color: blue;/u.exec(css)?.[1];
      expect(baseClass).toBeDefined();
      expect(styles.root.split(" ")).toContain(baseClass);
    }
  });
});

it.each(["C:/workspace/helper.js", "C:\\workspace\\helper.js", "\\\\server\\share\\helper.js", "\\workspace\\helper.js"])(
  "rejects Windows filesystem bundle selections: %s", async (specifier) => {
    await expect(compileTrustedModule({
      source: "export const value = 1;", sourceFileName: "entry.ts", bundleModules: [specifier],
    })).rejects.toThrow("Invalid bundled module specifier");
  },
);


it("initializes bundled dependencies without a browser process global", async () => {
  await withPackageFixture(async (root) => {
    const helper = join(root, "node_modules", "@fixture", "helper");
    await writeFile(join(helper, "index.js"), `
      export const environment = process.env.NODE_ENV;
      export const value = process.env.NODE_ENV === "production" ? "release" : "debug";
    `);
    const artifact = await compileTrustedModule({
      source: 'export { environment, value } from "@fixture/helper";',
      sourceFileName: "entry.ts", resolveDir: root, bundleModules: ["@fixture/helper"],
    });
    // Shadow Node's global so this exercises the browser's lack of a process object.
    const exports = {};
    const module = { exports };
    new Function("module", "exports", "process", artifact.code)(module, exports, undefined);
    expect(module.exports).toMatchObject({ environment: "production", value: "release" });
  });
});

it.each(["entry", "bundled package"])("loads dynamic host imports from the injected map in %s", async (importer) => {
  await withPackageFixture(async (root) => {
    const helper = join(root, "node_modules", "@fixture", "helper");
    const source = `
      export const load = () => import("host-sdk");
      export const loadLocal = () => import("./local.js");
    `;
    await writeFile(join(importer === "entry" ? root : helper, "local.js"), 'export const value = "local";');
    if (importer === "bundled package") await writeFile(join(helper, "index.js"), source);
    const artifact = await compileTrustedModule({
      source: importer === "entry" ? source : 'export { load, loadLocal } from "@fixture/helper";',
      sourceFileName: "entry.ts", resolveDir: root, bundleModules: ["@fixture/helper"],
      externalModules: ["host-sdk"],
    });
    const marker = {};
    const host = { value: marker };
    type LoadedModule = {
      load(): Promise<{ value: unknown; default: unknown }>;
      loadLocal(): Promise<{ value: string }>;
    };
    const instance = instantiateTrustedBundle<LoadedModule>(artifact, { externals: { "host-sdk": host } });
    expect(artifact.externalModules).toEqual(["host-sdk"]);
    const pending = instance.load();
    expect(pending).toBeInstanceOf(Promise);
    const loaded = await pending;
    expect(loaded.value).toBe(marker);
    expect(loaded.default).toBe(host);
    expect((await instance.loadLocal()).value).toBe("local");
    const missing = instantiateTrustedBundle<LoadedModule>(artifact, { externals: {} });
    await expect(missing.load()).rejects.toThrow('Missing trusted bundle external "host-sdk"');
  });
});

it.each([
  ["package", "entry.ts"],
  ["relative-first", "entry.ts"],
  ["package", "./entry.ts"],
  ["relative-first", "./entry.ts"],
  ["package", "nested/../entry.ts"],
  ["relative-first", "nested/../entry.ts"],
])("retains linked package behavior, CSS classes, and file assets across target locations (%s, %s)", async (order, sourceFileName) => {
  const compile = async (targetDirectory: string) => {
    let result: unknown;
    await withPackageFixture(async (root) => {
      const helper = join(root, "node_modules", "@fixture", "helper");
      await writeFile(join(helper, "index.js"), 'import styles from "./card.module.css"; import { label } from "./label.js"; export { styles }; export const value = label + styles.root;');
      await writeFile(join(helper, "label.js"), 'export const label = "linked:";');
      await writeFile(join(helper, "card.module.css"), '.root { color: blue; }');
      await writeFile(join(helper, "package.json"), JSON.stringify({
        name: "@fixture/helper", version: "1.0.0", type: "module",
        exports: { ".": "./index.js", "./theme.css": "./theme.css" },
      }));
      await writeFile(join(helper, "theme.css"), '.theme { background: url("./image.svg"); }');
      await writeFile(join(helper, "image.svg"), '<svg xmlns="http://www.w3.org/2000/svg"/>');
      const target = join(root, targetDirectory, "helper");
      await mkdir(join(root, targetDirectory), { recursive: true });
      await rename(helper, target);
      await symlink(target, helper, "dir");
      await symlink(target, join(root, "shared"), "dir");
      const artifact = await compileTrustedModule({
        source: (order === "relative-first" ? 'export { value as sharedValue } from "./shared/index.js";' : "") +
          'import "@fixture/helper/theme.css"; export { styles, value } from "@fixture/helper";',
        sourceFileName, resolveDir: root, bundleModules: ["@fixture/helper"],
      });
      const { styles, value, sharedValue } = instantiateTrustedBundle<{
        styles: { root: string }; value: string; sharedValue?: string;
      }>(artifact, { externals: {} });
      const css = artifact.assets.find((asset) => asset.path === "component.css")!;
      const cssText = Buffer.from(css.content, "base64").toString("utf8");
      expect(cssText).toContain("." + styles.root);
      expect(cssText).toContain("color: blue");
      expect(cssText).toContain(".theme");
      expect(cssText).toContain("componentonce-asset:");
      expect(value).toBe("linked:" + styles.root);
      if (order === "relative-first") expect(sharedValue).toBe(value);
      result = {
        className: styles.root,
        assets: artifact.assets.filter((asset) => !artifact.stylesheets.includes(asset.path)),
      };
    });
    return result;
  };
  expect(await compile("store-a")).toEqual(await compile("different-store/nested"));
});


it("keeps linked package transitive resolution and package-type default imports", async () => {
  await withPackageFixture(async (root) => {
    const formatter = join(root, "node_modules", "@fixture", "formatter");
    const helper = join(root, "node_modules", "@fixture", "helper");
    const store = join(root, "isolated-store", "node_modules", "@fixture");
    await mkdir(store, { recursive: true });
    await writeFile(join(formatter, "format.js"), `
      import host from "host-sdk";
      import { wrap } from "@fixture/helper";
      export const value = wrap(host.value);
    `);
    await rename(formatter, join(store, "formatter"));
    await rename(helper, join(store, "helper"));
    await symlink(join(store, "formatter"), formatter, "dir");
    const artifact = await compileTrustedModule({
      source: 'export { value } from "@fixture/formatter";',
      sourceFileName: "entry.ts", resolveDir: root,
      bundleModules: ["@fixture/formatter", "@fixture/helper"], externalModules: ["host-sdk"],
    });
    const host = { __esModule: true, value: "host", default: { value: "wrong interop" } };
    expect(instantiateTrustedBundle<{ value: string }>(artifact, {
      externals: { "host-sdk": host },
    }).value).toBe("[host]");
  });
});


it("preserves linked package tsconfig JSX and class-field transforms", async () => {
  await withPackageFixture(async (root) => {
    const helper = join(root, "node_modules", "@fixture", "helper");
    const workspacePackage = join(root, "workspace", "helper");
    await writeFile(join(helper, "package.json"), JSON.stringify({
      name: "@fixture/helper", version: "1.0.0", type: "module", exports: "./index.tsx",
    }));
    await writeFile(join(helper, "tsconfig.json"), JSON.stringify({
      compilerOptions: { jsxFactory: "h", useDefineForClassFields: false },
    }));
    await writeFile(join(helper, "index.tsx"), `
      const h = (tag, props) => ({ tag, props });
      class Base { set value(value) { this.assigned = value; } }
      class Derived extends Base { value = "assigned"; }
      export const element = <strong label="custom factory" />;
      export const assigned = new Derived().assigned;
      export { child } from "./nested/child";
    `);
    await mkdir(join(helper, "nested"));
    await writeFile(join(helper, "nested", "tsconfig.json"), JSON.stringify({
      extends: "../tsconfig.json",
      compilerOptions: { jsxFactory: "other", useDefineForClassFields: true },
    }));
    await writeFile(join(helper, "nested", "child.tsx"), `
      const other = (tag) => ({ tag });
      class Base { set value(value) { this.assigned = value; } }
      class Derived extends Base { value = "defined"; }
      export const child = { element: <em />, assigned: new Derived().assigned };
    `);
    await mkdir(join(root, "workspace"), { recursive: true });
    await rename(helper, workspacePackage);
    await symlink(workspacePackage, helper, "dir");
    const artifact = await compileTrustedModule({
      source: 'export { element, assigned, child } from "@fixture/helper";',
      sourceFileName: "entry.ts", resolveDir: root, bundleModules: ["@fixture/helper"],
    });
    const loaded = instantiateTrustedBundle<{
      element: { tag: string; props: { label: string } }; assigned: string;
      child: { element: { tag: string }; assigned: undefined };
    }>(artifact, { externals: {} });
    expect(loaded.element).toEqual({ tag: "strong", props: { label: "custom factory" } });
    expect(loaded.assigned).toBe("assigned");
    expect(loaded.child).toEqual({ element: { tag: "em" }, assigned: undefined });
    const encodedMap = /sourceMappingURL=data:application\/json;base64,([A-Za-z0-9+/=]+)/u.exec(artifact.code)![1]!;
    const sourceMap = JSON.parse(Buffer.from(encodedMap, "base64").toString("utf8")) as { sources: string[]; sourcesContent: string[] };
    expect(sourceMap.sources.some((source) => source.includes("index.tsx"))).toBe(true);
    expect(sourceMap.sources.some((source) => source.includes("child.tsx"))).toBe(true);
    expect(sourceMap.sourcesContent.some((source) => source.includes('<strong label="custom factory" />'))).toBe(true);
  });
});


it.each(["entry", "bundled package"])("preserves conditional exports for dynamic imports from %s", async (importer) => {
  await withPackageFixture(async (root) => {
    const conditional = join(root, "node_modules", "@fixture", "conditional");
    await mkdir(conditional, { recursive: true });
    await writeFile(join(conditional, "package.json"), JSON.stringify({
      name: "@fixture/conditional", version: "1.0.0", type: "module",
      exports: { import: "./import.js", require: "./require.cjs" },
    }));
    await writeFile(join(conditional, "import.js"), 'export const value = "import branch";');
    await writeFile(join(conditional, "require.cjs"), 'exports.value = "require branch";');
    const source = `
      export const load = () => import("@fixture/conditional");
      export const loadRequired = () => require("@fixture/conditional");
    `;
    if (importer === "bundled package") {
      await writeFile(join(root, "node_modules", "@fixture", "helper", "index.js"), source);
    }
    const artifact = await compileTrustedModule({
      source: importer === "entry" ? source : 'export { load, loadRequired } from "@fixture/helper";',
      sourceFileName: "entry.ts", resolveDir: root,
      bundleModules: ["@fixture/helper", "@fixture/conditional"],
    });
    const loaded = instantiateTrustedBundle<{
      load(): Promise<{ value: string }>;
      loadRequired(): { value: string };
    }>(artifact, { externals: {} });
    expect(artifact.externalModules).toEqual([]);
    expect((await loaded.load()).value).toBe("import branch");
    expect(loaded.loadRequired().value).toBe("require branch");
  });
});


it.each(["Shape", "Shape as PublicShape"])("preserves erased TypeScript re-exports in bundled sources: %s", async (typeExport) => {
  await withPackageFixture(async (root) => {
    const helper = join(root, "node_modules", "@fixture", "helper");
    await writeFile(join(helper, "package.json"), JSON.stringify({
      name: "@fixture/helper", version: "1.0.0", type: "module", exports: "./index.ts",
    }));
    await writeFile(join(helper, "models.ts"), `
      export interface Shape { label: string }
      export const value = "runtime value";
    `);
    await writeFile(join(helper, "index.ts"), 'export { ' + typeExport + ', value } from "./models";');
    const artifact = await compileTrustedModule({
      source: 'export * from "@fixture/helper";',
      sourceFileName: "entry.ts", resolveDir: root, bundleModules: ["@fixture/helper"],
    });
    const loaded = instantiateTrustedBundle<{ value: string }>(artifact, { externals: {} });
    expect(loaded.value).toBe("runtime value");
    expect(Object.keys(loaded)).toEqual(["value"]);
  });
});

it.each(["entry", "bundled package"])("loads nonliteral dynamic imports from the host map in %s", async (importer) => {
  await withPackageFixture(async (root) => {
    const source = "export const load = (specifier) => import(specifier);";
    if (importer === "bundled package") {
      await writeFile(join(root, "node_modules", "@fixture", "helper", "index.js"), source);
    }
    const artifact = await compileTrustedModule({
      source: importer === "entry" ? source : 'export { load } from "@fixture/helper";',
      sourceFileName: "entry.ts",
      resolveDir: root,
      bundleModules: ["@fixture/helper"],
      externalModules: ["host-sdk"],
    });
    const marker = {};
    const loaded = instantiateTrustedBundle<{
      load(specifier: string): Promise<{ value: unknown }>;
    }>(artifact, { externals: { "host-sdk": { value: marker } } });
    const pending = loaded.load("host-sdk");
    expect(pending).toBeInstanceOf(Promise);
    expect((await pending).value).toBe(marker);
  });
});

it.each(["entry", "bundled package"])("keeps a captured dynamic import name stable after selection changes in %s", async (importer) => {
  await withPackageFixture(async (root) => {
    const source = `
      export const events = [];
      export function load() {
        let selected = "host-first";
        const specifier = (events.push("selected"), selected);
        const pending = import(specifier);
        selected = "host-second";
        return pending;
      }
    `;
    if (importer === "bundled package") {
      await writeFile(join(root, "node_modules", "@fixture", "helper", "index.js"), source);
    }
    const artifact = await compileTrustedModule({
      source: importer === "entry" ? source : 'export { events, load } from "@fixture/helper";',
      sourceFileName: "entry.ts", resolveDir: root,
      bundleModules: ["@fixture/helper"],
      externalModules: ["host-first", "host-second"],
    });
    const loaded = instantiateTrustedBundle<{
      events: string[];
      load(): Promise<{ value: string }>;
    }>(artifact, {
      externals: {
        "host-first": { value: "first" },
        "host-second": { value: "second" },
      },
    });
    const pending = loaded.load();
    expect(loaded.events).toEqual(["selected"]);
    expect(pending).toBeInstanceOf(Promise);
    expect((await pending).value).toBe("first");
  });
});

it("preserves bundled dynamic import expressions that esbuild can resolve", async () => {
  await withPackageFixture(async (root) => {
    await writeFile(join(root, "first.js"), 'export const value = "first";');
    await writeFile(join(root, "second.js"), 'export const value = "second";');
    const artifact = await compileTrustedModule({
      source: 'export const load = (first) => first ? import("./first.js") : import("./second.js");',
      sourceFileName: "entry.ts",
      resolveDir: root,
    });
    const loaded = instantiateTrustedBundle<{ load(first: boolean): Promise<{ value: string }> }>(artifact, { externals: {} });
    expect((await loaded.load(true)).value).toBe("first");
    expect((await loaded.load(false)).value).toBe("second");
  });
});

it.each([
  ["react-private", "react-private/jsx-runtime"],
  ["react?copy", "react/jsx-runtime?copy"],
  ["react#copy", "react/jsx-runtime#copy"],
])("renders React alias %s supplied through the host external map", async (reactSpecifier, jsxSpecifier) => {
  const artifact = await compileTrustedReactModule({
    source: `
      import { useState } from ${JSON.stringify(reactSpecifier)};
      import { jsx } from ${JSON.stringify(jsxSpecifier)};
      export const hook = useState;
      export const View = () => {
        const [value] = useState("alias rendered");
        return jsx("strong", { children: value });
      };
    `,
    sourceFileName: "entry.ts",
    additionalExternalModules: [reactSpecifier, jsxSpecifier],
  });
  const loaded = instantiateTrustedBundle<{
    hook: typeof React.useState;
    View: React.ComponentType;
  }>(artifact, {
    externals: {
      [reactSpecifier]: React,
      [jsxSpecifier]: jsxRuntime,
    },
  });
  expect(artifact.externalModules).toEqual([reactSpecifier, jsxSpecifier].sort());
  expect(loaded.hook).toBe(React.useState);
  expect(renderToStaticMarkup(React.createElement(loaded.View)))
    .toBe("<strong>alias rendered</strong>");
});

it.each([
  ["store-a", 'import("./locales/" + name + ".js")'],
  ["other-store/nested", 'import(`./locales/${name}.js`)'],
  ["store-a", 'require("./locales/" + name + ".js")'],
])("shares static and glob module instances in a linked package (%s, %s)", async (targetDirectory, expression) => {
  await withPackageFixture(async (root) => {
    const helper = join(root, "node_modules", "@fixture", "helper");
    await writeFile(join(helper, "index.js"), `
      import { state } from "./locales/en.js";
      export const direct = state;
      export const load = (name) => ${expression};
    `);
    await mkdir(join(helper, "locales"));
    for (const locale of ["en", "th"]) {
      await writeFile(join(helper, "locales", locale + ".js"),
        "export const state = { label: " + JSON.stringify(locale) + " };");
    }
    const target = join(root, targetDirectory, "helper");
    await mkdir(join(root, targetDirectory), { recursive: true });
    await rename(helper, target);
    await symlink(target, helper, "dir");
    const artifact = await compileTrustedModule({
      source: 'export { direct, load } from "@fixture/helper";',
      sourceFileName: "entry.ts",
      resolveDir: root,
      bundleModules: ["@fixture/helper"],
    });
    type State = { label: string };
    const loaded = instantiateTrustedBundle<{
      direct: State;
      load(name: string): { state: State } | Promise<{ state: State }>;
    }>(artifact, { externals: {} });
    expect(artifact.externalModules).toEqual([]);
    expect((await loaded.load("en")).state).toBe(loaded.direct);
    expect((await loaded.load("en")).state.label).toBe("en");
    expect((await loaded.load("th")).state.label).toBe("th");
    expect((await loaded.load("th")).state).toBe((await loaded.load("th")).state);
  });
});

it("resolves unhoisted dependencies and package-type interop inside linked glob imports", async () => {
  await withPackageFixture(async (root) => {
    const formatter = join(root, "node_modules", "@fixture", "formatter");
    const helper = join(root, "node_modules", "@fixture", "helper");
    const store = join(root, "isolated-store", "node_modules", "@fixture");
    await mkdir(store, { recursive: true });
    await mkdir(join(formatter, "locales"));
    await writeFile(join(formatter, "format.js"),
      'export const load = (name) => import("./locales/" + name + ".js");');
    await writeFile(join(formatter, "locales", "en.js"), `
      import host from "host-sdk";
      import { wrap } from "@fixture/helper";
      export const value = wrap(host.value);
    `);
    await rename(formatter, join(store, "formatter"));
    await rename(helper, join(store, "helper"));
    await symlink(join(store, "formatter"), formatter, "dir");
    const artifact = await compileTrustedModule({
      source: 'export { load } from "@fixture/formatter";',
      sourceFileName: "entry.ts", resolveDir: root,
      bundleModules: ["@fixture/formatter", "@fixture/helper"], externalModules: ["host-sdk"],
    });
    const host = { __esModule: true, value: "host", default: { value: "wrong interop" } };
    const loaded = instantiateTrustedBundle<{
      load(name: string): Promise<{ value: string }>;
    }>(artifact, { externals: { "host-sdk": host } });
    expect((await loaded.load("en")).value).toBe("[host]");
  });
});

it("shares CSS imports across glob modules and includes glob-only content in CSS isolation", async () => {
  await withPackageFixture(async (root) => {
    const helper = join(root, "node_modules", "@fixture", "helper");
    await mkdir(join(helper, "locales"));
    await writeFile(join(helper, "index.js"), `
      import styles from "./card.module.css";
      export { styles };
      export const load = (name) => import("./locales/" + name + ".js");
    `);
    await writeFile(join(helper, "card.module.css"), ".root { color: red; }");
    const compile = async (label: string) => {
      await writeFile(join(helper, "locales", "en.js"), `
        import styles from "../card.module.css";
        export { styles };
        export const label = ${JSON.stringify(label)};
      `);
      const artifact = await compileTrustedModule({
        source: 'export { styles, load } from "@fixture/helper";',
        sourceFileName: "entry.ts", resolveDir: root,
        bundleModules: ["@fixture/helper"],
      });
      const loaded = instantiateTrustedBundle<{
        styles: { root: string };
        load(name: string): Promise<{ styles: { root: string }; label: string }>;
      }>(artifact, { externals: {} });
      const locale = await loaded.load("en");
      expect(locale.styles).toBe(loaded.styles);
      expect(locale.label).toBe(label);
      const css = Buffer.from(artifact.assets.find((asset) => asset.path === "component.css")!.content, "base64").toString("utf8");
      expect(css).toContain("." + loaded.styles.root);
      expect(css).toContain("color: red");
      return loaded.styles.root;
    };
    expect(await compile("first")).not.toBe(await compile("second"));
  });
});

it.each([".module.css", ".skin.css"])("isolates direct CSS globs and shares static exports for %s", async (extension) => {
  await withPackageFixture(async (root) => {
    const helper = join(root, "node_modules", "@fixture", "helper");
    await mkdir(join(helper, "styles"));
    await writeFile(join(helper, "styles", "base.module.css"), ".base { display: block; }");
    await writeFile(join(helper, "styles", "image.svg"), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    await writeFile(join(helper, "index.js"), [
      'import styles from "./styles/card' + extension + '";',
      'export { styles };',
      'export const load = (name) => import("./styles/" + name + "' + extension + '");',
      'export const requireStyle = (name) => require("./styles/" + name + "' + extension + '");',
    ].join("\n"));
    const compile = async (color: string) => {
      await writeFile(join(helper, "styles", "card" + extension),
        '.root { composes: base from "./base.module.css"; color: ' + color + '; background: url("./image.svg"); }');
      // Only reachable through the glob, so isolation must not rely on a static import.
      await writeFile(join(helper, "styles", "other" + extension), ".root { color: " + color + "; }");
      const artifact = await compileTrustedModule({
        source: 'export { styles, load, requireStyle } from "@fixture/helper";',
        sourceFileName: "entry.ts", resolveDir: root, bundleModules: ["@fixture/helper"],
        loaders: { [extension]: "local-css" },
      });
      type Styles = { root: string };
      const loaded = instantiateTrustedBundle<{
        styles: Styles;
        load(name: string): Promise<{ default: Styles; root: string }>;
        requireStyle(name: string): Styles;
      }>(artifact, { externals: {} });
      const card = await loaded.load("card");
      expect(card.default).toBe(loaded.styles);
      expect(card.root).toBe(loaded.styles.root);
      expect(loaded.requireStyle("card")).toBe(loaded.styles);
      const other = await loaded.load("other");
      expect(other.default).toBe(loaded.requireStyle("other"));
      expect(other.root).toBe(other.default.root);
      expect(other.root).not.toBe(card.root);
      const css = Buffer.from(artifact.assets.find((asset) => asset.path === "component.css")!.content, "base64").toString("utf8");
      for (const className of [...card.root.split(" "), other.root]) {
        expect(css).toContain("." + className);
      }
      expect(css).toContain("display: block");
      expect(css).toContain("color: " + color);
      expect(css).toContain("componentonce-asset:/");
      expect(artifact.assets.some((asset) => asset.path.endsWith(".svg"))).toBe(true);
      return { card: card.root, other: other.root };
    };
    const first = await compile("red");
    const second = await compile("blue");
    expect(first.card).not.toBe(second.card);
    expect(first.other).not.toBe(second.other);
  });
});

it("names the React import-ownership options in undeclared import diagnostics", async () => {
  await expect(compileTrustedReactModule({
    source: 'export { value } from "not-selected";',
    sourceFileName: "entry.ts",
  })).rejects.toThrow(/additionalBundleModules.*additionalExternalModules/u);
});

it.each([".js", ".worker.js"])("preserves bundled worker asset extensions with the %s file loader", async (extension) => {
  await withPackageFixture(async (root) => {
    const helper = join(root, "node_modules", "@fixture", "helper");
    const workerSource = 'self.onmessage = () => self.postMessage("ready");';
    await writeFile(join(helper, "package.json"), JSON.stringify({
      name: "@fixture/helper", type: "module", exports: "./index.mjs",
    }));
    await writeFile(join(helper, "index.mjs"),
      'export { default as workerUrl } from "./background.worker.js";');
    await writeFile(join(helper, "background.worker.js"), workerSource);
    const artifact = await compileTrustedModule({
      source: 'export { workerUrl } from "@fixture/helper";',
      sourceFileName: "entry.ts", resolveDir: root,
      bundleModules: ["@fixture/helper"],
      loaders: { [extension]: "file" },
      contentTypes: { ".js": "text/javascript" },
    });
    const { workerUrl } = instantiateTrustedBundle<{ workerUrl: string }>(artifact, { externals: {} });
    const asset = artifact.assets.find((candidate) => "componentonce-asset:/" + candidate.path === workerUrl)!;
    expect(asset).toBeDefined();
    expect(asset.path).toMatch(/\.js$/u);
    expect(asset.contentType).toBe("text/javascript");
    expect(Buffer.from(asset.content, "base64").toString("utf8")).toBe(workerSource);
  });
});

it.each(process.platform === "win32"
  ? ["implementation#v1.js"]
  : ["implementation#v1.js", "implementation?v1.js"]
)("hashes the native dependency file %s", async (fileName) => {
  await withPackageFixture(async (root) => {
    const helper = join(root, "node_modules", "@fixture", "helper");
    await writeFile(join(helper, "index.js"),
      'export { value } from ' + JSON.stringify("./" + fileName) +
      '; import styles from "./card.module.css"; export { styles };');
    await writeFile(join(helper, "card.module.css"), ".root { color: red; }");
    const compile = async (value: string) => {
      await writeFile(join(helper, fileName), 'export const value = ' + JSON.stringify(value) + ';');
      const artifact = await compileTrustedModule({
        source: 'export { value, styles } from "@fixture/helper";',
        sourceFileName: "entry.ts", resolveDir: root, bundleModules: ["@fixture/helper"],
      });
      const loaded = instantiateTrustedBundle<{ value: string; styles: { root: string } }>(artifact, { externals: {} });
      expect(loaded.value).toBe(value);
      const css = Buffer.from(artifact.assets.find((asset) => asset.path === "component.css")!.content, "base64").toString("utf8");
      expect(css).toContain("." + loaded.styles.root);
      return loaded.styles.root;
    };
    expect(await compile("first")).not.toBe(await compile("changed"));
  });
});

it.each(["?variant=small", "#theme"])("bundles selected CSS subpaths with the %s suffix", async (suffix) => {
  await withPackageFixture(async (root) => {
    const helper = join(root, "node_modules", "@fixture", "helper");
    await writeFile(join(helper, "package.json"), JSON.stringify({
      name: "@fixture/helper", type: "module", exports: { "./styles.module.css": "./styles.module.css" },
    }));
    await writeFile(join(helper, "styles.module.css"), ".root { color: red; }");
    const specifier = "@fixture/helper/styles.module.css" + suffix;
    const input = {
      source: 'import styles from ' + JSON.stringify(specifier) + '; export { styles };',
      sourceFileName: "entry.ts", resolveDir: root,
      bundleModules: ["@fixture/helper/styles.module.css"],
    };
    const artifact = await compileTrustedModule(input);
    const loaded = instantiateTrustedBundle<{ styles: { root: string } }>(artifact, { externals: {} });
    const css = Buffer.from(artifact.assets.find((asset) => asset.path === "component.css")!.content, "base64").toString("utf8");
    expect(css).toContain("." + loaded.styles.root);
    expect(css).toContain("color: red");
    expect(Object.keys(artifact.metafile.inputs).some((path) => path.endsWith(suffix))).toBe(true);
    expect(artifact.externalModules).toEqual([]);

    const external = await compileTrustedModule({ ...input, externalModules: [specifier] });
    const styles = { root: "host-owned" };
    expect(external.externalModules).toEqual([specifier]);
    expect(instantiateTrustedBundle<{ styles: object }>(external, { externals: { [specifier]: styles } }).styles).toBe(styles);
  });
});

it("bundles package-private CSS imports and compositions while retaining URL fragments", async () => {
  await withPackageFixture(async (root) => {
    const helper = join(root, "node_modules", "@fixture", "helper");
    await writeFile(join(helper, "package.json"), JSON.stringify({
      name: "@fixture/helper", type: "module", exports: "./index.js",
      imports: { "#theme": "./theme.css", "#base": "./base.module.css" },
    }));
    await writeFile(join(helper, "index.js"),
      'import "./global.css"; import styles from "./card.module.css"; export { styles };');
    await writeFile(join(helper, "global.css"), '@import "#theme"; .global { display: block; }');
    await writeFile(join(helper, "theme.css"), ".theme { color: red; }");
    await writeFile(join(helper, "base.module.css"), ".base { font-weight: bold; }");
    await writeFile(join(helper, "card.module.css"),
      '.root { composes: base from "#base"; color: blue; filter: url("#icon"); }');
    const artifact = await compileTrustedModule({
      source: 'export { styles } from "@fixture/helper";',
      sourceFileName: "entry.ts", resolveDir: root, bundleModules: ["@fixture/helper"],
    });
    const loaded = instantiateTrustedBundle<{ styles: { root: string } }>(artifact, { externals: {} });
    const css = Buffer.from(artifact.assets.find((asset) => asset.path === "component.css")!.content, "base64").toString("utf8");
    expect(css).toContain(".theme");
    expect(css).toContain("color: red");
    expect(css).toContain("color: blue");
    expect(css).toContain("font-weight: bold");
    expect(css).toContain("url(#icon)");
    expect(loaded.styles.root.split(" ")).toHaveLength(2);
    for (const className of loaded.styles.root.split(" ")) expect(css).toContain("." + className);
  });
});

it("follows private local imports into nested CommonJS package scopes", async () => {
  await withPackageFixture(async (root) => {
    const helper = join(root, "node_modules", "@fixture", "helper");
    await mkdir(join(helper, "cjs"));
    await writeFile(join(helper, "package.json"), JSON.stringify({
      name: "@fixture/helper", type: "module", exports: "./index.js",
      imports: { "#implementation": "./cjs/implementation.js" },
    }));
    await writeFile(join(helper, "cjs", "package.json"), '{"type":"commonjs"}');
    await writeFile(join(helper, "cjs", "implementation.js"), 'exports.state = { value: "local" };');
    await writeFile(join(helper, "index.js"), [
      'import { state } from "#implementation"; export { state };',
      'export const load = () => import("#implementation");',
      'export const loadCjs = () => require("#implementation");',
    ].join("\n"));
    const artifact = await compileTrustedModule({
      source: 'export * from "@fixture/helper";',
      sourceFileName: "entry.ts", resolveDir: root, bundleModules: ["@fixture/helper"],
    });
    type State = { value: string };
    const loaded = instantiateTrustedBundle<{
      state: State; load(): Promise<{ state: State }>; loadCjs(): { state: State };
    }>(artifact, { externals: {} });
    expect(loaded.state.value).toBe("local");
    expect((await loaded.load()).state).toBe(loaded.state);
    expect(loaded.loadCjs().state).toBe(loaded.state);
    expect(artifact.externalModules).toEqual([]);
  });
});

it("resolves linked package-private imports, conditions, patterns, and isolated CSS", async () => {
  const compile = async (targetDirectory: string) => {
    let result!: Awaited<ReturnType<typeof compileTrustedModule>>;
    await withPackageFixture(async (root) => {
      const helper = join(root, "node_modules", "@fixture", "helper");
      await mkdir(join(helper, "locales"));
      await writeFile(join(helper, "package.json"), JSON.stringify({
        name: "@fixture/helper", type: "module", exports: "./index.js",
        imports: {
          "#state": { import: "./state.js", require: "./state.cjs" },
          "#locale/*": "./locales/*.js",
          "#styles": "./card.module.css",
        },
      }));
      await writeFile(join(helper, "index.js"), `
        import { state } from "#state";
        import { label } from "#locale/en";
        import styles from "#styles";
        export { state, label, styles };
        export const load = () => import("#state");
        export const loadCjs = () => require("#state");
      `);
      await writeFile(join(helper, "state.js"), 'export const state = { mode: "import" };');
      await writeFile(join(helper, "state.cjs"), 'exports.mode = "require";');
      await writeFile(join(helper, "locales", "en.js"), 'export const label = "hello";');
      await writeFile(join(helper, "card.module.css"), ".root { color: red; }");
      const target = join(root, targetDirectory, "helper");
      await mkdir(join(root, targetDirectory), { recursive: true });
      await rename(helper, target);
      await symlink(target, helper, "dir");
      result = await compileTrustedModule({
        source: 'export * from "@fixture/helper";',
        sourceFileName: "entry.ts", resolveDir: root,
        bundleModules: ["@fixture/helper"],
      });
      const loaded = instantiateTrustedBundle<{
        state: { mode: string }; label: string; styles: { root: string };
        load(): Promise<{ state: { mode: string } }>;
        loadCjs(): { mode: string };
      }>(result, { externals: {} });
      expect(result.externalModules).toEqual([]);
      expect(loaded.state.mode).toBe("import");
      expect((await loaded.load()).state).toBe(loaded.state);
      expect(loaded.loadCjs().mode).toBe("require");
      expect(loaded.label).toBe("hello");
      const css = Buffer.from(result.assets.find((asset) => asset.path === "component.css")!.content, "base64").toString("utf8");
      expect(css).toContain("." + loaded.styles.root);
      expect(loaded.styles.root).not.toBe("card_root");
    });
    return result;
  };
  const first = await compile("store-a");
  const second = await compile("other-store/nested");
  expect(first.assets).toEqual(second.assets);
});

it("resolves package-private file imports from the entry package", async () => {
  await withPackageFixture(async (root) => {
    await writeFile(join(root, "package.json"), JSON.stringify({
      type: "module", imports: { "#local": "./local.js" },
    }));
    await writeFile(join(root, "local.js"), 'export const value = "local";');
    const artifact = await compileTrustedModule({
      source: 'export { value } from "#local";',
      sourceFileName: "entry.ts", resolveDir: root,
    });
    expect(instantiateTrustedBundle<{ value: string }>(artifact, { externals: {} }).value).toBe("local");
  });
});

it.each(["sibling", "nested", "workspace"])("retains explicit bundled and host-owned choices for private aliases to %s dependencies", async (layout) => {
  await withPackageFixture(async (root) => {
    const helper = join(root, "node_modules", "@fixture", "helper");
    await writeFile(join(helper, "package.json"), JSON.stringify({
      name: "@fixture/helper", type: "module", exports: "./index.js",
      imports: { "#dependency": "@fixture/formatter" },
    }));
    await writeFile(join(helper, "index.js"), 'export { value } from "#dependency";');
    const formatter = join(root, "node_modules", "@fixture", "formatter");
    await writeFile(join(formatter, "format.js"), 'export const value = "bundled";');
    if (layout === "nested") {
      const scopedModules = join(helper, "node_modules", "@fixture");
      await mkdir(scopedModules, { recursive: true });
      await rename(formatter, join(scopedModules, "formatter"));
    } else if (layout === "workspace") {
      const workspace = join(helper, "workspace-formatter");
      await rename(formatter, workspace);
      await symlink(workspace, formatter, "dir");
    }
    const input = {
      source: 'export { value } from "@fixture/helper";',
      sourceFileName: "entry.ts", resolveDir: root,
      bundleModules: ["@fixture/helper"],
    };
    await expect(compileTrustedModule(input))
      .rejects.toThrow('Import "#dependency" is neither a bundled implementation module nor an allowed host external.');
    const bundled = await compileTrustedModule({
      ...input, bundleModules: [...input.bundleModules, "#dependency"],
    });
    expect(instantiateTrustedBundle<{ value: string }>(bundled, { externals: {} }).value).toBe("bundled");
    const external = await compileTrustedModule({ ...input, externalModules: ["#dependency"] });
    const marker = {};
    expect(external.externalModules).toEqual(["#dependency"]);
    expect(instantiateTrustedBundle<{ value: object }>(external, {
      externals: { "#dependency": { value: marker } },
    }).value).toBe(marker);
  });
});

it.each(["./initialize", "#initialize"])("preserves linked verbatim imports through %s without changing caller config", async (specifier) => {
  await withPackageFixture(async (root) => {
    const helper = join(root, "node_modules", "@fixture", "helper");
    await writeFile(join(root, "tsconfig.json"), JSON.stringify({
      compilerOptions: { verbatimModuleSyntax: false },
    }));
    await writeFile(join(root, "caller-side.ts"), `
      import { state } from "host-state";
      state.callerInitialized = true;
      export const unused = 1;
    `);
    await writeFile(join(helper, "package.json"), JSON.stringify({
      name: "@fixture/helper", type: "module", exports: "./index.ts",
      imports: { "#initialize": "./initialize.ts" },
    }));
    await writeFile(join(helper, "tsconfig.json"), JSON.stringify({
      compilerOptions: { verbatimModuleSyntax: true },
    }));
    await writeFile(join(helper, "initialize.ts"), `
      import { state } from "host-state";
      state.packageInitialized = true;
      export const register = 1;
    `);
    await writeFile(join(helper, "index.ts"), `
      import { register } from ${JSON.stringify(specifier)};
      import { state } from "host-state";
      export const initialized = state.packageInitialized;
    `);
    const target = join(root, "workspace", "helper");
    await mkdir(join(root, "workspace"));
    await rename(helper, target);
    await symlink(target, helper, "dir");
    const input = {
      source: 'import { unused } from "./caller-side"; export { initialized } from "@fixture/helper";',
      sourceFileName: "entry.ts", resolveDir: root,
      bundleModules: ["@fixture/helper"], externalModules: ["host-state"],
    };
    const artifact = await compileTrustedModule(input);
    const state = { packageInitialized: false, callerInitialized: false };
    const loaded = instantiateTrustedBundle<{ initialized: boolean }>(artifact, {
      externals: { "host-state": { state } },
    });
    expect(loaded.initialized).toBe(true);
    expect(state).toEqual({ packageInitialized: true, callerInitialized: false });
    expect((await compileTrustedModule(input)).sha256).toBe(artifact.sha256);
  });
});
