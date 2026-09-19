# ComponentOnce engineering rules

- ComponentOnce is intended to be publishable FOSS. No FreelancerOnce, Shinebright, Parse, Puck, database, filesystem, HTTP, or product-specific dependencies in core.
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
- Do not edit another lane's files without posting intent to the shared coordination board:
  /home/server/Documents/Projects/.coord/componentonce-assets.md
