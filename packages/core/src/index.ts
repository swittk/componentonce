/** Stable identity and compatibility metadata for one registered component implementation. */
export interface ComponentOnceManifest {
  /** Host-independent component identity. */
  readonly id: string;
  /** Exact immutable component implementation version. */
  readonly version: string;
  /** Optional human label for editor/catalog surfaces. */
  readonly displayName?: string;
  /** Optional host API contract expected by this implementation. */
  readonly hostApi?: {
    readonly name: string;
    readonly version: string;
  };
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

/** Exact stored/remote bundle descriptor understood by a host loader adapter. */
export interface ComponentOnceLoadDescriptor {
  readonly id: string;
  readonly version: string;
  readonly bundleLocation: string;
  readonly integrity?: string;
}

/** Host-provided loader. Core does not know storage, URLs, files, or dynamic-import policy. */
export interface ComponentOnceLoader<TDefinition> {
  load(descriptor: ComponentOnceLoadDescriptor): Promise<TDefinition>;
}
