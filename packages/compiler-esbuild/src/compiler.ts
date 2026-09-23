import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  relative,
  resolve,
} from "node:path";
import {
  build,
  context as createBuildContext,
  type BuildFailure,
  type Loader,
  type Message,
  type Metafile,
  type OutputFile,
  type Plugin,
} from "esbuild";

/** Stable identifier for the trusted CommonJS bundle contract emitted by this package. */
export const COMPONENTONCE_TRUSTED_BUNDLE_FORMAT = "componentonce.trusted-cjs.v1" as const;

/** URI prefix deliberately emitted by esbuild for packaged asset references. */
export const COMPONENTONCE_ASSET_URL_PREFIX = "componentonce-asset:" as const;

const DEFAULT_SOURCE_FILE_NAME = "componentonce-module.ts";
const DEFAULT_REACT_SOURCE_FILE_NAME = "componentonce-module.tsx";
const DEFAULT_EVALUATED_SOURCE_NAME = "componentonce-trusted-bundle.js";
const REACT_EXTERNALS = ["react", "react/jsx-runtime", "react/jsx-dev-runtime"] as const;
const OUTPUT_DIRECTORY_NAME = ".componentonce-output";
const DEFAULT_FILE_LOADERS: Readonly<Record<string, ComponentOnceAdditionalLoader>> = {
  ".avif": "file",
  ".bmp": "file",
  ".eot": "file",
  ".gif": "file",
  ".ico": "file",
  ".jpeg": "file",
  ".jpg": "file",
  ".otf": "file",
  ".png": "file",
  ".svg": "file",
  ".ttf": "file",
  ".wasm": "file",
  ".webp": "file",
  ".woff": "file",
  ".woff2": "file",
};

/** Source syntaxes accepted by the trusted compiler. */
export type ComponentOnceSourceLoader = "js" | "jsx" | "ts" | "tsx";

/** JSX transform mode forwarded to esbuild by the generic compiler. */
export type ComponentOnceJsxMode = "transform" | "preserve" | "automatic";

/** esbuild loaders callers may assign to additional relative source-file extensions. */
export type ComponentOnceAdditionalLoader =
  | "base64"
  | "binary"
  | "css"
  | "dataurl"
  | "file"
  | "global-css"
  | "json"
  | "local-css"
  | "text";

/** One immutable file emitted alongside the executable bundle. */
export interface ComponentOnceCompiledAsset {
  /** Safe normalized path used by generated asset references. */
  readonly path: string;
  /** Media type exposed to URL resolvers and style consumers. */
  readonly contentType: string;
  /** Portable byte encoding used by the package envelope. */
  readonly encoding: "base64";
  /** Exact emitted bytes encoded as canonical base64. */
  readonly content: string;
  /** Exact decoded byte length. */
  readonly byteLength: number;
  /** Lowercase hexadecimal SHA-256 digest. */
  readonly sha256: string;
  /** Subresource-integrity-style SHA-256 digest. */
  readonly integrity: string;
}

/** Input for compiling one trusted JavaScript or TypeScript module. */
export interface ComponentOnceCompileInput {
  /** TypeScript, TSX, JavaScript, or JSX module source. */
  readonly source: string;
  /** Stable diagnostic/source-map name; absolute inputs are reduced to their basename. */
  readonly sourceFileName?: string;
  /** Explicit source syntax, otherwise inferred from sourceFileName. */
  readonly loader?: ComponentOnceSourceLoader;
  /** Directory used to resolve and bundle relative imports from the in-memory entry source. */
  readonly resolveDir?: string;
  /** Exact import specifiers the host will inject during instantiation. */
  readonly externalModules?: readonly string[];
  /** JSX transform mode; generic compilation defaults to transform. */
  readonly jsx?: ComponentOnceJsxMode;
  /** Additional extension-to-loader rules; common web images and fonts default to `file`. */
  readonly loaders?: Readonly<Record<string, ComponentOnceAdditionalLoader>>;
  /** Optional extension-to-content-type overrides for emitted file-loader assets. */
  readonly contentTypes?: Readonly<Record<string, string>>;
}

/** React convenience compiler input; React externals are supplied by the wrapper. */
export interface ComponentOnceReactCompileInput {
  readonly source: string;
  readonly sourceFileName?: string;
  readonly loader?: ComponentOnceSourceLoader;
  /** Directory used to resolve and bundle relative imports from the in-memory entry source. */
  readonly resolveDir?: string;
  /** Additional non-React host externals. */
  readonly additionalExternalModules?: readonly string[];
  /** Additional extension-to-loader rules; common web images and fonts default to `file`. */
  readonly loaders?: Readonly<Record<string, ComponentOnceAdditionalLoader>>;
  /** Optional extension-to-content-type overrides for emitted file-loader assets. */
  readonly contentTypes?: Readonly<Record<string, string>>;
}

