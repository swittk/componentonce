# ComponentOnce engineering rules

- ComponentOnce is intended to be publishable FOSS. Core must not depend on any host application, database, filesystem, HTTP transport, visual editor, or product-specific runtime.
- Keep three concepts distinct: persisted/configured component Props, arbitrary host-owned runtime Context, and arbitrary per-render Payload.
- Context and Payload are generic host types. Core must never assume their shape.
- Exact module id + version is deterministic. Hosts must be able to pin a version rather than silently taking latest.
- Registry/load/compiler/storage are separate contracts. A registry does not know where source/bundles are stored.
- Core must not import React. React integration belongs in @componentonce/react.
- Compiler implementation belongs outside core. @componentonce/compiler-esbuild is optional tooling.
- Dynamic/trusted-code loading is the v0 target. Do not add marketplace/sandbox policy until a host actually needs it.
- Compiled React modules must use the host React instance. Never silently bundle a second React copy into a dynamically loaded component.
- Adapters own I/O and repeated validation. Core should stay small, deterministic, and boring.
- No hidden global singleton registry. Hosts may run multiple isolated registries.
- Every exported named type/interface/class/function gets a short purpose doc comment.
- Public API changes require tests and a consumer-style example.
- When multiple contributors work concurrently, coordinate ownership before editing overlapping files.
