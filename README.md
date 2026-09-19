# ComponentOnce

Small FOSS-ready contracts for registering, loading, and rendering trusted, versioned, application-specific components.

ComponentOnce keeps three values distinct:

- Props are persisted/configured component values.
- HostContext is an arbitrary rich runtime object owned by the host application.
- Payload is arbitrary application/domain data supplied for one render or mount.

## Architecture

@componentonce/core is renderer-agnostic. It owns exact identities, isolated registries, loader contracts, validators, and generic runtime/application capability requirements.

Renderer adapters sit above core:

- @componentonce/react renders trusted components with the host React singleton.
- @componentonce/dom mounts trusted ordinary DOM/HTML implementations with explicit update/destroy lifecycle.

@componentonce/compiler-esbuild is optional trusted tooling. It can compile generic JavaScript/TypeScript modules, while compileTrustedReactModule is a React convenience wrapper that leaves React and JSX runtimes external.

Storage, transport, databases, bundle locations, application SDKs, Puck, FreelancerOnce, and Shinebright remain host concerns.

## Compatibility

A manifest may require multiple named capabilities, for example React plus an application SDK. The host supplies available capabilities before render or mount. Exact name/version matching is the default; hosts may provide their own compatibility predicate without adding a semver dependency to core.

The v0 scope is trusted internal component code. ComponentOnce does not impose a marketplace or sandbox policy.
