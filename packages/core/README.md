# @componentonce/core

Renderer, framework, and storage agnostic contracts for trusted versioned components.

## Definitions

ComponentOnceDefinition carries four independent generic types:

- implementation: opaque to core
- Props: persisted/configured data
- HostContext: arbitrary runtime capabilities/services owned by the host
- Payload: arbitrary application/domain data for one invocation

Every manifest has an exact id and version and may declare multiple requirements:

    requirements: [
      { name: "react", version: "19" },
      { name: "my-app-sdk", version: "3" }
    ]

Core does not know what those capabilities mean.

## Compatibility

Hosts provide ComponentOnceCapability records before executing an implementation.

assertComponentOnceCompatible verifies every requirement. Missing capability and incompatible version are separate typed errors. Exact name/version equality is the default.

When a capability deliberately uses stable numeric SemVer, core also exports an **opt-in** dependency-free helper:

```ts
import {
  semverComponentOnceCapabilityCompatibility,
} from "@componentonce/core";

assertComponentOnceCompatible(
  manifest,
  [{ name: "react", version: "19.2.6" }],
  semverComponentOnceCapabilityCompatibility,
);
```

A requirement such as `>=18 <20` then accepts React 18 and 19. Supported stable range forms include exact/partial versions, wildcards, comparator conjunctions, caret/tilde ranges and `||`. Prerelease policy remains host-owned.

This does **not** add ranged component resolution: component ids/versions and registry lookup remain exact. Hosts can still supply any ComponentOnceCapabilityCompatibility when their capability versioning is not SemVer.

Core has no semver dependency and no React-specific compatibility logic.

## Registries

ComponentOnceRegistry instances are isolated. Exact id/version lookup is deterministic. Hosts may explicitly configure a default version, but registration never guesses that a newest-looking string should win.

Duplicate exact versions throw by default; callers may explicitly keep the existing definition or replace it.

## Loaders

ComponentOnceLoader is an I/O-free adapter contract. Storage and transport implementations extend ComponentOnceLoadDescriptor with their own data. loadAndRegisterComponentOnce verifies that a loader returned the exact id/version requested before registration.
