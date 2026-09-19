import type {
  AnyComponentOnceDefinition,
  ComponentOnceManifest,
} from "@componentonce/core";

/** Trusted CommonJS bundle contract emitted by ComponentOnce compiler adapters. */
export const COMPONENTONCE_TRUSTED_BUNDLE_FORMAT =
  "componentonce.trusted-cjs.v1" as const;

/** Self-describing trusted package envelope understood by ComponentOnce hosts. */
export const COMPONENTONCE_TRUSTED_PACKAGE_FORMAT =
  "componentonce.trusted-package.v1" as const;

/** Conventional named export containing the packaged definition. */
export const COMPONENTONCE_DEFAULT_DEFINITION_EXPORT = "definition" as const;

/** Executable bundle facts required by the runtime. Extra compiler metadata may also be present. */
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

/** Browser-safe view of one self-describing trusted component package. */
export interface ComponentOnceTrustedPackage {
  readonly format: typeof COMPONENTONCE_TRUSTED_PACKAGE_FORMAT;
  readonly renderer: string;
  readonly manifest: ComponentOnceManifest;
  readonly definitionExport: string;
  readonly bundle: ComponentOnceRuntimeBundle;
}

/** Host-owned module values available through the trusted bundle local require function. */
export type ComponentOnceHostExternals = Readonly<Record<string, unknown>>;

/** Runtime execution options. */
export interface InstantiateTrustedComponentOptions {
  readonly externals: ComponentOnceHostExternals;
  readonly sourceName?: string;
}

/** Calculated SHA-256 facts for one UTF-8 string or byte sequence. */
export interface ComponentOnceSha256 {
  readonly byteLength: number;
  readonly sha256: string;
  readonly integrity: string;
}

/** Deterministic missing-external error raised before arbitrary fallback resolution can occur. */
export class ComponentOnceMissingExternalError extends Error {
  public readonly specifier: string;
  public readonly availableExternals: readonly string[];

  public constructor(specifier: string, availableExternals: readonly string[]) {
    const available = Object.freeze([...availableExternals].sort());
    super(
      "Missing trusted bundle external " +
        JSON.stringify(specifier) +
        ". Available externals: " +
        (available.length === 0 ? "(none)" : available.join(", ")) +
        ".",
    );
    this.name = new.target.name;
    this.specifier = specifier;
    this.availableExternals = available;
  }
}

/** Bundle bytes do not match the package immutable SHA-256 metadata. */
export class ComponentOnceIntegrityError extends Error {
  public readonly expectedSha256: string;
  public readonly actualSha256: string;

  public constructor(expectedSha256: string, actualSha256: string) {
    super(
      "Trusted bundle integrity mismatch. Expected SHA-256 " +
        JSON.stringify(expectedSha256) +
        " but received " +
        JSON.stringify(actualSha256) +
        ".",
    );
    this.name = new.target.name;
    this.expectedSha256 = expectedSha256;
    this.actualSha256 = actualSha256;
  }
}

/** Package metadata and executable definition identity no longer agree. */
export class ComponentOncePackageManifestMismatchError extends Error {
  public readonly packaged: ComponentOnceManifest;
  public readonly loaded: ComponentOnceManifest;

  public constructor(
    packaged: ComponentOnceManifest,
    loaded: ComponentOnceManifest,
  ) {
    super(
      "Packaged component manifest " +
        JSON.stringify(packaged.id) +
        "@" +
        JSON.stringify(packaged.version) +
        " does not match the executable definition " +
        JSON.stringify(loaded.id) +
        "@" +
        JSON.stringify(loaded.version) +
        ".",
    );
    this.name = new.target.name;
    this.packaged = packaged;
    this.loaded = loaded;
  }
}

/** Calculate browser/Node-neutral SHA-256 using the Web Crypto API. */
export async function calculateTrustedBundleSha256(
  source: string | Uint8Array,
): Promise<ComponentOnceSha256> {
  const bytes =
    typeof source === "string" ? new TextEncoder().encode(source) : source;
  const subtle = globalThis.crypto?.subtle;
  if (subtle === undefined) {
    throw new Error("Web Crypto SHA-256 is unavailable in this runtime.");
  }
  const exactBytes = new Uint8Array(bytes.byteLength);
  exactBytes.set(bytes);
  const digest = new Uint8Array(
    await subtle.digest("SHA-256", exactBytes.buffer),
  );
  const sha256 = [...digest]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return {
    byteLength: bytes.byteLength,
    sha256,
    integrity: "sha256-" + encodeBase64(digest),
  };
}

