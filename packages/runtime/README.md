# @componentonce/runtime

Browser-safe trusted package runtime for ComponentOnce.

Use this package when an application needs to load and execute a previously built ComponentOnce trusted package without importing a compiler. It contains no esbuild, filesystem, transport, or Node builtin dependency.

The runtime parses inspectable package metadata, verifies executable bundle bytes with Web Crypto SHA-256, instantiates CommonJS output with an explicit host external map, and verifies that the executable definition still matches the packaged manifest.

Trusted evaluation deliberately uses new Function. This is not a security sandbox; only trusted internal code should be loaded.
