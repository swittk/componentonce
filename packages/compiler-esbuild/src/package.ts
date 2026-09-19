import { createHash } from "node:crypto";
import type {
  AnyComponentOnceDefinition,
  ComponentOnceManifest,
} from "@componentonce/core";
import {
  COMPONENTONCE_TRUSTED_BUNDLE_FORMAT,
  assertTrustedBundleIntegrity,
  compileTrustedModule,
  compileTrustedReactModule,
  instantiateTrustedBundle,
  type ComponentOnceCompileInput,
  type ComponentOnceHostExternals,
  type ComponentOnceReactCompileInput,
  type ComponentOnceTrustedBundleArtifact,
  type InstantiateTrustedBundleOptions,
} from "./compiler.js";

/** Stable identifier for a self-describing ComponentOnce package envelope. */
export const COMPONENTONCE_TRUSTED_PACKAGE_FORMAT = "componentonce.trusted-package.v1" as const;

/** Conventional named export containing a packaged ComponentOnce definition. */
export const COMPONENTONCE_DEFAULT_DEFINITION_EXPORT = "definition" as const;

const REACT_EXTERNALS = ["react", "react/jsx-runtime", "react/jsx-dev-runtime"] as const;

/** Persistable package containing inspectable metadata plus one trusted executable bundle. */
export interface ComponentOnceTrustedPackage {
  /** Package-envelope contract version. */
  readonly format: typeof COMPONENTONCE_TRUSTED_PACKAGE_FORMAT;
  /** Renderer/adapter id such as react or dom; custom adapters may use their own stable id. */
  readonly renderer: string;
  /** Component identity and compatibility metadata readable without executing the bundle. */
  readonly manifest: ComponentOnceManifest;
  /** Named module export containing the ComponentOnce definition. */
  readonly definitionExport: string;
  /** Integrity-protected executable bundle produced by this compiler. */
  readonly bundle: ComponentOnceTrustedBundleArtifact;
}

/** Explicit inputs for wrapping an existing trusted bundle in a self-describing package. */
export interface CreateTrustedComponentPackageInput {
  readonly renderer: string;
  readonly manifest: ComponentOnceManifest;
  readonly bundle: ComponentOnceTrustedBundleArtifact;
  readonly definitionExport?: string;
}

/** Generic trusted-definition build that discovers the manifest once at build time. */
export interface ComponentOnceDefinitionPackageBuildInput extends ComponentOnceCompileInput {
  /** Stable renderer/adapter id recorded in package metadata. */
  readonly renderer: string;
  /** Build-time module values used to evaluate the trusted definition once. */
  readonly externals?: ComponentOnceHostExternals;
  /** Named definition export; defaults to definition. */
  readonly definitionExport?: string;
}

/** React package build that keeps React external and discovers metadata once at build time. */
export interface ComponentOnceReactPackageBuildInput extends ComponentOnceReactCompileInput {
  /** Build-time values including the exact React/JSX runtime used by this build. */
  readonly externals: ComponentOnceHostExternals;
  /** Named definition export; defaults to definition. */
  readonly definitionExport?: string;
}

/** Error raised when a high-level package builder cannot find a valid definition export. */
export class ComponentOncePackageDefinitionError extends Error {
  /** Export name that was missing or invalid. */
  readonly definitionExport: string;

  public constructor(definitionExport: string) {
    super(
      "Trusted module export \"" +
        definitionExport +
        "\" is not a ComponentOnce definition with a manifest and implementation.",
    );
    this.name = "ComponentOncePackageDefinitionError";
    this.definitionExport = definitionExport;
  }
}

/** Error raised when package metadata disagrees with the definition in its executable bundle. */
export class ComponentOncePackageManifestMismatchError extends Error {
  /** Manifest persisted in the package envelope. */
  readonly packaged: ComponentOnceManifest;
  /** Manifest produced by the executable definition. */
  readonly loaded: ComponentOnceManifest;

  public constructor(packaged: ComponentOnceManifest, loaded: ComponentOnceManifest) {
    super(
      "Packaged manifest \"" +
        packaged.id +
        "\" version \"" +
        packaged.version +
        "\" does not match the loaded definition \"" +
        loaded.id +
        "\" version \"" +
        loaded.version +
        "\".",
    );
    this.name = "ComponentOncePackageManifestMismatchError";
    this.packaged = packaged;
    this.loaded = loaded;
  }
}

/**
 * Wrap an already compiled trusted bundle with metadata catalogs can inspect without executing code.
 *
 * This low-level helper does not evaluate the bundle. High-level builders evaluate trusted source
 * once during build time to discover the exported definition and then persist its manifest here.
 */