/** Source location attached to a normalized compiler diagnostic. */
export interface ComponentOnceDiagnosticLocation {
  /** Source file name supplied to the compiler. */
  readonly file: string;
  /** One-based source line. */
  readonly line: number;
  /** Zero-based source column. */
  readonly column: number;
  /** Length of the highlighted source range. */
  readonly length: number;
  /** Full source line associated with the diagnostic. */
  readonly lineText: string;
}

/** Secondary explanatory note attached to a compiler diagnostic. */
export interface ComponentOnceDiagnosticNote {
  /** Human-readable note. */
  readonly text: string;
  /** Source location when esbuild can identify one. */
  readonly location?: ComponentOnceDiagnosticLocation;
}

/** Storage-neutral compiler warning or error. */
export interface ComponentOnceDiagnostic {
  /** Diagnostic severity. */
  readonly kind: "error" | "warning";
  /** Human-readable diagnostic text. */
  readonly text: string;
  /** Primary source location when available. */
  readonly location?: ComponentOnceDiagnosticLocation;
  /** Supporting notes supplied by esbuild. */
  readonly notes: readonly ComponentOnceDiagnosticNote[];
}

/** Read-only esbuild metadata describing the emitted bundle and its external imports. */
export type ComponentOnceBundleMetafile = Readonly<Metafile>;

/** Integrity-protected executable bundle fields persisted in package envelopes. */
export interface ComponentOnceTrustedBundle {
  /** Bundle contract understood by `instantiateTrustedBundle`. */
  readonly format: typeof COMPONENTONCE_TRUSTED_BUNDLE_FORMAT;
  /** Executable CommonJS bundle text. */
  readonly code: string;
  /** UTF-8 byte length of `code`. */
  readonly byteLength: number;
  /** Lowercase hexadecimal SHA-256 digest of `code`. */
  readonly sha256: string;
  /** Subresource-integrity-style SHA-256 value for `code`. */
  readonly integrity: string;
  /** Exact external module specifiers referenced by the emitted bundle. */
  readonly externalModules: readonly string[];
  /** Normalized non-fatal compiler diagnostics. */
  readonly diagnostics: readonly ComponentOnceDiagnostic[];
  /** esbuild metadata for dependency and output inspection. */
  readonly metafile: ComponentOnceBundleMetafile;
}

/** Immutable, storage-neutral output of the trusted module compiler. */
export interface ComponentOnceTrustedBundleArtifact extends ComponentOnceTrustedBundle {
  /** Every non-JavaScript output emitted by esbuild, sorted by path. */
  readonly assets: readonly ComponentOnceCompiledAsset[];
  /** Sorted asset paths that contain CSS gathered from the JavaScript entry point. */
  readonly stylesheets: readonly string[];
}

/** Compilation failure with stable, normalized esbuild diagnostics. */
export class ComponentOnceCompileError extends Error {
  /** Compiler errors that caused the build to fail. */
  readonly diagnostics: readonly ComponentOnceDiagnostic[];

  constructor(diagnostics: readonly ComponentOnceDiagnostic[]) {
    super(formatCompileErrorMessage(diagnostics));
    this.name = "ComponentOnceCompileError";
    this.diagnostics = Object.freeze([...diagnostics]);
  }
}

/** Exact host-owned module values exposed to a trusted bundle's local `require`. */
export type ComponentOnceHostExternals = Readonly<Record<string, unknown>>;

/** JavaScript text, UTF-8 bytes, or an in-memory artifact accepted by the trusted evaluator. */
export type ComponentOnceTrustedBundleSource =
  | string
  | Uint8Array
  | ComponentOnceTrustedBundle;

/** Options controlling explicit external injection and optional integrity verification. */
export interface InstantiateTrustedBundleOptions {
  /** Exact external values, including the host's React and JSX runtime instances. */
  readonly externals: ComponentOnceHostExternals;
  /** Expected integrity for separately loaded text/bytes; artifacts verify their own value by default. */
  readonly expectedIntegrity?: string;
  /** Debugger-only source name appended to the evaluated bundle. */
  readonly sourceName?: string;
}

/** Deterministic error raised when a bundle requests an external the host did not inject. */
export class ComponentOnceMissingExternalError extends Error {
  /** Exact module specifier requested by the bundle. */
  readonly specifier: string;
  /** Sorted external specifiers supplied by the host. */
  readonly availableExternals: readonly string[];

  constructor(specifier: string, availableExternals: readonly string[]) {
    const sortedExternals = Object.freeze([...availableExternals].sort());
    const available = sortedExternals.length === 0 ? "(none)" : sortedExternals.join(", ");
    super(`Missing trusted bundle external "${specifier}". Available externals: ${available}.`);
    this.name = "ComponentOnceMissingExternalError";
    this.specifier = specifier;
    this.availableExternals = sortedExternals;
  }
}

