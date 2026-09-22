import type { AnyComponentOnceDefinition, ComponentOnceManifest } from "@componentonce/core";

/** Trusted CommonJS bundle contract emitted by ComponentOnce compiler adapters. */
export const COMPONENTONCE_TRUSTED_BUNDLE_FORMAT = "componentonce.trusted-cjs.v1" as const;
/** Legacy package-envelope identifier retained for stored-package compatibility. */
export const COMPONENTONCE_TRUSTED_PACKAGE_FORMAT_V1 = "componentonce.trusted-package.v1" as const;
/** Asset-capable package-envelope identifier emitted by current compilers. */
export const COMPONENTONCE_TRUSTED_PACKAGE_FORMAT_V2 = "componentonce.trusted-package.v2" as const;
/** Current package-envelope identifier. */
export const COMPONENTONCE_TRUSTED_PACKAGE_FORMAT = COMPONENTONCE_TRUSTED_PACKAGE_FORMAT_V2;
/** URI prefix deliberately generated for embedded asset references. */
export const COMPONENTONCE_ASSET_URL_PREFIX = "componentonce-asset:" as const;
/** Conventional named export containing the packaged definition. */
export const COMPONENTONCE_DEFAULT_DEFINITION_EXPORT = "definition" as const;

const DEFAULT_LIMITS: Required<ComponentOncePackageParseLimits> = {
  maxPackageBytes: 48 * 1024 * 1024,
  maxAssets: 256,
  maxAssetBytes: 16 * 1024 * 1024,
  maxTotalAssetBytes: 32 * 1024 * 1024,
};

/** Executable bundle facts required by the runtime. Extra compiler metadata may be present. */
export interface ComponentOnceRuntimeBundle {
  readonly format: typeof COMPONENTONCE_TRUSTED_BUNDLE_FORMAT;
  readonly code: string;
  readonly byteLength: number;
  readonly sha256: string;
  readonly integrity: string;
  readonly externalModules: readonly string[];
  readonly diagnostics?: readonly unknown[];
  readonly metafile?: unknown;
}

/** One integrity-protected file embedded in a v2 package. */
export interface ComponentOnceEmbeddedAsset {
  readonly path: string;
  readonly contentType: string;
  readonly encoding: "base64";
  readonly content: string;
  readonly byteLength: number;
  readonly sha256: string;
  readonly integrity: string;
}

/** Browser-safe view of a legacy v1 trusted package. */
export interface ComponentOnceTrustedPackageV1 {
  readonly format: typeof COMPONENTONCE_TRUSTED_PACKAGE_FORMAT_V1;
  readonly renderer: string;
  readonly manifest: ComponentOnceManifest;
  readonly definitionExport: string;
  readonly bundle: ComponentOnceRuntimeBundle;
}

/** Browser-safe view of an asset-capable v2 trusted package. */
export interface ComponentOnceTrustedPackageV2 {
  readonly format: typeof COMPONENTONCE_TRUSTED_PACKAGE_FORMAT_V2;
  readonly renderer: string;
  readonly manifest: ComponentOnceManifest;
  readonly definitionExport: string;
  readonly bundle: ComponentOnceRuntimeBundle;
  readonly assets: readonly ComponentOnceEmbeddedAsset[];
  readonly stylesheets: readonly string[];
}

/** Any trusted package envelope supported by this runtime. */
export type ComponentOnceTrustedPackage = ComponentOnceTrustedPackageV1 | ComponentOnceTrustedPackageV2;

/** Bounds applied once while parsing untyped package input. */
export interface ComponentOncePackageParseLimits {
  readonly maxPackageBytes?: number;
  readonly maxAssets?: number;
  readonly maxAssetBytes?: number;
  readonly maxTotalAssetBytes?: number;
}

/** Host-owned module values available through the trusted bundle local require function. */
export type ComponentOnceHostExternals = Readonly<Record<string, unknown>>;

/** Runtime execution options. */
export interface InstantiateTrustedComponentOptions {
  readonly externals: ComponentOnceHostExternals;
  readonly sourceName?: string;
  /** Required for v2 packages so generated asset imports receive host URLs. */
  readonly preparedAssets?: ComponentOncePreparedPackageAssets;
}

/** Calculated SHA-256 facts for one UTF-8 string or byte sequence. */
export interface ComponentOnceSha256 {
  readonly byteLength: number;
  readonly sha256: string;
  readonly integrity: string;
}

