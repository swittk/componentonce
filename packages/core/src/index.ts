/** An exact, immutable component identity used for deterministic lookup. */
export interface ComponentOnceExactReference {
  /** Host-independent component identity. */
  readonly id: string;
  /** Exact component implementation version. */
  readonly version: string;
}

/** One named runtime or host capability required by a component implementation. */
export interface ComponentOnceRequirement {
  /** Stable capability name such as React, browser DOM, or an application SDK id. */
  readonly name: string;
  /** Requirement version interpreted by the host compatibility rule. */
  readonly version: string;
}

/** One named runtime or API capability actually available from a host. */
export interface ComponentOnceCapability {
  /** Stable capability name. */
  readonly name: string;
  /** Version exposed by this host. */
  readonly version: string;
}

/** Stable identity and compatibility metadata for one registered component implementation. */
export interface ComponentOnceManifest extends ComponentOnceExactReference {
  /** Optional human label for editor or catalog surfaces. */
  readonly displayName?: string;
  /** Runtime/application contracts which must all be satisfied before this component can run. */
  readonly requirements?: readonly ComponentOnceRequirement[];
}

/** Optional validator used at an adapter boundary rather than on every render. */
export type ComponentOnceValidator<T> = (input: unknown) => T;

/** One versioned implementation registered in a ComponentOnce registry. */
export interface ComponentOnceDefinition<
  TImplementation = unknown,
  TProps = unknown,
  THostContext = unknown,
  TPayload = unknown,
> {
  readonly manifest: ComponentOnceManifest;
  readonly implementation: TImplementation;
  readonly validateProps?: ComponentOnceValidator<TProps>;
  readonly validatePayload?: ComponentOnceValidator<TPayload>;
  /** Phantom host-context type carried for compile-time host/module compatibility. */
  readonly __hostContext?: THostContext;
}

/** The broad definition type accepted by heterogeneous registries and adapters. */
export type AnyComponentOnceDefinition = ComponentOnceDefinition<unknown, unknown, unknown, unknown>;

/** Exact load identity that storage and transport adapters may extend with their own fields. */
export interface ComponentOnceLoadDescriptor extends ComponentOnceExactReference {}

/** Host-provided loader that maps an adapter descriptor to one typed definition. */
export interface ComponentOnceLoader<
  TDefinition extends AnyComponentOnceDefinition = AnyComponentOnceDefinition,
  TDescriptor extends ComponentOnceLoadDescriptor = ComponentOnceLoadDescriptor,
> {
  load(descriptor: TDescriptor): Promise<TDefinition>;
}

/** Conflict behavior used when an exact id and version is already registered. */
export type ComponentOnceConflictStrategy = "throw" | "keep-existing" | "replace";

/** Options applied while registering one exact component definition. */
export interface ComponentOnceRegistrationOptions {
  /** How to handle an occupied exact id and version. Defaults to `throw`. */
  readonly onConflict?: ComponentOnceConflictStrategy;
  /** Select the registered version as the explicit default for its id. */
  readonly setAsDefault?: boolean;
}

/** A request for an exact version or for a host-configured default version. */
export interface ComponentOnceResolveRequest {
  readonly id: string;
  /** Omit only when the host has explicitly configured a default for this id. */
  readonly version?: string;
}

/** Base error for registry, loading, and compatibility contract failures. */
export class ComponentOnceError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Thrown when an id or version is empty. */
export class ComponentOnceInvalidReferenceError extends ComponentOnceError {
  public readonly reference: ComponentOnceExactReference;

  public constructor(reference: ComponentOnceExactReference) {
    super("Component ids and versions must be non-empty strings.");
    this.reference = reference;
  }
}

/** Thrown when registration finds an existing definition at the same exact id and version. */
export class ComponentOnceDuplicateVersionError extends ComponentOnceError {
  public readonly reference: ComponentOnceExactReference;
  public readonly existing: AnyComponentOnceDefinition;
  public readonly incoming: AnyComponentOnceDefinition;

  public constructor(
    existing: AnyComponentOnceDefinition,
    incoming: AnyComponentOnceDefinition,
  ) {
    const { id, version } = incoming.manifest;
    super(`Component "${id}" version "${version}" is already registered.`);
    this.reference = { id, version };
    this.existing = existing;
    this.incoming = incoming;
  }
}