/** Error raised when loaded bundle content does not match its expected SHA-256 integrity. */
export class ComponentOnceIntegrityError extends Error {
  /** Expected subresource-integrity-style SHA-256 value. */
  readonly expectedIntegrity: string;
  /** Actual subresource-integrity-style SHA-256 value. */
  readonly actualIntegrity: string;

  constructor(expectedIntegrity: string, actualIntegrity: string) {
    super(
      `Trusted bundle integrity mismatch. Expected "${expectedIntegrity}" but received "${actualIntegrity}".`,
    );
    this.name = "ComponentOnceIntegrityError";
    this.expectedIntegrity = expectedIntegrity;
    this.actualIntegrity = actualIntegrity;
  }
}

/**
 * Compile one trusted module into a deterministic CommonJS artifact.
 *
 * Only caller-declared imports remain external. This generic path does not add React or any other
 * runtime implicitly; every external must be injected explicitly by the host at instantiation.
 */
export async function compileTrustedModule(
  input: ComponentOnceCompileInput,
): Promise<ComponentOnceTrustedBundleArtifact> {
  const sourceFileName = normalizeSourceFileName(
    input.sourceFileName ?? DEFAULT_SOURCE_FILE_NAME,
  );
  const loader = input.loader ?? inferLoader(sourceFileName);
  const allowedExternals = normalizeAllowedExternals(input.externalModules ?? []);
  const workingDirectory = resolve(input.resolveDir ?? process.cwd());
  const outputDirectory = resolve(workingDirectory, OUTPUT_DIRECTORY_NAME);
  const loaders = normalizeLoaders(input.loaders);
  const contentTypes = normalizeContentTypes(input.contentTypes);

  try {
    const compilationNamespace = await calculateCompilationNamespace({
      source: input.source,
      sourceFileName,
      loader,
      resolveDir: workingDirectory,
      jsx: input.jsx ?? "transform",
      loaders,
      allowedExternals,
      outputDirectory,
    });
    const result = await build({
      absWorkingDir: workingDirectory,
      assetNames: "assets/[hash]",
      bundle: true,
      charset: "utf8",
      entryNames: "component",
      format: "cjs",
      jsx: input.jsx ?? "transform",
      legalComments: "none",
      loader: loaders as Record<string, Loader>,
      logLevel: "silent",
      metafile: true,
      minify: false,
      outdir: outputDirectory,
      platform: "neutral",
      plugins: [
        createCssModuleNamespacePlugin(compilationNamespace, workingDirectory),
        createHostExternalPlugin(allowedExternals),
      ],
      publicPath: COMPONENTONCE_ASSET_URL_PREFIX,
      sourcemap: "inline",
      sourcesContent: true,
      stdin: {
        contents: input.source,
        loader: loader as Loader,
        sourcefile: sourceFileName,
        resolveDir: workingDirectory,
      },
      target: "es2022",
      treeShaking: true,
      write: false,
    });

    if (result.outputFiles === undefined || result.metafile === undefined) {
      throw new ComponentOnceCompileError([
        createInternalDiagnostic("esbuild did not return an in-memory bundle and metafile."),
      ]);
    }

    const outputs = classifyOutputs(
      result.outputFiles,
      outputDirectory,
      workingDirectory,
      contentTypes,
      result.metafile,
    );
    const code = outputs.code;
    const hashes = hashBundleSource(code);
    const metafile = deepFreeze(result.metafile);
    const diagnostics = Object.freeze(
      result.warnings.map((warning) => normalizeMessage("warning", warning)),
    );
    const externalModules = Object.freeze(collectExternalModules(metafile));

    return Object.freeze({
      format: COMPONENTONCE_TRUSTED_BUNDLE_FORMAT,
      code,
      byteLength: hashes.byteLength,
      sha256: hashes.sha256,
      integrity: hashes.integrity,
      externalModules,
      diagnostics,
      metafile,
      assets: outputs.assets,
      stylesheets: outputs.stylesheets,
    });
  } catch (error: unknown) {
    if (error instanceof ComponentOnceCompileError) throw error;
    if (isBuildFailure(error)) {
      throw new ComponentOnceCompileError(
        error.errors.map((message) => normalizeMessage("error", message)),
      );
    }
    throw error;
  }
}

/** Compile a trusted React module while keeping the host React singleton external. */
export function compileTrustedReactModule(
  input: ComponentOnceReactCompileInput,
): Promise<ComponentOnceTrustedBundleArtifact> {
  return compileTrustedModule({
    source: input.source,
    sourceFileName: input.sourceFileName ?? DEFAULT_REACT_SOURCE_FILE_NAME,
    ...(input.loader === undefined ? {} : { loader: input.loader }),
    ...(input.resolveDir === undefined ? {} : { resolveDir: input.resolveDir }),
    ...(input.loaders === undefined ? {} : { loaders: input.loaders }),
    ...(input.contentTypes === undefined ? {} : { contentTypes: input.contentTypes }),
    externalModules: [
      ...REACT_EXTERNALS,
      ...(input.additionalExternalModules ?? []),
    ],
    jsx: "automatic",
  });
}