/** Integrity-checked decoded asset passed to a host URL resolver. */
export interface ComponentOnceResolvedAsset extends Omit<ComponentOnceEmbeddedAsset, "content" | "encoding"> {
  readonly bytes: Uint8Array;
}

/** Host policy that maps one embedded asset to an HTTP, content-addressed, Blob, or other URL. */
export type ComponentOnceAssetUrlResolver = (
  asset: ComponentOnceResolvedAsset,
) => string | Promise<string>;

/** Optional lifecycle callback paired with a host asset URL resolver. */
export type ComponentOnceAssetUrlReleaser = (
  asset: ComponentOnceResolvedAsset,
  url: string,
) => void;

/** Options for preparing one parsed v2 package's URL and stylesheet resources. */
export interface PrepareTrustedComponentPackageAssetsOptions {
  readonly resolveAssetUrl: ComponentOnceAssetUrlResolver;
  readonly releaseAssetUrl?: ComponentOnceAssetUrlReleaser;
}

/** One idempotent stylesheet attachment lease. */
export interface ComponentOnceStyleMount {
  /** Release this mount without affecting other mounts in the same root. */
  release(): void;
}

/** Verified package resources that can be shared by multiple mounts. */
export interface ComponentOncePreparedPackageAssets {
  /** Return the prepared host URL for one exact non-stylesheet embedded path. */
  resolveAssetUrl(path: string): string;
  /** Attach package styles once per actual Document or ShadowRoot and return a lease. */
  mountStyles(root: Document | ShadowRoot): ComponentOnceStyleMount;
  /** Stop URL reads, execution, and mounts, then release URLs after all leases end. */
  dispose(): void;
}

/** Browser Blob URL resolver with content-keyed reference counting. */
export interface ComponentOnceBrowserBlobAssetUrlResolver {
  readonly resolveAssetUrl: ComponentOnceAssetUrlResolver;
  readonly releaseAssetUrl: ComponentOnceAssetUrlReleaser;
  /** Force-revoke remaining URLs; call only after every prepared package and style lease is released. */
  dispose(): void;
}

/** Deterministic missing-external error raised before arbitrary fallback resolution can occur. */
export class ComponentOnceMissingExternalError extends Error {
  public readonly specifier: string;
  public readonly availableExternals: readonly string[];
  public constructor(specifier: string, availableExternals: readonly string[]) {
    const available = Object.freeze([...availableExternals].sort());
    super("Missing trusted bundle external " + JSON.stringify(specifier) + ". Available externals: " + (available.length === 0 ? "(none)" : available.join(", ")) + ".");
    this.name = new.target.name;
    this.specifier = specifier;
    this.availableExternals = available;
  }
}

/** Executable or embedded asset bytes do not match immutable SHA-256 metadata. */
export class ComponentOnceIntegrityError extends Error {
  public readonly path: string;
  public readonly expectedSha256: string;
  public readonly actualSha256: string;
  public constructor(expectedSha256: string, actualSha256: string, path = "bundle") {
    super(
      path === "bundle"
        ? "Trusted bundle integrity mismatch. Expected SHA-256 " +
            JSON.stringify(expectedSha256) +
            " but received " +
            JSON.stringify(actualSha256) +
            "."
        : "ComponentOnce integrity mismatch for " +
            JSON.stringify(path) +
            ". Expected SHA-256 " +
            JSON.stringify(expectedSha256) +
            " but received " +
            JSON.stringify(actualSha256) +
            ".",
    );
    this.name = new.target.name;
    this.path = path;
    this.expectedSha256 = expectedSha256;
    this.actualSha256 = actualSha256;
  }
}

/** Package metadata and executable definition identity no longer agree. */
export class ComponentOncePackageManifestMismatchError extends Error {
  public readonly packaged: ComponentOnceManifest;
  public readonly loaded: ComponentOnceManifest;
  public constructor(packaged: ComponentOnceManifest, loaded: ComponentOnceManifest) {
    super("Packaged component manifest " + JSON.stringify(packaged.id) + "@" + JSON.stringify(packaged.version) + " does not match the executable definition " + JSON.stringify(loaded.id) + "@" + JSON.stringify(loaded.version) + ".");
    this.name = new.target.name;
    this.packaged = packaged;
    this.loaded = loaded;
  }
}