export function createTrustedComponentPackage(
  input: CreateTrustedComponentPackageInput,
): ComponentOnceTrustedPackage {
  const renderer = requireNonEmptyString(input.renderer, "renderer");
  const definitionExport = requireNonEmptyString(
    input.definitionExport ?? COMPONENTONCE_DEFAULT_DEFINITION_EXPORT,
    "definitionExport",
  );
  return deepFreeze({
    format: COMPONENTONCE_TRUSTED_PACKAGE_FORMAT,
    renderer,
    manifest: copyManifest(input.manifest),
    definitionExport,
    bundle: input.bundle,
  });
}

/**
 * Compile a generic trusted definition and emit a self-describing package.
 *
 * The module executes exactly once during trusted build time so its manifest can be captured. Later
 * catalogs can inspect the package metadata without evaluating the executable component.
 */
export async function buildTrustedDefinitionPackage(
  input: ComponentOnceDefinitionPackageBuildInput,
): Promise<ComponentOnceTrustedPackage> {
  const externals = input.externals ?? {};
  const artifact = await compileTrustedModule({
    source: input.source,
    ...(input.sourceFileName === undefined ? {} : { sourceFileName: input.sourceFileName }),
    ...(input.loader === undefined ? {} : { loader: input.loader }),
    ...(input.resolveDir === undefined ? {} : { resolveDir: input.resolveDir }),
    externalModules: uniqueStrings([
      ...(input.externalModules ?? []),
      ...Object.keys(externals),
    ]),
    ...(input.jsx === undefined ? {} : { jsx: input.jsx }),
  });
  return packageTrustedDefinitionArtifact(
    artifact,
    input.renderer,
    externals,
    input.definitionExport,
  );
}

/**
 * Compile a trusted React definition and emit a self-describing package.
 *
 * React and its JSX runtimes remain external in the executable artifact. The supplied build-time
 * externals are only used for the one-time trusted metadata discovery.
 */
export async function buildTrustedReactPackage(
  input: ComponentOnceReactPackageBuildInput,
): Promise<ComponentOnceTrustedPackage> {
  const additionalExternals = Object.keys(input.externals).filter(
    (specifier) =>
      !REACT_EXTERNALS.includes(specifier as (typeof REACT_EXTERNALS)[number]),
  );
  const artifact = await compileTrustedReactModule({
    source: input.source,
    ...(input.sourceFileName === undefined ? {} : { sourceFileName: input.sourceFileName }),
    ...(input.loader === undefined ? {} : { loader: input.loader }),
    ...(input.resolveDir === undefined ? {} : { resolveDir: input.resolveDir }),
    additionalExternalModules: uniqueStrings([
      ...(input.additionalExternalModules ?? []),
      ...additionalExternals,
    ]),
  });
  return packageTrustedDefinitionArtifact(
    artifact,
    "react",
    input.externals,
    input.definitionExport,
  );
}

/** Serialize a trusted package to portable JSON for any host-owned storage adapter. */
export function serializeTrustedComponentPackage(
  componentPackage: ComponentOnceTrustedPackage,
  space = 2,
): string {
  return JSON.stringify(componentPackage, null, space);
}

/** Parse a persisted trusted package and verify the executable bundle integrity metadata. */
export function parseTrustedComponentPackage(
  source: string | Uint8Array,
): ComponentOnceTrustedPackage {
  const text = typeof source === "string" ? source : decodeUtf8(source);
  const parsed: unknown = JSON.parse(text);
  if (!isRecord(parsed) || parsed.format !== COMPONENTONCE_TRUSTED_PACKAGE_FORMAT) {
    throw new TypeError("Unsupported or invalid ComponentOnce package format.");
  }
  if (!isRecord(parsed.bundle) || parsed.bundle.format !== COMPONENTONCE_TRUSTED_BUNDLE_FORMAT) {
    throw new TypeError("ComponentOnce package does not contain a supported trusted bundle.");
  }

  const bundle = parsed.bundle as unknown as ComponentOnceTrustedBundleArtifact;
  if (
    typeof bundle.code !== "string" ||
    typeof bundle.integrity !== "string" ||
    typeof bundle.sha256 !== "string" ||
    typeof bundle.byteLength !== "number" ||
    !Array.isArray(bundle.externalModules) ||
    !bundle.externalModules.every((specifier) => typeof specifier === "string")
  ) {
    throw new TypeError("ComponentOnce package bundle metadata is incomplete.");
  }

  assertTrustedBundleIntegrity(bundle.code, bundle.integrity);
  const hashes = hashBundleSource(bundle.code);
  if (hashes.sha256 !== bundle.sha256 || hashes.byteLength !== bundle.byteLength) {
    throw new TypeError("ComponentOnce package bundle hash metadata does not match its code.");
  }
  if (typeof parsed.renderer !== "string" || !isRecord(parsed.manifest)) {
    throw new TypeError("ComponentOnce package renderer or manifest is invalid.");
  }

  return createTrustedComponentPackage({
    renderer: parsed.renderer,
    manifest: parsed.manifest as unknown as ComponentOnceManifest,
    bundle,
    definitionExport:
      typeof parsed.definitionExport === "string"
        ? parsed.definitionExport
        : COMPONENTONCE_DEFAULT_DEFINITION_EXPORT,
  });
}