/** Thrown when an exact component definition cannot be found. */
export class ComponentOnceDefinitionNotFoundError extends ComponentOnceError {
  public readonly reference: ComponentOnceExactReference;

  public constructor(reference: ComponentOnceExactReference) {
    super(`Component "${reference.id}" version "${reference.version}" is not registered.`);
    this.reference = reference;
  }
}

/** Thrown when unversioned resolution has no host-configured default. */
export class ComponentOnceDefaultVersionNotConfiguredError extends ComponentOnceError {
  public readonly id: string;

  public constructor(id: string) {
    super(`Component "${id}" has no configured default version.`);
    this.id = id;
  }
}

/** Thrown when a loader returns a definition other than the exact descriptor requested. */
export class ComponentOnceLoadedDefinitionMismatchError extends ComponentOnceError {
  public readonly requested: ComponentOnceExactReference;
  public readonly loaded: ComponentOnceExactReference;

  public constructor(
    requested: ComponentOnceExactReference,
    loaded: ComponentOnceExactReference,
  ) {
    super(
      `Loader returned component "${loaded.id}" version "${loaded.version}" while ` +
        `"${requested.id}" version "${requested.version}" was requested.`,
    );
    this.requested = requested;
    this.loaded = loaded;
  }
}

/** Thrown when a component requires a capability the host did not provide. */
export class ComponentOnceCapabilityMissingError extends ComponentOnceError {
  public readonly requirement: ComponentOnceRequirement;

  public constructor(requirement: ComponentOnceRequirement) {
    super(
      "Component requires capability \"" + requirement.name + "\" version \"" +
        requirement.version + "\", but the host did not provide that capability.",
    );
    this.requirement = requirement;
  }
}

/** Thrown when a named host capability exists but its version is incompatible. */
export class ComponentOnceCapabilityVersionError extends ComponentOnceError {
  public readonly requirement: ComponentOnceRequirement;
  public readonly available: ComponentOnceCapability;

  public constructor(
    requirement: ComponentOnceRequirement,
    available: ComponentOnceCapability,
  ) {
    super(
      "Component requires capability \"" + requirement.name + "\" version \"" +
        requirement.version + "\", but the host provides version \"" +
        available.version + "\".",
    );
    this.requirement = requirement;
    this.available = available;
  }
}

/** Host-supplied compatibility rule for one named requirement and matching available capability. */
export type ComponentOnceCapabilityCompatibility = (
  requirement: ComponentOnceRequirement,
  available: ComponentOnceCapability,
) => boolean;

/** Compare one requirement and capability by exact name and version equality. */
export function exactComponentOnceCapabilityCompatibility(
  requirement: ComponentOnceRequirement,
  available: ComponentOnceCapability,
): boolean {
  return requirement.name === available.name && requirement.version === available.version;
}

/** Find the host capability with the exact name required by one component requirement. */
export function findComponentOnceCapability(
  requirement: ComponentOnceRequirement,
  available: readonly ComponentOnceCapability[],
): ComponentOnceCapability | undefined {
  for (const capability of available) {
    if (capability.name === requirement.name) return capability;
  }
  return undefined;
}

/** Check whether every manifest requirement is satisfied by host capabilities. */
export function isComponentOnceCompatible(
  manifest: ComponentOnceManifest,
  available: readonly ComponentOnceCapability[],
  isCompatible: ComponentOnceCapabilityCompatibility =
    exactComponentOnceCapabilityCompatibility,
): boolean {
  for (const requirement of manifest.requirements ?? []) {
    const capability = findComponentOnceCapability(requirement, available);
    if (capability === undefined || !isCompatible(requirement, capability)) return false;
  }
  return true;
}

/** Assert every manifest requirement before executing or mounting its implementation. */
export function assertComponentOnceCompatible(
  manifest: ComponentOnceManifest,
  available: readonly ComponentOnceCapability[],
  isCompatible: ComponentOnceCapabilityCompatibility =
    exactComponentOnceCapabilityCompatibility,
): void {
  for (const requirement of manifest.requirements ?? []) {
    const capability = findComponentOnceCapability(requirement, available);
    if (capability === undefined) {
      throw new ComponentOnceCapabilityMissingError(requirement);
    }
    if (!isCompatible(requirement, capability)) {
      throw new ComponentOnceCapabilityVersionError(requirement, capability);
    }
  }
}

/** An isolated, storage-agnostic registry of exact component definitions. */
export class ComponentOnceRegistry<
  TDefinition extends AnyComponentOnceDefinition = AnyComponentOnceDefinition,
