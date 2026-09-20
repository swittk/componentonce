import { createHash } from "node:crypto";
import type {
  AnyComponentOnceDefinition,
  ComponentOnceManifest,
} from "@componentonce/core";
import {
  COMPONENTONCE_ASSET_URL_PREFIX,
  COMPONENTONCE_TRUSTED_BUNDLE_FORMAT,
  assertTrustedBundleIntegrity,
  compileTrustedModule,
  compileTrustedReactModule,
  instantiateTrustedBundle,
  type ComponentOnceCompileInput,
  type ComponentOnceCompiledAsset,
  type ComponentOnceHostExternals,
  type ComponentOnceReactCompileInput,
  type ComponentOnceTrustedBundle,
  type ComponentOnceTrustedBundleArtifact,
  type InstantiateTrustedBundleOptions,
} from "./compiler.js";

/** Legacy package-envelope identifier retained for persisted package compatibility. */
export const COMPONENTONCE_TRUSTED_PACKAGE_FORMAT_V1 = "componentonce.trusted-package.v1" as const;

/** Asset-capable package-envelope identifier emitted by current builders. */
export const COMPONENTONCE_TRUSTED_PACKAGE_FORMAT_V2 = "componentonce.trusted-package.v2" as const;

/** Current package-envelope identifier emitted by this compiler. */
export const COMPONENTONCE_TRUSTED_PACKAGE_FORMAT = COMPONENTONCE_TRUSTED_PACKAGE_FORMAT_V2;

/** Conventional named export containing a packaged ComponentOnce definition. */
export const COMPONENTONCE_DEFAULT_DEFINITION_EXPORT = "definition" as const;

const REACT_EXTERNALS = ["react", "react/jsx-runtime", "react/jsx-dev-runtime"] as const;
const DEFAULT_PACKAGE_LIMITS: Required<ComponentOncePackageParseLimits> = {
  maxPackageBytes: 48 * 1024 * 1024,
  maxAssets: 256,
  maxAssetBytes: 16 * 1024 * 1024,
  maxTotalAssetBytes: 32 * 1024 * 1024,
};

/** Persisted v1 package containing inspectable metadata plus one trusted executable bundle. */
export interface ComponentOnceTrustedPackageV1 {
  /** Package-envelope contract version. */
  readonly format: typeof COMPONENTONCE_TRUSTED_PACKAGE_FORMAT_V1;
  /** Renderer/adapter id such as react or dom; custom adapters may use their own stable id. */
  readonly renderer: string;
  /** Component identity and compatibility metadata readable without executing the bundle. */
  readonly manifest: ComponentOnceManifest;
  /** Named module export containing the ComponentOnce definition. */
  readonly definitionExport: string;
  /** Integrity-protected executable bundle produced by this compiler. */
  readonly bundle: ComponentOnceTrustedBundle;
}

/** Persisted v2 package containing executable code and integrity-protected static assets. */
export interface ComponentOnceTrustedPackageV2 {
  /** Asset-capable package-envelope contract version. */
  readonly format: typeof COMPONENTONCE_TRUSTED_PACKAGE_FORMAT_V2;
  /** Renderer/adapter id such as react or dom. */
  readonly renderer: string;
  /** Component identity and compatibility metadata readable without execution. */
  readonly manifest: ComponentOnceManifest;
  /** Named module export containing the ComponentOnce definition. */
  readonly definitionExport: string;
  /** Integrity-protected executable bundle produced by this compiler. */
  readonly bundle: ComponentOnceTrustedBundle;
  /** Sorted embedded files emitted by esbuild. */
  readonly assets: readonly ComponentOnceCompiledAsset[];
  /** Sorted asset paths containing styles that a host may mount explicitly. */
  readonly stylesheets: readonly string[];
}

/** Any supported persisted trusted package envelope. */
export type ComponentOnceTrustedPackage =
  | ComponentOnceTrustedPackageV1
  | ComponentOnceTrustedPackageV2;