/** Calculate a subresource-integrity-style SHA-256 value for bundle text or UTF-8 bytes. */
export function calculateTrustedBundleIntegrity(source: string | Uint8Array): string {
  return hashBundleSource(source).integrity;
}

/** Throw when bundle text or bytes do not match an expected SHA-256 integrity value. */
export function assertTrustedBundleIntegrity(
  source: string | Uint8Array,
  expectedIntegrity: string,
): void {
  const actualIntegrity = calculateTrustedBundleIntegrity(source);
  if (actualIntegrity !== expectedIntegrity) {
    throw new ComponentOnceIntegrityError(expectedIntegrity, actualIntegrity);
  }
}

/**
 * Execute a trusted bundle with a deliberately narrow CommonJS environment.
 *
 * This API uses `new Function` and is only for trusted internal code. It is not a sandbox: evaluated
 * code retains access to JavaScript globals. The only available `require` values are provided by
 * `options.externals`, so React is always the exact instance selected by the host.
 */
export function instantiateTrustedBundle<TExports = Record<string, unknown>>(
  source: ComponentOnceTrustedBundleSource,
  options: InstantiateTrustedBundleOptions,
): TExports {
  const artifact = isBundleArtifact(source) ? source : undefined;
  if (artifact !== undefined && artifact.format !== COMPONENTONCE_TRUSTED_BUNDLE_FORMAT) {
    throw new TypeError(`Unsupported trusted bundle format: "${String(artifact.format)}".`);
  }

  const bundleSource: string | Uint8Array =
    artifact === undefined ? (source as string | Uint8Array) : artifact.code;
  const expectedIntegrity = options.expectedIntegrity ?? artifact?.integrity;
  if (expectedIntegrity !== undefined) {
    assertTrustedBundleIntegrity(bundleSource, expectedIntegrity);
  }
  const code = typeof bundleSource === "string" ? bundleSource : decodeUtf8(bundleSource);

  const availableExternals = Object.keys(options.externals).sort();
  const trustedRequire = (specifier: string): unknown => {
    if (!Object.prototype.hasOwnProperty.call(options.externals, specifier)) {
      throw new ComponentOnceMissingExternalError(specifier, availableExternals);
    }
    return options.externals[specifier];
  };

  const commonJsModule: { exports: unknown } = { exports: {} };
  const sourceName = sanitizeSourceName(options.sourceName ?? DEFAULT_EVALUATED_SOURCE_NAME);
  const evaluate = new Function(
    "module",
    "exports",
    "require",
    `"use strict";\n${code}\n//# sourceURL=${sourceName}`,
  ) as (module: { exports: unknown }, exports: unknown, require: typeof trustedRequire) => void;

  evaluate(commonJsModule, commonJsModule.exports, trustedRequire);
  return commonJsModule.exports as TExports;
}

function classifyOutputs(
  outputFiles: readonly OutputFile[],
  outputDirectory: string,
  workingDirectory: string,
  contentTypes: Readonly<Record<string, string>>,
  metafile: Metafile,
): {
  readonly code: string;
  readonly assets: readonly ComponentOnceCompiledAsset[];
  readonly stylesheets: readonly string[];
} {
  let code: string | undefined;
  const assets: ComponentOnceCompiledAsset[] = [];
  const stylesheets: string[] = [];
  const entryMetadata = Object.entries(metafile.outputs).find(
    ([, metadata]) => metadata.entryPoint !== undefined,
  );
  if (entryMetadata === undefined) {
    throw new ComponentOnceCompileError([
      createInternalDiagnostic("esbuild metafile does not identify the JavaScript entry output."),
    ]);
  }
  const entryOutput = findOutputFile(outputFiles, entryMetadata[0], workingDirectory);
  const stylesheetOutput =
    entryMetadata[1].cssBundle === undefined
      ? undefined
      : findOutputFile(outputFiles, entryMetadata[1].cssBundle, workingDirectory);
  if (entryOutput === undefined || (entryMetadata[1].cssBundle !== undefined && stylesheetOutput === undefined)) {
    throw new ComponentOnceCompileError([
      createInternalDiagnostic("esbuild metafile references an output file that was not returned."),
    ]);
  }

  for (const output of outputFiles) {
    const path = normalizeOutputPath(relative(outputDirectory, output.path));
    if (output === entryOutput) {
      if (code !== undefined) {
        throw new ComponentOnceCompileError([
          createInternalDiagnostic("esbuild emitted duplicate JavaScript entry outputs."),
        ]);
      }
      code = output.text;
      continue;
    }
    const hashes = hashBundleSource(output.contents);
    const contentType = contentTypeForPath(path, contentTypes);
    assets.push(
      Object.freeze({
        path,
        contentType,
        encoding: "base64" as const,
        content: Buffer.from(output.contents).toString("base64"),
        byteLength: hashes.byteLength,
        sha256: hashes.sha256,
        integrity: hashes.integrity,
      }),
    );
    if (output === stylesheetOutput) stylesheets.push(path);
  }

  if (code === undefined) {
    throw new ComponentOnceCompileError([
      createInternalDiagnostic("esbuild did not emit the expected component.js entry bundle."),
    ]);
  }
  assets.sort((left, right) => compareStrings(left.path, right.path));
  stylesheets.sort(compareStrings);
  return {
    code,
    assets: Object.freeze(assets),
    stylesheets: Object.freeze(stylesheets),
  };
}