> {
  readonly #definitions = new Map<string, Map<string, TDefinition>>();
  readonly #defaultVersions = new Map<string, string>();

  /** Register one definition without choosing a version implicitly. */
  public register(
    definition: TDefinition,
    options: ComponentOnceRegistrationOptions = {},
  ): TDefinition {
    assertValidReference(definition.manifest);
    const { id, version } = definition.manifest;
    let versions = this.#definitions.get(id);
    if (versions === undefined) {
      versions = new Map<string, TDefinition>();
      this.#definitions.set(id, versions);
    }

    const existing = versions.get(version);
    let registered = definition;
    if (existing !== undefined) {
      switch (options.onConflict ?? "throw") {
        case "throw":
          throw new ComponentOnceDuplicateVersionError(existing, definition);
        case "keep-existing":
          registered = existing;
          break;
        case "replace":
          versions.set(version, definition);
          break;
      }
    } else {
      versions.set(version, definition);
    }

    if (options.setAsDefault === true) this.#defaultVersions.set(id, version);
    return registered;
  }

  /** Return an exact definition when present without applying a default. */
  public findExact(id: string, version: string): TDefinition | undefined {
    return this.#definitions.get(id)?.get(version);
  }

  /** Return an exact definition or throw when it is absent. */
  public getExact(id: string, version: string): TDefinition {
    assertValidReference({ id, version });
    const definition = this.findExact(id, version);
    if (definition === undefined) {
      throw new ComponentOnceDefinitionNotFoundError({ id, version });
    }
    return definition;
  }

  /** Report whether an exact id and version is registered. */
  public hasExact(id: string, version: string): boolean {
    return this.findExact(id, version) !== undefined;
  }

  /** Resolve an exact version, or an explicitly configured default when version is omitted. */
  public resolve(request: ComponentOnceResolveRequest): TDefinition {
    if (request.version !== undefined) return this.getExact(request.id, request.version);
    const version = this.#defaultVersions.get(request.id);
    if (version === undefined) {
      throw new ComponentOnceDefaultVersionNotConfiguredError(request.id);
    }
    return this.getExact(request.id, version);
  }

  /** Configure one already registered exact version as the default for its id. */
  public setDefaultVersion(id: string, version: string): void {
    this.getExact(id, version);
    this.#defaultVersions.set(id, version);
  }

  /** Return the configured default version for an id when present. */
  public getDefaultVersion(id: string): string | undefined {
    return this.#defaultVersions.get(id);
  }

  /** Remove the configured default selection for an id. */
  public clearDefaultVersion(id: string): boolean {
    return this.#defaultVersions.delete(id);
  }

  /** Remove and return one exact definition, also clearing a matching default. */
  public unregister(id: string, version: string): TDefinition | undefined {
    const versions = this.#definitions.get(id);
    const definition = versions?.get(version);
    if (versions === undefined || definition === undefined) return undefined;

    versions.delete(version);
    if (versions.size === 0) this.#definitions.delete(id);
    if (this.#defaultVersions.get(id) === version) this.#defaultVersions.delete(id);
    return definition;
  }

  /** List registered versions for an id in deterministic lexical order. */
  public listVersions(id: string): readonly string[] {
    return [...(this.#definitions.get(id)?.keys() ?? [])].sort();
  }
}

/** Load one exact definition, verify its identity, and register it in an isolated registry. */
export async function loadAndRegisterComponentOnce<
  TDefinition extends AnyComponentOnceDefinition,
  TDescriptor extends ComponentOnceLoadDescriptor,
>(
  registry: ComponentOnceRegistry<TDefinition>,
  loader: ComponentOnceLoader<TDefinition, TDescriptor>,
  descriptor: TDescriptor,
  options: ComponentOnceRegistrationOptions = {},
): Promise<TDefinition> {
  assertValidReference(descriptor);
  const definition = await loader.load(descriptor);
  const { id, version } = definition.manifest;
  if (id !== descriptor.id || version !== descriptor.version) {
    throw new ComponentOnceLoadedDefinitionMismatchError(descriptor, { id, version });
  }
  return registry.register(definition, options);
}

function assertValidReference(reference: ComponentOnceExactReference): void {
  if (reference.id.trim() === "" || reference.version.trim() === "") {
    throw new ComponentOnceInvalidReferenceError(reference);
  }
}