/** Verify byte count, hexadecimal digest, and SRI digest recorded on one executable bundle. */
export async function assertTrustedBundleIntegrity(
  bundle: ComponentOnceRuntimeBundle,
): Promise<void> {
  const calculated = await calculateTrustedBundleSha256(bundle.code);
  if (
    calculated.byteLength !== bundle.byteLength ||
    calculated.sha256 !== bundle.sha256 ||
    calculated.integrity !== bundle.integrity
  ) {
    throw new ComponentOnceIntegrityError(bundle.sha256, calculated.sha256);
  }
}

/** Parse one package envelope structurally without executing its code. */
export function parseTrustedComponentPackage(
  source: string | Uint8Array,
): ComponentOnceTrustedPackage {
  const text =
    typeof source === "string"
      ? source
      : new TextDecoder("utf-8", { fatal: true }).decode(source);
  const parsed: unknown = JSON.parse(text);
  if (!isRecord(parsed) || parsed.format !== COMPONENTONCE_TRUSTED_PACKAGE_FORMAT) {
    throw new TypeError("Unsupported or invalid ComponentOnce package format.");
  }
  const renderer = requireNonEmptyString(parsed.renderer, "renderer");
  const definitionExport = requireNonEmptyString(
    parsed.definitionExport,
    "definitionExport",
  );
  const manifest = parseManifest(parsed.manifest);
  const bundle = parseBundle(parsed.bundle);
  return deepFreeze({
    format: COMPONENTONCE_TRUSTED_PACKAGE_FORMAT,
    renderer,
    manifest,
    definitionExport,
    bundle,
  });
}

/** Verify one parsed trusted package before any executable code runs. */
export async function verifyTrustedComponentPackage(
  componentPackage: ComponentOnceTrustedPackage,
): Promise<void> {
  await assertTrustedBundleIntegrity(componentPackage.bundle);
}

/**
 * Instantiate one trusted package with explicit host externals.
 *
 * This deliberately uses new Function and is NOT a sandbox. Only trusted internal code belongs here.
 */
export async function instantiateTrustedComponentPackage<
  TDefinition extends AnyComponentOnceDefinition = AnyComponentOnceDefinition,
>(
  componentPackage: ComponentOnceTrustedPackage,
  options: InstantiateTrustedComponentOptions,
): Promise<TDefinition> {
  await verifyTrustedComponentPackage(componentPackage);
  const exports = instantiateCommonJs(componentPackage.bundle.code, options);
  const definition = isRecord(exports)
    ? exports[componentPackage.definitionExport]
    : undefined;
  if (!isDefinition(definition)) {
    throw new TypeError(
      "Trusted package export " +
        JSON.stringify(componentPackage.definitionExport) +
        " is not a ComponentOnce definition.",
    );
  }
  if (!sameManifest(componentPackage.manifest, definition.manifest)) {
    throw new ComponentOncePackageManifestMismatchError(
      componentPackage.manifest,
      definition.manifest,
    );
  }
  return definition as TDefinition;
}

function instantiateCommonJs(
  code: string,
  options: InstantiateTrustedComponentOptions,
): unknown {
  const availableExternals = Object.keys(options.externals).sort();
  const trustedRequire = (specifier: string): unknown => {
    if (!Object.prototype.hasOwnProperty.call(options.externals, specifier)) {
      throw new ComponentOnceMissingExternalError(
        specifier,
        availableExternals,
      );
    }
    return options.externals[specifier];
  };
  const commonJsModule: { exports: unknown } = { exports: {} };
  const sourceName = sanitizeSourceName(
    options.sourceName ?? "componentonce-trusted-runtime.js",
  );
  const evaluate = new Function(
    "module",
    "exports",
    "require",
    '"use strict";\n' + code + "\n//# sourceURL=" + sourceName,
  ) as (
    module: { exports: unknown },
    exports: unknown,
    require: typeof trustedRequire,
  ) => void;
  evaluate(commonJsModule, commonJsModule.exports, trustedRequire);
  return commonJsModule.exports;
}