/** Bounds applied once while parsing untyped package input. */
export interface ComponentOncePackageParseLimits {
  readonly maxPackageBytes?: number;
  readonly maxAssets?: number;
  readonly maxAssetBytes?: number;
  readonly maxTotalAssetBytes?: number;
}

/** Explicit inputs for wrapping an existing trusted bundle in a self-describing package. */
export interface CreateTrustedComponentPackageInput {
  readonly renderer: string;
  readonly manifest: ComponentOnceManifest;
  readonly bundle: ComponentOnceTrustedBundleArtifact;
  readonly definitionExport?: string;
  /** Embedded output files; defaults to outputs carried by the compiler artifact. */
  readonly assets?: readonly ComponentOnceCompiledAsset[];
  /** Stylesheet asset paths; defaults to outputs carried by the compiler artifact. */
  readonly stylesheets?: readonly string[];
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

/** Compiler-side trusted execution options, including optional v2 asset URL resolution. */
export interface InstantiateTrustedComponentPackageOptions
  extends InstantiateTrustedBundleOptions {
  /** Resolve generated file-loader imports when executing a v2 package in this Node toolchain. */
  readonly resolveAssetUrl?: (asset: ComponentOnceCompiledAsset) => string;
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
): ComponentOnceTrustedPackageV2 {
  const renderer = requireNonEmptyString(input.renderer, "renderer");
  const definitionExport = requireNonEmptyString(
    input.definitionExport ?? COMPONENTONCE_DEFAULT_DEFINITION_EXPORT,
    "definitionExport",
  );
  const assets = [...(input.assets ?? input.bundle.assets ?? [])].sort((left, right) =>
    compareStrings(left.path, right.path),
  );
  const stylesheets = [...(input.stylesheets ?? input.bundle.stylesheets ?? [])].sort(
    compareStrings,
  );
  validateEmbeddedAssets(assets, stylesheets, input.bundle.code);
  return deepFreeze({
    format: COMPONENTONCE_TRUSTED_PACKAGE_FORMAT,
    renderer,
    manifest: copyManifest(input.manifest),
    definitionExport,
    bundle: stripCompilationOutputs(input.bundle),
    assets,
    stylesheets,
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
): Promise<ComponentOnceTrustedPackageV2> {
  const externals = input.externals ?? {};
  const artifact = await compileTrustedModule({
    source: input.source,
    ...(input.sourceFileName === undefined ? {} : { sourceFileName: input.sourceFileName }),
    ...(input.loader === undefined ? {} : { loader: input.loader }),
    ...(input.resolveDir === undefined ? {} : { resolveDir: input.resolveDir }),
    ...(input.loaders === undefined ? {} : { loaders: input.loaders }),
    ...(input.contentTypes === undefined ? {} : { contentTypes: input.contentTypes }),
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
): Promise<ComponentOnceTrustedPackageV2> {
  const additionalExternals = Object.keys(input.externals).filter(
    (specifier) =>
      !REACT_EXTERNALS.includes(specifier as (typeof REACT_EXTERNALS)[number]),
  );
  const artifact = await compileTrustedReactModule({
    source: input.source,
    ...(input.sourceFileName === undefined ? {} : { sourceFileName: input.sourceFileName }),
    ...(input.loader === undefined ? {} : { loader: input.loader }),
    ...(input.resolveDir === undefined ? {} : { resolveDir: input.resolveDir }),
    ...(input.loaders === undefined ? {} : { loaders: input.loaders }),
    ...(input.contentTypes === undefined ? {} : { contentTypes: input.contentTypes }),
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
  configuredLimits: ComponentOncePackageParseLimits = {},
): ComponentOnceTrustedPackage {
  const limits = normalizePackageLimits(configuredLimits);
  const packageByteLength =
    typeof source === "string" ? Buffer.byteLength(source, "utf8") : source.byteLength;
  if (packageByteLength > limits.maxPackageBytes) {
    throw new TypeError(
      "ComponentOnce package exceeds maxPackageBytes (" + limits.maxPackageBytes + ").",
    );
  }
  const text = typeof source === "string" ? source : decodeUtf8(source);
  const parsed: unknown = JSON.parse(text);
  if (
    !isRecord(parsed) ||
    (parsed.format !== COMPONENTONCE_TRUSTED_PACKAGE_FORMAT_V1 &&
      parsed.format !== COMPONENTONCE_TRUSTED_PACKAGE_FORMAT_V2)
  ) {
    throw new TypeError("Unsupported or invalid ComponentOnce package format.");
  }
  if (!isRecord(parsed.bundle) || parsed.bundle.format !== COMPONENTONCE_TRUSTED_BUNDLE_FORMAT) {
    throw new TypeError("ComponentOnce package does not contain a supported trusted bundle.");
  }

  const bundle = parsed.bundle as unknown as ComponentOnceTrustedBundle;
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

  const renderer = requireNonEmptyString(parsed.renderer, "renderer");
  const manifest = copyManifest(parsed.manifest as unknown as ComponentOnceManifest);
  const definitionExport =
    typeof parsed.definitionExport === "string"
      ? requireNonEmptyString(parsed.definitionExport, "definitionExport")
      : COMPONENTONCE_DEFAULT_DEFINITION_EXPORT;
  if (parsed.format === COMPONENTONCE_TRUSTED_PACKAGE_FORMAT_V1) {
    return deepFreeze({
      format: COMPONENTONCE_TRUSTED_PACKAGE_FORMAT_V1,
      renderer,
      manifest,
      definitionExport,
      bundle,
    });
  }
  if (!Array.isArray(parsed.assets) || !Array.isArray(parsed.stylesheets)) {
    throw new TypeError("ComponentOnce v2 package assets or stylesheets are invalid.");
  }
  if (parsed.assets.length > limits.maxAssets) {
    throw new TypeError("ComponentOnce package exceeds maxAssets (" + limits.maxAssets + ").");
  }
  let totalAssetBytes = 0;
  const assets = parsed.assets.map((value, index) => {
    const asset = parseEmbeddedAsset(value, index);
    if (asset.byteLength > limits.maxAssetBytes) {
      throw new TypeError(
        "ComponentOnce asset " + JSON.stringify(asset.path) + " exceeds maxAssetBytes.",
      );
    }
    totalAssetBytes += asset.byteLength;
    if (totalAssetBytes > limits.maxTotalAssetBytes) {
      throw new TypeError(
        "ComponentOnce package exceeds maxTotalAssetBytes (" +
          limits.maxTotalAssetBytes +
          ").",
      );
    }
    return asset;
  });
  if (!parsed.stylesheets.every((path) => typeof path === "string")) {
    throw new TypeError("ComponentOnce v2 package stylesheet references are invalid.");
  }
  const stylesheets = [...parsed.stylesheets] as string[];
  validateEmbeddedAssets(assets, stylesheets, bundle.code);
  return deepFreeze({
    format: COMPONENTONCE_TRUSTED_PACKAGE_FORMAT_V2,
    renderer,
    manifest,
    definitionExport,
    bundle,
    assets,
    stylesheets,
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
  options: InstantiateTrustedComponentPackageOptions,
): TDefinition {
  let bundleSource: ComponentOnceTrustedBundle | string = componentPackage.bundle;
  if (componentPackage.format === COMPONENTONCE_TRUSTED_PACKAGE_FORMAT_V2) {
    validateEmbeddedAssets(
      componentPackage.assets,
      componentPackage.stylesheets,
      componentPackage.bundle.code,
    );
    const references = collectAssetReferences(componentPackage.bundle.code);
    if (references.length > 0 && options.resolveAssetUrl !== undefined) {
      const byPath = new Map(componentPackage.assets.map((asset) => [asset.path, asset]));
      assertTrustedBundleIntegrity(
        componentPackage.bundle.code,
        options.expectedIntegrity ?? componentPackage.bundle.integrity,
      );
      bundleSource = replaceAssetReferences(
        componentPackage.bundle.code,
        byPath,
        options.resolveAssetUrl,
      );
    }
  }
  const moduleExports = instantiateTrustedBundle<Record<string, unknown>>(
    bundleSource,
    bundleSource === componentPackage.bundle
      ? options
      : {
          externals: options.externals,
          ...(options.sourceName === undefined ? {} : { sourceName: options.sourceName }),
        },
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
): ComponentOnceTrustedPackageV2 {
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

function stripCompilationOutputs(
  bundle: ComponentOnceTrustedBundleArtifact,
): ComponentOnceTrustedBundle {
  const { assets: _assets, stylesheets: _stylesheets, ...persisted } = bundle;
  return persisted;
}

function parseEmbeddedAsset(value: unknown, index: number): ComponentOnceCompiledAsset {
  if (
    !isRecord(value) ||
    typeof value.path !== "string" ||
    typeof value.contentType !== "string" ||
    value.encoding !== "base64" ||
    typeof value.content !== "string" ||
    !Number.isSafeInteger(value.byteLength) ||
    (value.byteLength as number) < 0 ||
    typeof value.sha256 !== "string" ||
    !/^[0-9a-f]{64}$/u.test(value.sha256) ||
    typeof value.integrity !== "string"
  ) {
    throw new TypeError("ComponentOnce asset at index " + index + " is malformed.");
  }
  const decodedByteLength = decodedBase64ByteLength(value.content);
  if (decodedByteLength !== value.byteLength) {
    throw new TypeError(
      "ComponentOnce asset " + JSON.stringify(value.path) + " byteLength does not match its bytes.",
    );
  }
  return {
    path: value.path,
    contentType: requireContentType(value.contentType),
    encoding: "base64",
    content: value.content,
    byteLength: value.byteLength as number,
    sha256: value.sha256,
    integrity: value.integrity,
  };
}

function requireContentType(value: string): string {
  if (
    value.trim() === "" ||
    value !== value.trim() ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new TypeError("asset.contentType must be a non-empty printable string.");
  }
  return value;
}

function decodedBase64ByteLength(value: string): number {
  if (
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)
  ) {
    throw new TypeError("ComponentOnce asset content is not canonical base64.");
  }
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return (value.length / 4) * 3 - padding;
}

function validateEmbeddedAssets(
  assets: readonly ComponentOnceCompiledAsset[],
  stylesheets: readonly string[],
  bundleCode: string,
): void {
  const byPath = new Map<string, ComponentOnceCompiledAsset>();
  let previousPath: string | undefined;
  for (const asset of assets) {
    assertSafeAssetPath(asset.path);
    requireContentType(asset.contentType);
    if (byPath.has(asset.path)) {
      throw new TypeError("Duplicate ComponentOnce asset path: " + JSON.stringify(asset.path) + ".");
    }
    if (previousPath !== undefined && compareStrings(previousPath, asset.path) > 0) {
      throw new TypeError("ComponentOnce assets must be sorted by path.");
    }
    const bytes = Buffer.from(asset.content, "base64");
    if (bytes.toString("base64") !== asset.content) {
      throw new TypeError("ComponentOnce asset " + JSON.stringify(asset.path) + " has invalid base64 bytes.");
    }
    const digest = createHash("sha256").update(bytes).digest();
    const sha256 = digest.toString("hex");
    const integrity = "sha256-" + digest.toString("base64");
    if (
      bytes.byteLength !== asset.byteLength ||
      sha256 !== asset.sha256 ||
      integrity !== asset.integrity
    ) {
      throw new TypeError(
        "ComponentOnce asset " + JSON.stringify(asset.path) + " integrity metadata does not match its bytes.",
      );
    }
    byPath.set(asset.path, asset);
    previousPath = asset.path;
  }

  const seenStylesheets = new Set<string>();
  previousPath = undefined;
  for (const path of stylesheets) {
    assertSafeAssetPath(path);
    if (seenStylesheets.has(path)) {
      throw new TypeError("Duplicate ComponentOnce stylesheet reference: " + JSON.stringify(path) + ".");
    }
    const asset = byPath.get(path);
    if (asset === undefined || asset.contentType !== "text/css") {
      throw new TypeError(
        "ComponentOnce stylesheet " + JSON.stringify(path) + " must reference an embedded text/css asset.",
      );
    }
    if (previousPath !== undefined && compareStrings(previousPath, path) > 0) {
      throw new TypeError("ComponentOnce stylesheets must be sorted by path.");
    }
    seenStylesheets.add(path);
    previousPath = path;
  }

  validateAssetReferences(bundleCode, byPath);
  for (const path of stylesheets) {
    const asset = byPath.get(path)!;
    validateAssetReferences(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(asset.content, "base64")), byPath);
  }
}

function validateAssetReferences(
  source: string,
  assets: ReadonlyMap<string, ComponentOnceCompiledAsset>,
): void {
  for (const referencedPath of collectAssetReferences(source)) {
    if (!assets.has(referencedPath)) {
      throw new TypeError(
        "ComponentOnce generated asset reference " + JSON.stringify(referencedPath) + " is missing.",
      );
    }
  }
}

function collectAssetReferences(source: string): string[] {
  const references: string[] = [];
  let offset = 0;
  while (true) {
    const marker = source.indexOf(COMPONENTONCE_ASSET_URL_PREFIX, offset);
    if (marker < 0) return references;
    const reference = readAssetReference(source, marker);
    references.push(reference.path);
    offset = reference.end;
  }
}

function replaceAssetReferences(
  source: string,
  assets: ReadonlyMap<string, ComponentOnceCompiledAsset>,
  resolveAssetUrl: (asset: ComponentOnceCompiledAsset) => string,
): string {
  let output = "";
  let cursor = 0;
  while (true) {
    const marker = source.indexOf(COMPONENTONCE_ASSET_URL_PREFIX, cursor);
    if (marker < 0) return output + source.slice(cursor);
    const reference = readAssetReference(source, marker);
    const asset = assets.get(reference.path);
    if (asset === undefined) {
      throw new TypeError(
        "ComponentOnce generated asset reference " + JSON.stringify(reference.path) + " is missing.",
      );
    }
    const url = resolveAssetUrl(asset);
    if (url.length === 0 || /[\u0000-\u0020\u007f\s"'()\\]/u.test(url)) {
      throw new TypeError(
        "Asset URL resolver returned an unsafe generated-token URL for " +
          JSON.stringify(reference.path) +
          ".",
      );
    }
    output += source.slice(cursor, marker) + url;
    cursor = reference.end;
  }
}

function readAssetReference(
  source: string,
  marker: number,
): { readonly path: string; readonly end: number } {
  let start = marker + COMPONENTONCE_ASSET_URL_PREFIX.length;
  if (source[start] === "/") start += 1;
  let end = start;
  while (end < source.length && /[A-Za-z0-9._/-]/u.test(source[end]!)) end += 1;
  const path = source.slice(start, end);
  assertSafeAssetPath(path);
  return { path, end };
}

function assertSafeAssetPath(path: string): void {
  if (
    path.length === 0 ||
    path.startsWith("/") ||
    path.endsWith("/") ||
    path.includes("\\") ||
    !/^[A-Za-z0-9._/-]+$/u.test(path) ||
    path.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new TypeError("Unsafe ComponentOnce asset path: " + JSON.stringify(path) + ".");
  }
}

function normalizePackageLimits(
  configured: ComponentOncePackageParseLimits,
): Required<ComponentOncePackageParseLimits> {
  const limits = {
    ...DEFAULT_PACKAGE_LIMITS,
    ...configured,
  } as Required<ComponentOncePackageParseLimits>;
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new TypeError(name + " must be a non-negative safe integer.");
    }
  }
  return limits;
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

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