/**
 * Instantiate a self-describing package and verify its executable definition still matches metadata.
 *
 * Hosts should use this at the trusted-code boundary after loading a package from storage.
 */
export function instantiateTrustedComponentPackage<
  TDefinition extends AnyComponentOnceDefinition = AnyComponentOnceDefinition,
>(
  componentPackage: ComponentOnceTrustedPackage,
  options: InstantiateTrustedBundleOptions,
): TDefinition {
  const moduleExports = instantiateTrustedBundle<Record<string, unknown>>(
    componentPackage.bundle,
    options,
  );
  const definition = readDefinitionExport(moduleExports, componentPackage.definitionExport);
  if (!sameManifest(componentPackage.manifest, definition.manifest)) {
    throw new ComponentOncePackageManifestMismatchError(
      componentPackage.manifest,
      definition.manifest,
    );
  }
  return definition as TDefinition;
}

function packageTrustedDefinitionArtifact(
  artifact: ComponentOnceTrustedBundleArtifact,
  renderer: string,
  externals: ComponentOnceHostExternals,
  definitionExport: string = COMPONENTONCE_DEFAULT_DEFINITION_EXPORT,
): ComponentOnceTrustedPackage {
  const moduleExports = instantiateTrustedBundle<Record<string, unknown>>(artifact, { externals });
  const definition = readDefinitionExport(moduleExports, definitionExport);
  return createTrustedComponentPackage({
    renderer,
    manifest: definition.manifest,
    bundle: artifact,
    definitionExport,
  });
}

function readDefinitionExport(
  moduleExports: Record<string, unknown>,
  definitionExport: string,
): AnyComponentOnceDefinition {
  const value = moduleExports[definitionExport];
  if (!isRecord(value) || !isRecord(value.manifest) || !("implementation" in value)) {
    throw new ComponentOncePackageDefinitionError(definitionExport);
  }
  copyManifest(value.manifest as unknown as ComponentOnceManifest);
  return value as unknown as AnyComponentOnceDefinition;
}

function copyManifest(manifest: ComponentOnceManifest): ComponentOnceManifest {
  if (!isRecord(manifest)) {
    throw new TypeError("ComponentOnce manifest must be an object.");
  }
  const id = requireNonEmptyString(manifest.id, "manifest.id");
  const version = requireNonEmptyString(manifest.version, "manifest.version");
  if (manifest.displayName !== undefined && typeof manifest.displayName !== "string") {
    throw new TypeError("manifest.displayName must be a string when supplied.");
  }
  const requirements = manifest.requirements?.map((requirement, index) => {
    if (!isRecord(requirement)) {
      throw new TypeError("manifest.requirements[" + index + "] must be an object.");
    }
    return {
      name: requireNonEmptyString(
        requirement.name,
        "manifest.requirements[" + index + "].name",
      ),
      version: requireNonEmptyString(
        requirement.version,
        "manifest.requirements[" + index + "].version",
      ),
    };
  });
  return {
    id,
    version,
    ...(manifest.displayName === undefined ? {} : { displayName: manifest.displayName }),
    ...(requirements === undefined ? {} : { requirements }),
  };
}

function sameManifest(left: ComponentOnceManifest, right: ComponentOnceManifest): boolean {
  return JSON.stringify(copyManifest(left)) === JSON.stringify(copyManifest(right));
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(field + " must be a non-empty string.");
  }
  return value;
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodeUtf8(source: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(source);
}

function hashBundleSource(source: string): {
  readonly byteLength: number;
  readonly sha256: string;
} {
  const bytes = Buffer.from(source, "utf8");
  return {
    byteLength: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}