function parseBundle(value: unknown): ComponentOnceRuntimeBundle {
  if (
    !isRecord(value) ||
    value.format !== COMPONENTONCE_TRUSTED_BUNDLE_FORMAT ||
    typeof value.code !== "string" ||
    !Number.isSafeInteger(value.byteLength) ||
    (value.byteLength as number) < 0 ||
    typeof value.sha256 !== "string" ||
    !/^[0-9a-f]{64}$/u.test(value.sha256) ||
    typeof value.integrity !== "string" ||
    !value.integrity.startsWith("sha256-") ||
    !Array.isArray(value.externalModules) ||
    !value.externalModules.every((item) => typeof item === "string")
  ) {
    throw new TypeError("ComponentOnce package bundle metadata is invalid.");
  }
  const externalModules = Object.freeze([...value.externalModules]);
  return {
    format: COMPONENTONCE_TRUSTED_BUNDLE_FORMAT,
    code: value.code,
    byteLength: value.byteLength as number,
    sha256: value.sha256,
    integrity: value.integrity,
    externalModules,
    ...(Array.isArray(value.diagnostics)
      ? { diagnostics: Object.freeze([...value.diagnostics]) }
      : {}),
    ...("metafile" in value ? { metafile: value.metafile } : {}),
  };
}

function parseManifest(value: unknown): ComponentOnceManifest {
  if (!isRecord(value)) {
    throw new TypeError("ComponentOnce package manifest is invalid.");
  }
  const id = requireNonEmptyString(value.id, "manifest.id");
  const version = requireNonEmptyString(value.version, "manifest.version");
  const displayName =
    value.displayName === undefined
      ? undefined
      : requireNonEmptyString(value.displayName, "manifest.displayName");
  let requirements:
    | readonly { readonly name: string; readonly version: string }[]
    | undefined;
  if (value.requirements !== undefined) {
    if (!Array.isArray(value.requirements)) {
      throw new TypeError("ComponentOnce manifest requirements are invalid.");
    }
    requirements = Object.freeze(
      value.requirements.map((requirement) => {
        if (!isRecord(requirement)) {
          throw new TypeError("ComponentOnce manifest requirement is invalid.");
        }
        return Object.freeze({
          name: requireNonEmptyString(requirement.name, "requirement.name"),
          version: requireNonEmptyString(
            requirement.version,
            "requirement.version",
          ),
        });
      }),
    );
  }
  return Object.freeze({
    id,
    version,
    ...(displayName === undefined ? {} : { displayName }),
    ...(requirements === undefined ? {} : { requirements }),
  });
}

function sameManifest(
  left: ComponentOnceManifest,
  right: ComponentOnceManifest,
): boolean {
  return JSON.stringify(normalizeManifest(left)) ===
    JSON.stringify(normalizeManifest(right));
}

function normalizeManifest(manifest: ComponentOnceManifest): ComponentOnceManifest {
  return {
    id: manifest.id,
    version: manifest.version,
    ...(manifest.displayName === undefined
      ? {}
      : { displayName: manifest.displayName }),
    ...(manifest.requirements === undefined
      ? {}
      : {
          requirements: manifest.requirements.map((requirement) => ({
            name: requirement.name,
            version: requirement.version,
          })),
        }),
  };
}

function isDefinition(value: unknown): value is AnyComponentOnceDefinition {
  return (
    isRecord(value) &&
    isRecord(value.manifest) &&
    typeof value.manifest.id === "string" &&
    typeof value.manifest.version === "string" &&
    "implementation" in value
  );
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value !== value.trim() ||
    value.includes("\0") ||
    value.includes("\n") ||
    value.includes("\r")
  ) {
    throw new TypeError(label + " must be a non-empty stable string.");
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeSourceName(value: string): string {
  return value.replace(/[\r\n\u2028\u2029]/gu, "_");
}

function encodeBase64(bytes: Uint8Array): string {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index]!;
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    const combined =
      (first << 16) |
      ((second ?? 0) << 8) |
      (third ?? 0);
    output += alphabet[(combined >> 18) & 63]!;
    output += alphabet[(combined >> 12) & 63]!;
    output += second === undefined ? "=" : alphabet[(combined >> 6) & 63]!;
    output += third === undefined ? "=" : alphabet[combined & 63]!;
  }
  return output;
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
