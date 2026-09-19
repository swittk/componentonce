import { describe, expect, expectTypeOf, it } from "vitest";
import {
  ComponentOnceDefaultVersionNotConfiguredError,
  ComponentOnceDefinitionNotFoundError,
  ComponentOnceDuplicateVersionError,
  ComponentOnceIncompatibleHostApiError,
  ComponentOnceLoadedDefinitionMismatchError,
  ComponentOnceRegistry,
  assertComponentOnceHostCompatible,
  isComponentOnceHostCompatible,
  loadAndRegisterComponentOnce,
  type ComponentOnceDefinition,
  type ComponentOnceLoadDescriptor,
  type ComponentOnceLoader,
} from "../src/index.js";

type TestDefinition = ComponentOnceDefinition<
  string,
  { readonly title: string },
  { readonly locale: string },
  { readonly recordId: number }
>;

function definition(version: string, implementation = version): TestDefinition {
  return {
    manifest: { id: "example/card", version },
    implementation,
  };
}

describe("ComponentOnceRegistry", () => {
  it("keeps multiple registry instances isolated", () => {
    const first = new ComponentOnceRegistry<TestDefinition>();
    const second = new ComponentOnceRegistry<TestDefinition>();
    const firstDefinition = definition("1.0.0", "first");
    const secondDefinition = definition("1.0.0", "second");

    first.register(firstDefinition);
    second.register(secondDefinition);

    expect(first.getExact("example/card", "1.0.0")).toBe(firstDefinition);
    expect(second.getExact("example/card", "1.0.0")).toBe(secondDefinition);
  });

  it("pins exact versions and only uses an explicitly selected default", () => {
    const registry = new ComponentOnceRegistry<TestDefinition>();
    const v1 = definition("1.0.0");
    const v2 = definition("2.0.0");
    registry.register(v2);
    registry.register(v1);

    expect(registry.getExact("example/card", "1.0.0")).toBe(v1);
    expect(registry.resolve({ id: "example/card", version: "2.0.0" })).toBe(v2);
    expect(() => registry.resolve({ id: "example/card" })).toThrow(
      ComponentOnceDefaultVersionNotConfiguredError,
    );

    registry.setDefaultVersion("example/card", "1.0.0");
    expect(registry.resolve({ id: "example/card" })).toBe(v1);
    expect(registry.listVersions("example/card")).toEqual(["1.0.0", "2.0.0"]);

    expect(registry.unregister("example/card", "1.0.0")).toBe(v1);
    expect(registry.getDefaultVersion("example/card")).toBeUndefined();
    expect(() => registry.getExact("example/card", "1.0.0")).toThrow(
      ComponentOnceDefinitionNotFoundError,
    );
  });

  it("rejects duplicate versions by default and supports explicit conflict policies", () => {
    const registry = new ComponentOnceRegistry<TestDefinition>();
    const original = definition("1.0.0", "original");
    const replacement = definition("1.0.0", "replacement");
    registry.register(original);

    expect(() => registry.register(replacement)).toThrow(ComponentOnceDuplicateVersionError);
    expect(
      registry.register(replacement, { onConflict: "keep-existing" }),
    ).toBe(original);
    expect(registry.getExact("example/card", "1.0.0")).toBe(original);

    expect(registry.register(replacement, { onConflict: "replace" })).toBe(replacement);
    expect(registry.getExact("example/card", "1.0.0")).toBe(replacement);
  });
});

describe("loadAndRegisterComponentOnce", () => {
  interface TestDescriptor extends ComponentOnceLoadDescriptor {
    readonly moduleToken: string;
  }

  it("loads and registers one exact typed descriptor", async () => {
    const loaded = definition("3.2.1", "loaded");
    const registry = new ComponentOnceRegistry<TestDefinition>();
    const loader: ComponentOnceLoader<TestDefinition, TestDescriptor> = {
      async load(descriptor) {
        expect(descriptor.moduleToken).toBe("module:card@3.2.1");
        return loaded;
      },
    };

    const result = await loadAndRegisterComponentOnce(registry, loader, {
      id: "example/card",
      version: "3.2.1",
      moduleToken: "module:card@3.2.1",
    });

    expectTypeOf(result).toEqualTypeOf<TestDefinition>();
    expect(result).toBe(loaded);
    expect(registry.getExact("example/card", "3.2.1")).toBe(loaded);
  });

  it("rejects a loaded definition whose exact identity differs", async () => {
    const registry = new ComponentOnceRegistry<TestDefinition>();
    const loader: ComponentOnceLoader<TestDefinition, TestDescriptor> = {
      async load() {
        return definition("9.9.9");
      },
    };

    await expect(
      loadAndRegisterComponentOnce(registry, loader, {
        id: "example/card",
        version: "1.0.0",
        moduleToken: "wrong",
      }),
    ).rejects.toBeInstanceOf(ComponentOnceLoadedDefinitionMismatchError);
    expect(registry.hasExact("example/card", "9.9.9")).toBe(false);
  });
});

describe("host API compatibility", () => {
  const manifest = {
    id: "example/card",
    version: "1.0.0",
    hostApi: { name: "example-host", version: "2.3" },
  } as const;

  it("defaults to exact name and version matching", () => {
    expect(
      isComponentOnceHostCompatible(manifest, { name: "example-host", version: "2.3" }),
    ).toBe(true);
    expect(
      isComponentOnceHostCompatible(manifest, { name: "example-host", version: "2.4" }),
    ).toBe(false);
    expect(() =>
      assertComponentOnceHostCompatible(manifest, {
        name: "another-host",
        version: "2.3",
      }),
    ).toThrow(ComponentOnceIncompatibleHostApiError);
  });

  it("lets a host supply its own small version rule", () => {
    const sameMajor = (required: string, available: string) =>
      required.split(".")[0] === available.split(".")[0];

    expect(
      isComponentOnceHostCompatible(
        manifest,
        { name: "example-host", version: "2.99" },
        sameMajor,
      ),
    ).toBe(true);
  });
});