function findOutputFile(
  outputFiles: readonly OutputFile[],
  metadataPath: string,
  workingDirectory: string,
): OutputFile | undefined {
  const normalizedMetadataPath = resolve(workingDirectory, metadataPath).replace(/\\/gu, "/");
  return outputFiles.find((output) => {
    const normalizedOutputPath = output.path.replace(/\\/gu, "/");
    return normalizedOutputPath === normalizedMetadataPath;
  });
}

function normalizeOutputPath(value: string): string {
  const path = value.replace(/\\/gu, "/");
  if (
    path.length === 0 ||
    path.startsWith("/") ||
    path === ".." ||
    path.startsWith("../") ||
    path.includes("/../") ||
    path.includes("\0")
  ) {
    throw new ComponentOnceCompileError([
      createInternalDiagnostic("esbuild emitted an unsafe output path: " + JSON.stringify(path) + "."),
    ]);
  }
  return path;
}

function normalizeLoaders(
  configured: Readonly<Record<string, ComponentOnceAdditionalLoader>> | undefined,
): Readonly<Record<string, ComponentOnceAdditionalLoader>> {
  const normalized: Record<string, ComponentOnceAdditionalLoader> = {
    ...DEFAULT_FILE_LOADERS,
  };
  for (const [extension, loader] of Object.entries(configured ?? {})) {
    if (!/^\.[a-zA-Z0-9._-]+$/u.test(extension)) {
      throw new ComponentOnceCompileError([
        createInternalDiagnostic("Invalid loader extension: " + JSON.stringify(extension) + "."),
      ]);
    }
    normalized[extension.toLowerCase()] = loader;
  }
  return normalized;
}

function normalizeContentTypes(
  configured: Readonly<Record<string, string>> | undefined,
): Readonly<Record<string, string>> {
  const normalized: Record<string, string> = {};
  for (const [extension, contentType] of Object.entries(configured ?? {})) {
    if (!/^\.[a-zA-Z0-9._-]+$/u.test(extension)) {
      throw new ComponentOnceCompileError([
        createInternalDiagnostic("Invalid content type extension: " + JSON.stringify(extension) + "."),
      ]);
    }
    if (
      contentType.trim() === "" ||
      contentType !== contentType.trim() ||
      /[\u0000-\u001f\u007f]/u.test(contentType)
    ) {
      throw new ComponentOnceCompileError([
        createInternalDiagnostic("Invalid content type: " + JSON.stringify(contentType) + "."),
      ]);
    }
    normalized[extension.toLowerCase()] = contentType;
  }
  return normalized;
}

function contentTypeForPath(
  path: string,
  configured: Readonly<Record<string, string>>,
): string {
  const extension = extname(path).toLowerCase();
  return configured[extension] ?? CONTENT_TYPES[extension] ?? "application/octet-stream";
}

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".css": "text/css",
  ".eot": "application/vnd.ms-fontobject",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".otf": "font/otf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

interface CompilationNamespaceInput {
  readonly source: string;
  readonly sourceFileName: string;
  readonly loader: ComponentOnceSourceLoader;
  readonly resolveDir?: string;
  readonly jsx: ComponentOnceJsxMode;
  readonly loaders: Readonly<Record<string, ComponentOnceAdditionalLoader>>;
  readonly allowedExternals: ReadonlySet<string>;
  readonly outputDirectory: string;
}

