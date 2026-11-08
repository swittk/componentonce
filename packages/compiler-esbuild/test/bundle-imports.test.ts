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

it.each(["card.module.css", "card", "card.skin", "skin", "relative.skin", "composed.skin"])("namespaces bundled CSS subpath %s by content and portable dependency paths", async (subpath) => {
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
        },
      }));
      const stylesheet = subpath.includes("skin") ? "card.skin" : "card.module.css";
      await writeFile(join(helper, stylesheet), ".root { color: " + color + "; }");
      await writeFile(join(helper, "relative.js"), 'export { default } from "./card.skin";');
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

it.each(["package", "relative-first"])("emits identical linked package artifacts across target locations (%s)", async (order) => {
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
        sourceFileName: "entry.ts", resolveDir: root, bundleModules: ["@fixture/helper"],
      });
      const { styles } = instantiateTrustedBundle<{ styles: { root: string } }>(artifact, { externals: {} });
      const css = artifact.assets.find((asset) => asset.path === "component.css")!;
      expect(Buffer.from(css.content, "base64").toString("utf8")).toContain("." + styles.root);
      result = { className: styles.root, bundleHash: artifact.sha256, assets: artifact.assets };
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
    expect(sourceMap.sources.every((source) => !source.includes("workspace"))).toBe(true);
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
    expect(instantiateTrustedBundle<{ value: string }>(artifact, { externals: {} }).value).toBe("runtime value");
  });
});