/** Calculate browser/Node-neutral SHA-256 using the Web Crypto API. */
export async function calculateTrustedBundleSha256(source: string | Uint8Array): Promise<ComponentOnceSha256> {
  const bytes = typeof source === "string" ? new TextEncoder().encode(source) : source;
  const subtle = globalThis.crypto?.subtle;
  if (subtle === undefined) throw new Error("Web Crypto SHA-256 is unavailable in this runtime.");
  const exactBytes = new Uint8Array(bytes.byteLength);
  exactBytes.set(bytes);
  const digest = new Uint8Array(await subtle.digest("SHA-256", exactBytes.buffer));
  const sha256 = [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return { byteLength: bytes.byteLength, sha256, integrity: "sha256-" + encodeBase64(digest) };
}

/** Verify byte count, hexadecimal digest, and SRI digest recorded on one executable bundle. */
export async function assertTrustedBundleIntegrity(bundle: ComponentOnceRuntimeBundle): Promise<void> {
  await assertBytesIntegrity("bundle", bundle.code, bundle);
}

/** Parse and structurally validate one bounded package envelope without executing code. */
export function parseTrustedComponentPackage(
  source: string | Uint8Array,
  configuredLimits: ComponentOncePackageParseLimits = {},
): ComponentOnceTrustedPackage {
  const limits = normalizeLimits(configuredLimits);
  const packageBytes =
    typeof source === "string"
      ? boundedUtf8ByteLength(source, limits.maxPackageBytes)
      : source.byteLength;
  if (packageBytes > limits.maxPackageBytes) throw new TypeError("ComponentOnce package exceeds maxPackageBytes (" + limits.maxPackageBytes + ").");
  const text = typeof source === "string" ? source : new TextDecoder("utf-8", { fatal: true }).decode(source);
  const parsed: unknown = JSON.parse(text);
  if (!isRecord(parsed) || (parsed.format !== COMPONENTONCE_TRUSTED_PACKAGE_FORMAT_V1 && parsed.format !== COMPONENTONCE_TRUSTED_PACKAGE_FORMAT_V2)) {
    throw new TypeError("Unsupported or invalid ComponentOnce package format.");
  }
  const common = {
    renderer: requireNonEmptyString(parsed.renderer, "renderer"),
    manifest: parseManifest(parsed.manifest),
    definitionExport:
      parsed.format === COMPONENTONCE_TRUSTED_PACKAGE_FORMAT_V1 && parsed.definitionExport === undefined
        ? COMPONENTONCE_DEFAULT_DEFINITION_EXPORT
        : requireNonEmptyString(parsed.definitionExport, "definitionExport"),
    bundle: parseBundle(parsed.bundle),
  };
  if (parsed.format === COMPONENTONCE_TRUSTED_PACKAGE_FORMAT_V1) {
    return deepFreeze({ format: COMPONENTONCE_TRUSTED_PACKAGE_FORMAT_V1, ...common });
  }
  if (!Array.isArray(parsed.assets) || !Array.isArray(parsed.stylesheets)) throw new TypeError("ComponentOnce v2 package assets or stylesheets are invalid.");
  if (parsed.assets.length > limits.maxAssets) throw new TypeError("ComponentOnce package exceeds maxAssets (" + limits.maxAssets + ").");
  let totalAssetBytes = 0;
  const assets = parsed.assets.map((asset, index) => {
    const result = parseAsset(asset, index);
    if (result.byteLength > limits.maxAssetBytes) throw new TypeError("ComponentOnce asset " + JSON.stringify(result.path) + " exceeds maxAssetBytes.");
    totalAssetBytes += result.byteLength;
    if (totalAssetBytes > limits.maxTotalAssetBytes) throw new TypeError("ComponentOnce package exceeds maxTotalAssetBytes (" + limits.maxTotalAssetBytes + ").");
    return result;
  });
  if (!parsed.stylesheets.every((path) => typeof path === "string")) throw new TypeError("ComponentOnce v2 stylesheet references are invalid.");
  const stylesheets = [...parsed.stylesheets] as string[];
  validateAssetTable(common.bundle.code, assets, stylesheets);
  return deepFreeze({ format: COMPONENTONCE_TRUSTED_PACKAGE_FORMAT_V2, ...common, assets, stylesheets });
}

/** Verify executable and embedded bytes before execution or resource use. */
export async function verifyTrustedComponentPackage(componentPackage: ComponentOnceTrustedPackage): Promise<void> {
  await assertTrustedBundleIntegrity(componentPackage.bundle);
  if (componentPackage.format === COMPONENTONCE_TRUSTED_PACKAGE_FORMAT_V2) {
    for (const asset of componentPackage.assets) await assertBytesIntegrity(asset.path, decodeBase64(asset.content), asset);
  }
}

/** Prepare a v2 package's verified asset URLs and explicit stylesheet lifecycle once. */
export async function prepareTrustedComponentPackageAssets(
  componentPackage: ComponentOnceTrustedPackageV2,
  options: PrepareTrustedComponentPackageAssetsOptions,
): Promise<ComponentOncePreparedPackageAssets> {
  await verifyTrustedComponentPackage(componentPackage);
  const stylesheetPaths = new Set(componentPackage.stylesheets);
  const decoded = new Map<string, ComponentOnceResolvedAsset>();
  const urls = new Map<string, string>();
  const resolvedUrls: Array<{
    readonly asset: ComponentOnceResolvedAsset;
    readonly url: string;
  }> = [];
  let styleTexts: Array<{ readonly path: string; readonly text: string }>;
  try {
    for (const asset of componentPackage.assets) {
      const resolved: ComponentOnceResolvedAsset = Object.freeze({ path: asset.path, contentType: asset.contentType, byteLength: asset.byteLength, sha256: asset.sha256, integrity: asset.integrity, bytes: decodeBase64(asset.content) });
      decoded.set(asset.path, resolved);
      if (!stylesheetPaths.has(asset.path)) {
        const url = await options.resolveAssetUrl(resolved);
        resolvedUrls.push({ asset: resolved, url });
        assertSafeResolvedUrl(url, asset.path);
        urls.set(asset.path, url);
      }
    }
    styleTexts = componentPackage.stylesheets.map((path) => {
      const asset = decoded.get(path)!;
      return { path, text: replaceAssetReferences(new TextDecoder("utf-8", { fatal: true }).decode(asset.bytes), urls) };
    });
  } catch (error: unknown) {
    const rollbackErrors: unknown[] = [];
    for (const resolved of [...resolvedUrls].reverse()) {
      try {
        options.releaseAssetUrl?.(resolved.asset, resolved.url);
      } catch (rollbackError: unknown) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (rollbackErrors.length > 0) {
      throw new AggregateError(
        [error, ...rollbackErrors],
        "ComponentOnce asset preparation failed and one or more URL rollbacks also failed.",
        { cause: error },
      );
    }
    throw error;
  }
  const roots = new Map<Document | ShadowRoot, { count: number; nodes: HTMLStyleElement[] }>();
  let disposed = false;
  let urlsReleased = false;
  const releaseUrlsIfIdle = () => {
    if (!disposed || roots.size !== 0 || urlsReleased) return;
    urlsReleased = true;
    const releaseErrors: unknown[] = [];
    for (const resolved of resolvedUrls) {
      try {
        options.releaseAssetUrl?.(resolved.asset, resolved.url);
      } catch (error: unknown) {
        releaseErrors.push(error);
      }
    }
    resolvedUrls.length = 0;
    urls.clear();
    styleTexts = [];
    if (releaseErrors.length > 0) {
      throw new AggregateError(
        releaseErrors,
        "One or more ComponentOnce asset URLs could not be released.",
      );
    }
  };
  return Object.freeze({
    resolveAssetUrl(path: string): string {
      if (disposed) throw new Error("ComponentOnce prepared assets have been disposed.");
      const url = urls.get(path);
      if (url === undefined) throw new TypeError("No prepared ComponentOnce asset URL for " + JSON.stringify(path) + ".");
      return url;
    },
    mountStyles(root: Document | ShadowRoot): ComponentOnceStyleMount {
      if (disposed) throw new Error("ComponentOnce prepared assets have been disposed.");
      let entry = roots.get(root);
      if (entry === undefined) {
        const ownerDocument = isDocument(root) ? root : root.ownerDocument;
        const parent = isDocument(root) ? root.head ?? root.documentElement : root;
        if (parent === null) throw new TypeError("ComponentOnce stylesheet target has no attachment root.");
        const nodes: HTMLStyleElement[] = [];
        try {
          for (const stylesheet of styleTexts) {
            const node = ownerDocument.createElement("style");
            node.setAttribute("data-componentonce-style", stylesheet.path);
            node.textContent = stylesheet.text;
            nodes.push(node);
            parent.appendChild(node);
          }
        } catch (error: unknown) {
          const rollbackErrors: unknown[] = [];
          for (const node of [...nodes].reverse()) {
            try {
              node.remove();
            } catch (rollbackError: unknown) {
              rollbackErrors.push(rollbackError);
            }
          }
          if (rollbackErrors.length > 0) {
            throw new AggregateError(
              [error, ...rollbackErrors],
              "ComponentOnce stylesheet mounting failed and rollback was incomplete.",
              { cause: error },
            );
          }
          throw error;
        }
        entry = { count: 0, nodes };
        roots.set(root, entry);
      }
      entry.count += 1;
      let released = false;
      return Object.freeze({ release(): void {
        if (released) return;
        released = true;
        const current = roots.get(root);
        if (current === undefined) return;
        current.count -= 1;
        if (current.count === 0) {
          const cleanupErrors: unknown[] = [];
          for (const node of current.nodes) {
            try {
              node.remove();
            } catch (error: unknown) {
              cleanupErrors.push(error);
            }
          }
          roots.delete(root);
          try {
            releaseUrlsIfIdle();
          } catch (error: unknown) {
            cleanupErrors.push(error);
          }
          if (cleanupErrors.length > 0) {
            throw new AggregateError(
              cleanupErrors,
              "One or more ComponentOnce mounted resources could not be released.",
            );
          }
        }
      } });
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      releaseUrlsIfIdle();
    },
    [PREPARED_PACKAGE]: componentPackage,
    [PREPARED_URLS]: urls,
    [PREPARED_IS_ACTIVE]: () => !disposed,
  } as ComponentOncePreparedPackageAssets & PreparedInternals);
}

/** Create a browser Blob URL policy suitable for passing to package preparation. */
export function createBrowserBlobAssetUrlResolver(): ComponentOnceBrowserBlobAssetUrlResolver {
  const records = new Map<string, { url: string; count: number }>();
  let disposed = false;
  const resolveAssetUrl: ComponentOnceAssetUrlResolver = (asset) => {
    if (disposed) throw new Error("ComponentOnce Blob URL resolver has been disposed.");
    const key = asset.sha256 + "\0" + asset.contentType;
    let record = records.get(key);
    if (record === undefined) {
      const exactBytes = new Uint8Array(asset.bytes.byteLength);
      exactBytes.set(asset.bytes);
      record = { url: URL.createObjectURL(new Blob([exactBytes.buffer], { type: asset.contentType })), count: 0 };
      records.set(key, record);
    }
    record.count += 1;
    return record.url;
  };
  const releaseAssetUrl: ComponentOnceAssetUrlReleaser = (asset, url) => {
    const key = asset.sha256 + "\0" + asset.contentType;
    const record = records.get(key);
    if (record === undefined || record.url !== url) return;
    record.count -= 1;
    if (record.count === 0) { URL.revokeObjectURL(record.url); records.delete(key); }
  };
  return Object.freeze({ resolveAssetUrl, releaseAssetUrl, dispose(): void {
    if (disposed) return;
    disposed = true;
    for (const record of records.values()) URL.revokeObjectURL(record.url);
    records.clear();
  } });
}

/** Instantiate one verified trusted package with explicit host externals and prepared v2 assets. */
export async function instantiateTrustedComponentPackage<TDefinition extends AnyComponentOnceDefinition = AnyComponentOnceDefinition>(
  componentPackage: ComponentOnceTrustedPackage,
  options: InstantiateTrustedComponentOptions,
): Promise<TDefinition> {
  let code = componentPackage.bundle.code;
  if (componentPackage.format === COMPONENTONCE_TRUSTED_PACKAGE_FORMAT_V2) {
    const prepared = options.preparedAssets as (ComponentOncePreparedPackageAssets & Partial<PreparedInternals>) | undefined;
    if (
      prepared?.[PREPARED_PACKAGE] !== componentPackage ||
      prepared[PREPARED_URLS] === undefined ||
      prepared[PREPARED_IS_ACTIVE]?.() !== true
    ) throw new TypeError("This v2 ComponentOnce package must be instantiated with live assets prepared from the same parsed package object.");
    code = replaceAssetReferences(code, prepared[PREPARED_URLS]);
  } else {
    await verifyTrustedComponentPackage(componentPackage);
  }
  const exports = instantiateCommonJs(code, options);
  const definition = isRecord(exports) ? exports[componentPackage.definitionExport] : undefined;
  if (!isDefinition(definition)) throw new TypeError("Trusted package export " + JSON.stringify(componentPackage.definitionExport) + " is not a ComponentOnce definition.");
  if (!sameManifest(componentPackage.manifest, definition.manifest)) throw new ComponentOncePackageManifestMismatchError(componentPackage.manifest, definition.manifest);
  return definition as TDefinition;
}

const PREPARED_PACKAGE: unique symbol = Symbol("ComponentOnce prepared package");
const PREPARED_URLS: unique symbol = Symbol("ComponentOnce prepared URLs");
const PREPARED_IS_ACTIVE: unique symbol = Symbol("ComponentOnce prepared assets are active");
interface PreparedInternals {
  readonly [PREPARED_PACKAGE]: ComponentOnceTrustedPackageV2;
  readonly [PREPARED_URLS]: ReadonlyMap<string, string>;
  readonly [PREPARED_IS_ACTIVE]: () => boolean;
}

function instantiateCommonJs(code: string, options: InstantiateTrustedComponentOptions): unknown {
  const availableExternals = Object.keys(options.externals).sort();
  const trustedRequire = (specifier: string): unknown => {
    if (!Object.prototype.hasOwnProperty.call(options.externals, specifier)) throw new ComponentOnceMissingExternalError(specifier, availableExternals);
    return options.externals[specifier];
  };
  const commonJsModule: { exports: unknown } = { exports: {} };
  const sourceName = sanitizeSourceName(options.sourceName ?? "componentonce-trusted-runtime.js");
  const evaluate = new Function("module", "exports", "require", '"use strict";\n' + code + "\n//# sourceURL=" + sourceName) as (module: { exports: unknown }, exports: unknown, require: typeof trustedRequire) => void;
  evaluate(commonJsModule, commonJsModule.exports, trustedRequire);
  return commonJsModule.exports;
}

function parseBundle(value: unknown): ComponentOnceRuntimeBundle {
  if (!isRecord(value) || value.format !== COMPONENTONCE_TRUSTED_BUNDLE_FORMAT || typeof value.code !== "string" || !isNonNegativeSafeInteger(value.byteLength) || typeof value.sha256 !== "string" || !/^[0-9a-f]{64}$/u.test(value.sha256) || typeof value.integrity !== "string" || !/^sha256-[A-Za-z0-9+/]+={0,2}$/u.test(value.integrity) || !Array.isArray(value.externalModules) || !value.externalModules.every((item) => typeof item === "string")) throw new TypeError("ComponentOnce package bundle metadata is invalid.");
  return { format: COMPONENTONCE_TRUSTED_BUNDLE_FORMAT, code: value.code, byteLength: value.byteLength as number, sha256: value.sha256, integrity: value.integrity, externalModules: Object.freeze([...value.externalModules]), ...(Array.isArray(value.diagnostics) ? { diagnostics: Object.freeze([...value.diagnostics]) } : {}), ...(value.metafile === undefined ? {} : { metafile: value.metafile }) };
}

function parseAsset(value: unknown, index: number): ComponentOnceEmbeddedAsset {
  if (!isRecord(value) || typeof value.path !== "string" || typeof value.contentType !== "string" || value.encoding !== "base64" || typeof value.content !== "string" || !isNonNegativeSafeInteger(value.byteLength) || typeof value.sha256 !== "string" || !/^[0-9a-f]{64}$/u.test(value.sha256) || typeof value.integrity !== "string" || !/^sha256-[A-Za-z0-9+/]+={0,2}$/u.test(value.integrity)) throw new TypeError("ComponentOnce asset at index " + index + " is malformed.");
  assertSafeAssetPath(value.path);
  const decodedByteLength = decodedBase64ByteLength(value.content);
  if (decodedByteLength !== value.byteLength) throw new TypeError("ComponentOnce asset " + JSON.stringify(value.path) + " byteLength does not match its bytes.");
  return Object.freeze({ path: value.path, contentType: requireContentType(value.contentType), encoding: "base64", content: value.content, byteLength: value.byteLength as number, sha256: value.sha256, integrity: value.integrity });
}

function requireContentType(value: string): string {
  if (value.trim() === "" || value !== value.trim() || /[\u0000-\u001f\u007f]/u.test(value)) throw new TypeError("asset.contentType must be a non-empty printable string.");
  return value;
}

function validateAssetTable(bundleCode: string, assets: readonly ComponentOnceEmbeddedAsset[], stylesheets: readonly string[]): void {
  const byPath = new Map<string, ComponentOnceEmbeddedAsset>();
  let previous: string | undefined;
  for (const asset of assets) {
    if (byPath.has(asset.path)) throw new TypeError("Duplicate ComponentOnce asset path: " + JSON.stringify(asset.path) + ".");
    if (previous !== undefined && compareStrings(previous, asset.path) > 0) throw new TypeError("ComponentOnce assets must be sorted by path.");
    byPath.set(asset.path, asset);
    previous = asset.path;
  }
  const seenStylesheets = new Set<string>();
  previous = undefined;
  for (const path of stylesheets) {
    assertSafeAssetPath(path);
    if (seenStylesheets.has(path)) throw new TypeError("Duplicate ComponentOnce stylesheet reference: " + JSON.stringify(path) + ".");
    if (previous !== undefined && compareStrings(previous, path) > 0) throw new TypeError("ComponentOnce stylesheets must be sorted by path.");
    const asset = byPath.get(path);
    if (asset === undefined || asset.contentType !== "text/css") throw new TypeError("ComponentOnce stylesheet " + JSON.stringify(path) + " must reference an embedded text/css asset.");
    seenStylesheets.add(path);
    previous = path;
  }
  validateReferences(bundleCode, byPath);
  for (const path of stylesheets) validateReferences(new TextDecoder("utf-8", { fatal: true }).decode(decodeBase64(byPath.get(path)!.content)), byPath);
}

function validateReferences(source: string, assets: ReadonlyMap<string, ComponentOnceEmbeddedAsset>): void {
  for (const path of collectAssetReferences(source)) if (!assets.has(path)) throw new TypeError("ComponentOnce generated asset reference " + JSON.stringify(path) + " is missing.");
}

function replaceAssetReferences(source: string, urls: ReadonlyMap<string, string>): string {
  let output = "";
  let cursor = 0;
  while (true) {
    const marker = source.indexOf(COMPONENTONCE_ASSET_URL_PREFIX, cursor);
    if (marker < 0) return output + source.slice(cursor);
    const reference = readAssetReference(source, marker);
    const url = urls.get(reference.path);
    if (url === undefined) throw new TypeError("No prepared ComponentOnce asset URL for " + JSON.stringify(reference.path) + ".");
    output += source.slice(cursor, marker) + url;
    cursor = reference.end;
  }
}

function collectAssetReferences(source: string): string[] {
  const references = new Set<string>();
  let offset = 0;
  while (true) {
    const marker = source.indexOf(COMPONENTONCE_ASSET_URL_PREFIX, offset);
    if (marker < 0) return [...references];
    const reference = readAssetReference(source, marker);
    references.add(reference.path);
    offset = reference.end;
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
  if (path.length === 0 || path.startsWith("/") || path.endsWith("/") || path.includes("\\") || !/^[A-Za-z0-9._/-]+$/u.test(path) || path.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) throw new TypeError("Unsafe ComponentOnce asset path: " + JSON.stringify(path) + ".");
}

function assertSafeResolvedUrl(url: string, path: string): void {
  if (typeof url !== "string" || url.length === 0 || /[\u0000-\u0020\u007f\s"'()\\]/u.test(url)) throw new TypeError("Asset URL resolver returned an unsafe generated-token URL for " + JSON.stringify(path) + ".");
}

async function assertBytesIntegrity(path: string, bytes: string | Uint8Array, expected: { readonly byteLength: number; readonly sha256: string; readonly integrity: string }): Promise<void> {
  const calculated = await calculateTrustedBundleSha256(bytes);
  if (calculated.byteLength !== expected.byteLength || calculated.sha256 !== expected.sha256 || calculated.integrity !== expected.integrity) throw new ComponentOnceIntegrityError(expected.sha256, calculated.sha256, path);
}

function normalizeLimits(configured: ComponentOncePackageParseLimits): Required<ComponentOncePackageParseLimits> {
  const result = { ...DEFAULT_LIMITS, ...configured } as Required<ComponentOncePackageParseLimits>;
  for (const [name, value] of Object.entries(result)) if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(name + " must be a non-negative safe integer.");
  return result;
}

function parseManifest(value: unknown): ComponentOnceManifest {
  if (!isRecord(value)) throw new TypeError("ComponentOnce package manifest is invalid.");
  const id = requireNonEmptyString(value.id, "manifest.id");
  const version = requireNonEmptyString(value.version, "manifest.version");
  const displayName = value.displayName === undefined ? undefined : requireNonEmptyString(value.displayName, "manifest.displayName");
  let requirements: readonly { readonly name: string; readonly version: string }[] | undefined;
  if (value.requirements !== undefined) {
    if (!Array.isArray(value.requirements)) throw new TypeError("ComponentOnce manifest requirements are invalid.");
    requirements = Object.freeze(value.requirements.map((requirement) => {
      if (!isRecord(requirement)) throw new TypeError("ComponentOnce manifest requirement is invalid.");
      return Object.freeze({ name: requireNonEmptyString(requirement.name, "requirement.name"), version: requireNonEmptyString(requirement.version, "requirement.version") });
    }));
  }
  return Object.freeze({ id, version, ...(displayName === undefined ? {} : { displayName }), ...(requirements === undefined ? {} : { requirements }) });
}

function sameManifest(left: ComponentOnceManifest, right: ComponentOnceManifest): boolean {
  return JSON.stringify(normalizeManifest(left)) === JSON.stringify(normalizeManifest(right));
}
function normalizeManifest(manifest: ComponentOnceManifest): ComponentOnceManifest {
  return { id: manifest.id, version: manifest.version, ...(manifest.displayName === undefined ? {} : { displayName: manifest.displayName }), ...(manifest.requirements === undefined ? {} : { requirements: manifest.requirements.map((requirement) => ({ name: requirement.name, version: requirement.version })) }) };
}
function isDefinition(value: unknown): value is AnyComponentOnceDefinition {
  return isRecord(value) && isRecord(value.manifest) && typeof value.manifest.id === "string" && typeof value.manifest.version === "string" && "implementation" in value;
}
function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim() || /[\0\r\n]/u.test(value)) throw new TypeError(label + " must be a non-empty stable string.");
  return value;
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function isNonNegativeSafeInteger(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) >= 0; }
function isDocument(root: Document | ShadowRoot): root is Document { return root.nodeType === 9; }
function sanitizeSourceName(value: string): string { return value.replace(/[\r\n\u2028\u2029]/gu, "_"); }

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BASE64_REVERSE = (() => {
  const table = new Int8Array(128).fill(-1);
  for (let index = 0; index < BASE64_ALPHABET.length; index += 1) {
    table[BASE64_ALPHABET.charCodeAt(index)] = index;
  }
  return table;
})();

function decodeBase64(value: string): Uint8Array {
  const decodedLength = decodedBase64ByteLength(value);
  const bytes = new Uint8Array(decodedLength);
  let output = 0;
  for (let index = 0; index < value.length; index += 4) {
    const combined =
      (BASE64_REVERSE[value.charCodeAt(index)]! << 18) |
      (BASE64_REVERSE[value.charCodeAt(index + 1)]! << 12) |
      ((value[index + 2] === "=" ? 0 : BASE64_REVERSE[value.charCodeAt(index + 2)]!) << 6) |
      (value[index + 3] === "=" ? 0 : BASE64_REVERSE[value.charCodeAt(index + 3)]!);
    if (output < bytes.length) bytes[output++] = (combined >> 16) & 255;
    if (output < bytes.length) bytes[output++] = (combined >> 8) & 255;
    if (output < bytes.length) bytes[output++] = combined & 255;
  }
  return bytes;
}

function decodedBase64ByteLength(value: string): number {
  if (value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) throw new TypeError("ComponentOnce asset content is not canonical base64.");
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return (value.length / 4) * 3 - padding;
}

function boundedUtf8ByteLength(value: string, maximum: number): number {
  let byteLength = 0;
  for (let index = 0; index < value.length; index += 1) {
    const first = value.charCodeAt(index);
    if (first <= 0x7f) {
      byteLength += 1;
    } else if (first <= 0x7ff) {
      byteLength += 2;
    } else if (
      first >= 0xd800 &&
      first <= 0xdbff &&
      index + 1 < value.length &&
      value.charCodeAt(index + 1) >= 0xdc00 &&
      value.charCodeAt(index + 1) <= 0xdfff
    ) {
      byteLength += 4;
      index += 1;
    } else {
      byteLength += 3;
    }
    if (byteLength > maximum) return byteLength;
  }
  return byteLength;
}

function encodeBase64(bytes: Uint8Array): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index]!;
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    const combined = (first << 16) | ((second ?? 0) << 8) | (third ?? 0);
    output += alphabet[(combined >> 18) & 63]!;
    output += alphabet[(combined >> 12) & 63]!;
    output += second === undefined ? "=" : alphabet[(combined >> 6) & 63]!;
    output += third === undefined ? "=" : alphabet[combined & 63]!;
  }
  return output;
}
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