async function calculateCompilationNamespace(
  input: CompilationNamespaceInput,
): Promise<string> {
  const root = resolve(input.resolveDir ?? process.cwd());
  const result = await build({
    absWorkingDir: root,
    assetNames: "assets/[hash]",
    bundle: true,
    entryNames: "component",
    format: "cjs",
    jsx: input.jsx,
    legalComments: "none",
    loader: input.loaders as Record<string, Loader>,
    logLevel: "silent",
    metafile: true,
    minify: false,
    outdir: input.outputDirectory,
    platform: "neutral",
    plugins: [createHostExternalPlugin(input.allowedExternals)],
    publicPath: COMPONENTONCE_ASSET_URL_PREFIX,
    stdin: {
      contents: input.source,
      loader: input.loader as Loader,
      sourcefile: input.sourceFileName,
      resolveDir: root,
    },
    target: "es2022",
    treeShaking: true,
    write: false,
  });
  if (result.metafile === undefined) {
    throw new ComponentOnceCompileError([
      createInternalDiagnostic("esbuild prepass did not return dependency metadata."),
    ]);
  }

  const virtualEntryPath = resolve(root, input.sourceFileName);
  const hash = createHash("sha256");
  updateNamespacedHash(hash, "entry/" + basename(input.sourceFileName), Buffer.from(input.source));
  const dependencyFiles = Object.keys(result.metafile.inputs)
    .flatMap((inputPath) => {
      if (inputPath === input.sourceFileName || inputPath === "<stdin>") return [];
      const dependencyPath = splitPathSuffix(inputPath).path;
      const absolutePath = isAbsolute(dependencyPath)
        ? dependencyPath
        : resolve(root, dependencyPath);
      if (absolutePath === virtualEntryPath) return [];
      return [{
        absolutePath,
        stablePath: relative(root, absolutePath).replace(/\\/gu, "/"),
      }];
    })
    .sort((left, right) => compareStrings(left.stablePath, right.stablePath));
  for (const dependency of dependencyFiles) {
    updateNamespacedHash(
      hash,
      dependency.stablePath,
      await readFile(dependency.absolutePath),
    );
  }
  return hash.digest("hex").slice(0, 16);
}

function updateNamespacedHash(
  hash: ReturnType<typeof createHash>,
  path: string,
  contents: Uint8Array,
): void {
  hash.update(String(Buffer.byteLength(path, "utf8"))).update(":").update(path);
  hash.update(String(contents.byteLength)).update(":").update(contents);
}

