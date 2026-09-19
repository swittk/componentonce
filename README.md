# ComponentOnce

Small FOSS-ready contracts for registering, loading, and rendering trusted, versioned, application-specific components.

ComponentOnce keeps three values distinct:

- **Props** are the persisted or configured component values.
- **HostContext** is an arbitrary rich runtime object owned by the host application.
- **Payload** is arbitrary application or domain data supplied for one render.

## Packages

### `@componentonce/core`

The core package provides manifests, typed definitions, isolated versioned registries, loader adapter contracts, exact load-and-register verification, and pluggable host API compatibility checks. It imports no React, compiler, storage implementation, transport, database, or application code.

Exact `id` plus exact `version` lookup is deterministic. Hosts may explicitly select a default version, while pinned content can always call `getExact(id, version)`. See the [core API guide](./packages/core/README.md).

### `@componentonce/react`

The React package provides `defineReactComponent<Props, HostContext, Payload>()`, typed rendering, opt-in validation, raw boundary helpers, and host-specific type helpers. React stays a peer dependency so trusted dynamic modules share the host React instance. See the [React API guide](./packages/react/README.md) and the [two-host consumer example](./packages/react/examples/two-hosts.tsx).

The v0 scope is trusted internal component code. Loading remains a host adapter concern, and core does not impose a sandbox or marketplace policy.
