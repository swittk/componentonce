# @componentonce/compiler-esbuild

Optional trusted compiler/evaluator tooling for ComponentOnce.

This package is not part of the core runtime ABI and owns no storage or transport.

## Generic modules

compileTrustedModule compiles JavaScript/TypeScript into an immutable CommonJS artifact. It adds no runtime externals implicitly. Any imported host module must be declared explicitly through externalModules and injected when instantiateTrustedBundle executes the trusted artifact.

This is suitable for ordinary DOM/HTML modules and other non-React implementations.

## React convenience

compileTrustedReactModule wraps the generic compiler with automatic JSX transformation and allows the React module specifiers as host externals:

- react
- react/jsx-runtime
- react/jsx-dev-runtime

React is still never bundled. The host injects its own React singleton at instantiation. Additional host SDK imports use additionalExternalModules.

## Artifact and trust model

Artifacts contain deterministic bundle text, byte length, SHA-256 hash/integrity, normalized diagnostics, exact referenced externals, and esbuild metafile data.

instantiateTrustedBundle deliberately uses new Function with a narrow injected require map. It is for trusted internal code and is not a security sandbox.

Storage is host-owned: compiled text/bytes can live in a database-backed file object, local disk, object storage, or any other adapter.

esbuild transpiles TypeScript syntax but does not perform semantic type checking; hosts that need that guarantee should run their TypeScript checker separately.