function createCssModuleNamespacePlugin(
  compilationNamespace: string,
  workingDirectory: string,
): Plugin {
  const namespace = "componentonce-local-css";
  return {
    name: "componentonce-css-module-namespace",
    setup(buildApi) {
      const resolveModule = async (path: string, resolveDir: string, suffix = "") => {
        const realPath = isAbsolute(path) ? path : resolve(resolveDir, path);
        const contents = await readFile(realPath);
        const contentNamespace = createHash("sha256").update(contents).digest("hex").slice(0, 12);
        const stablePath = relative(workingDirectory, realPath).replace(/\\/gu, "/");
        const pathNamespace = createHash("sha256").update(stablePath).digest("hex").slice(0, 12);
        const originalName = basename(realPath, ".module.css");
        return {
          path:
            originalName +
            "-" +
            pathNamespace +
            "-" +
            compilationNamespace +
            "-" +
            contentNamespace +
            ".module.css",
          namespace,
          suffix,
          pluginData: { realPath },
        };
      };

      buildApi.onResolve({ filter: /\.module\.css(?:[?#].*)?$/ }, (args) => {
        const reference = splitPathSuffix(args.path);
        if (!reference.path.startsWith(".")) return undefined;
        return resolveModule(reference.path, args.resolveDir, reference.suffix);
      });
      buildApi.onResolve({ filter: /.*/, namespace }, (args) => {
        const reference = splitPathSuffix(args.path);
        if (isCssReferenceKind(args.kind) && isNonFileCssPath(reference.path)) {
          return resolveCssReference(reference.path, reference.suffix, args.resolveDir);
        }
        if (reference.path.endsWith(".module.css")) {
          return resolveModule(reference.path, args.resolveDir, reference.suffix);
        }
        if (isCssReferenceKind(args.kind)) {
          return resolveCssReference(reference.path, reference.suffix, args.resolveDir);
        }
        return undefined;
      });
      buildApi.onLoad({ filter: /.*/, namespace }, async (args) => {
        const pluginData = args.pluginData as { readonly realPath?: unknown } | undefined;
        if (typeof pluginData?.realPath !== "string") {
          return { errors: [{ text: "Missing original CSS Module path." }] };
        }
        return {
          contents: await readFile(pluginData.realPath),
          loader: "local-css",
          resolveDir: dirname(pluginData.realPath),
        };
      });
    },
  };
}

function createHostExternalPlugin(allowedExternals: ReadonlySet<string>): Plugin {
  return {
    name: "componentonce-host-externals",
    setup(buildApi) {
      buildApi.onResolve({ filter: /.*/ }, (args) => {
        if (isCssReferenceKind(args.kind)) {
          const reference = splitPathSuffix(args.path);
          return resolveCssReference(reference.path, reference.suffix, args.resolveDir);
        }
        if (allowedExternals.has(args.path)) {
          return { external: true, path: args.path };
        }
        if (args.path.startsWith(".")) {
          return undefined;
        }
        return {
          errors: [
            {
              text:
                `Import "${args.path}" is not an allowed host external. ` +
                "Add its exact specifier to externalModules (or additionalExternalModules for the React helper).",
            },
          ],
        };
      });
    },
  };
}

function isCssReferenceKind(kind: string): boolean {
  return kind === "import-rule" || kind === "composes-from" || kind === "url-token";
}

function splitPathSuffix(value: string): { readonly path: string; readonly suffix: string } {
  const suffixIndex = value.search(/[?#]/u);
  return suffixIndex < 0
    ? { path: value, suffix: "" }
    : { path: value.slice(0, suffixIndex), suffix: value.slice(suffixIndex) };
}

function resolveCssReference(
  path: string,
  suffix: string,
  resolveDir: string,
) {
  if (path === "" || /^data:/iu.test(path)) {
    return { path: path + suffix, external: true };
  }
  if (isNonFileCssPath(path)) {
    return {
      errors: [
        {
          text:
            "CSS asset reference " +
            JSON.stringify(path + suffix) +
            " is not portable. Use a relative packaged file or an explicit data URL.",
        },
      ],
    };
  }
  return {
    path: resolve(resolveDir, path),
    ...(suffix === "" ? {} : { suffix }),
  };
}

function isNonFileCssPath(path: string): boolean {
  return (
    path === "" ||
    path.startsWith("/") ||
    path.includes("\\") ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(path)
  );
}

function normalizeAllowedExternals(additionalExternals: readonly string[]): ReadonlySet<string> {
  const externals = new Set<string>();
  for (const specifier of additionalExternals) {
    if (
      specifier.length === 0 ||
      specifier !== specifier.trim() ||
      specifier.includes("\0") ||
      specifier.includes("\n") ||
      specifier.includes("\r")
    ) {
      throw new ComponentOnceCompileError([
        createInternalDiagnostic(
          `Invalid additional external module specifier: ${JSON.stringify(specifier)}.`,
        ),
      ]);
    }
    externals.add(specifier);
  }
  return externals;
}

function inferLoader(sourceFileName: string): ComponentOnceSourceLoader {
  const lowerName = sourceFileName.toLowerCase();
  if (lowerName.endsWith(".jsx")) return "jsx";
  if (lowerName.endsWith(".js") || lowerName.endsWith(".mjs") || lowerName.endsWith(".cjs")) {
    return "js";
  }
  if (lowerName.endsWith(".ts") || lowerName.endsWith(".mts") || lowerName.endsWith(".cts")) {
    return "ts";
  }
  return "tsx";
}

function normalizeSourceFileName(sourceFileName: string): string {
  const normalized = sourceFileName.replace(/\\/gu, "/");
  if (
    isAbsolute(sourceFileName) ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//u.test(normalized)
  ) {
    const fileName = normalized.slice(normalized.lastIndexOf("/") + 1);
    if (fileName === "") {
      throw new ComponentOnceCompileError([
        createInternalDiagnostic("sourceFileName must identify a file."),
      ]);
    }
    return fileName;
  }
  return normalized;
}

function normalizeMessage(
  kind: ComponentOnceDiagnostic["kind"],
  message: Message,
): ComponentOnceDiagnostic {
  return Object.freeze({
    kind,
    text: message.text,
    ...(message.location === null ? {} : { location: normalizeLocation(message.location) }),
    notes: Object.freeze(
      message.notes.map((note) =>
        Object.freeze({
          text: note.text,
          ...(note.location === null ? {} : { location: normalizeLocation(note.location) }),
        }),
      ),
    ),
  });
}

function normalizeLocation(location: NonNullable<Message["location"]>): ComponentOnceDiagnosticLocation {
  return Object.freeze({
    file: location.file,
    line: location.line,
    column: location.column,
    length: location.length,
    lineText: location.lineText,
  });
}

function createInternalDiagnostic(text: string): ComponentOnceDiagnostic {
  return Object.freeze({ kind: "error", text, notes: Object.freeze([]) });
}

function formatCompileErrorMessage(diagnostics: readonly ComponentOnceDiagnostic[]): string {
  const details = diagnostics.map((diagnostic) => {
    const location = diagnostic.location;
    const prefix =
      location === undefined
        ? diagnostic.kind
        : `${location.file}:${location.line}:${location.column + 1}`;
    return `${prefix}: ${diagnostic.text}`;
  });
  return `ComponentOnce compilation failed${details.length === 0 ? "." : `:\n${details.join("\n")}`}`;
}

function isBuildFailure(error: unknown): error is BuildFailure {
  return (
    typeof error === "object" &&
    error !== null &&
    "errors" in error &&
    Array.isArray((error as { readonly errors?: unknown }).errors)
  );
}

function collectExternalModules(metafile: Metafile): string[] {
  const modules = new Set<string>();
  for (const output of Object.values(metafile.outputs)) {
    for (const imported of output.imports) {
      if (imported.external) modules.add(imported.path);
    }
  }
  return [...modules].sort();
}

function hashBundleSource(source: string | Uint8Array): {
  readonly byteLength: number;
  readonly sha256: string;
  readonly integrity: string;
} {
  const bytes = typeof source === "string" ? Buffer.from(source, "utf8") : source;
  const digest = createHash("sha256").update(bytes).digest();
  return {
    byteLength: bytes.byteLength,
    sha256: digest.toString("hex"),
    integrity: `sha256-${digest.toString("base64")}`,
  };
}

function isBundleArtifact(
  source: ComponentOnceTrustedBundleSource,
): source is ComponentOnceTrustedBundle {
  return typeof source === "object" && !(source instanceof Uint8Array);
}

function decodeUtf8(source: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(source);
}

function sanitizeSourceName(sourceName: string): string {
  return sourceName.replace(/[\r\n\u2028\u2029]/g, "_");
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

/** File-based source watch options; rebuilds use the canonical packaging compiler. */
export interface ComponentOnceWatchInput extends Omit<ComponentOnceCompileInput, "source" | "sourceFileName" | "resolveDir"> {
  readonly entry: string;
  /** Called for successes and failures; the watcher remains alive after syntax errors. */
  readonly onBuild: (result: ComponentOnceWatchResult) => void | Promise<void>;
}

/** A completed source build, without executable host values or transport assumptions. */
export type ComponentOnceWatchResult =
  | { readonly ok: true; readonly artifact: ComponentOnceTrustedBundleArtifact; readonly durationMs: number }
  | { readonly ok: false; readonly diagnostics: readonly ComponentOnceDiagnostic[]; readonly durationMs: number };

/** Dispose the graph watcher or explicitly request one rebuild. */
export interface ComponentOnceModuleWatcher {
  rebuild(): Promise<void>;
  dispose(): Promise<void>;
}

/**
 * Watch the entry and its imported TS/JS/CSS/assets using esbuild's incremental graph.
 * The final artifact deliberately goes through compileTrustedModule, including its
 * content-dependent CSS namespace pass, instead of a divergent development compiler.
 * No package files are written and failures do not destroy a caller's last good artifact.
 */
export async function watchTrustedModuleFile(input: ComponentOnceWatchInput): Promise<ComponentOnceModuleWatcher> {
  const entry = resolve(input.entry);
  const workingDirectory = dirname(entry);
  const externals = normalizeAllowedExternals(input.externalModules ?? []);
  const externalPlugin = createHostExternalPlugin(externals);
  const graph = await createBuildContext({
    absWorkingDir: workingDirectory,
    // A virtual importer lets the strict external plugin handle the entry as a relative import.
    stdin: { contents: 'import ' + JSON.stringify('./' + basename(entry)), resolveDir: workingDirectory, sourcefile: '__componentonce_watch__.ts' },
    bundle: true,
    format: "cjs",
    platform: "neutral",
    jsx: input.jsx ?? "transform",
    outdir: resolve(workingDirectory, OUTPUT_DIRECTORY_NAME),
    loader: { ...normalizeLoaders(input.loaders), ...(input.loader === undefined ? {} : { [extname(entry)]: input.loader }) } as Record<string, Loader>,
    logLevel: "silent",
    write: false,
    plugins: [externalPlugin, {
      name: "componentonce-watch-result",
      setup(api) {
        let started = 0;
        api.onStart(() => { started = performance.now(); });
        api.onEnd(async (result) => {
          if (result.errors.length > 0) {
            await input.onBuild({ ok: false, diagnostics: result.errors.map((error) => normalizeMessage("error", error)), durationMs: performance.now() - started });
            return;
          }
          let outcome: ComponentOnceWatchResult;
          try {
            const artifact = await compileTrustedModule({
              source: await readFile(entry, "utf8"),
              sourceFileName: basename(entry),
              resolveDir: workingDirectory,
              ...(input.loader === undefined ? {} : { loader: input.loader }),
              ...(input.jsx === undefined ? {} : { jsx: input.jsx }),
              ...(input.externalModules === undefined ? {} : { externalModules: input.externalModules }),
              ...(input.loaders === undefined ? {} : { loaders: input.loaders }),
              ...(input.contentTypes === undefined ? {} : { contentTypes: input.contentTypes }),
            });
            outcome = { ok: true, artifact, durationMs: performance.now() - started };
          } catch (error) {
            outcome = { ok: false, diagnostics: error instanceof ComponentOnceCompileError ? error.diagnostics : [createInternalDiagnostic(error instanceof Error ? error.message : String(error))], durationMs: performance.now() - started };
          }
          await input.onBuild(outcome);
        });
      },
    }],
  });
  try { await graph.watch(); } catch (error) { await graph.dispose(); throw error; }
  let disposed = false;
  return {
    async rebuild() { if (disposed) throw new Error("ComponentOnce watcher is disposed."); await graph.rebuild(); },
    async dispose() { if (!disposed) { disposed = true; await graph.dispose(); } },
  };
}
