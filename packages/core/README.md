# @componentonce/core

Framework and storage agnostic contracts for trusted, versioned ComponentOnce modules. This package has no React, compiler, transport, filesystem, database, or application dependency.

## Definitions

A definition keeps persisted props, host runtime context, and per-render payload as separate generic types. Core carries those types without interpreting their shapes.

```ts
import type { ComponentOnceDefinition } from "@componentonce/core";

type Card = ComponentOnceDefinition<
  (input: unknown) => unknown,       // implementation
  { title: string },                // persisted Props
  { locale: string; api: object },  // host-owned Context
  { recordId: number }              // per-render Payload
>;
```

`ComponentOnceManifest` gives every definition an exact `id` and `version`. It may also declare `{ name, version }` in `hostApi`.

## Isolated versioned registries

```ts
import { ComponentOnceRegistry } from "@componentonce/core";

const registry = new ComponentOnceRegistry();
registry.register(definitionV1);
registry.register(definitionV2, { setAsDefault: true });

const pinned = registry.getExact("reports/card", "1.0.0");
const selected = registry.resolve({ id: "reports/card" });
```

Each `ComponentOnceRegistry` owns its own maps. There is no global registry. `getExact` and a versioned `resolve` never select another version. An unversioned `resolve` works only after `setDefaultVersion` or `setAsDefault`; registration never treats the newest-looking string as latest.

Duplicate exact versions throw `ComponentOnceDuplicateVersionError` by default. A caller may explicitly choose `keep-existing` or `replace` through `onConflict`. `unregister` removes one exact version and clears its default selection when needed.

## Loader adapters

Core describes a loader but performs no I/O. Extend `ComponentOnceLoadDescriptor` with fields owned by the adapter:

```ts
import {
  ComponentOnceRegistry,
  loadAndRegisterComponentOnce,
  type ComponentOnceLoadDescriptor,
  type ComponentOnceLoader,
} from "@componentonce/core";

interface ModuleDescriptor extends ComponentOnceLoadDescriptor {
  moduleToken: string;
}

const loader: ComponentOnceLoader<MyDefinition, ModuleDescriptor> = {
  async load(descriptor) {
    return importTrustedModule(descriptor.moduleToken);
  },
};

const definition = await loadAndRegisterComponentOnce(
  new ComponentOnceRegistry<MyDefinition>(),
  loader,
  { id: "reports/card", version: "1.4.2", moduleToken: "internal:reports/card@1.4.2" },
);
```

`loadAndRegisterComponentOnce` verifies that the loaded manifest exactly matches the requested id and version before registration.

## Host API compatibility

`isComponentOnceHostCompatible` and `assertComponentOnceHostCompatible` use exact API name and version equality by default. A host can pass a small version comparison function when it follows another version policy; core has no semver dependency.
