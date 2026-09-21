import {
  assertComponentOnceCompatible,
  type ComponentOnceCapability,
  type ComponentOnceCapabilityCompatibility,
  type ComponentOnceDefinition,
  type ComponentOnceManifest,
  type ComponentOnceValidator,
} from "@componentonce/core";

/** Stable capability name for the DOM adapter contract. */
export const DOM_CAPABILITY_NAME = "browser-dom";

/** Current DOM adapter contract version exposed automatically by this package. */
export const DOM_CAPABILITY_VERSION = "1";

/** Create an explicit requirement for a DOM adapter contract version. */
export function createDomRequirement(version: string) {
  return { name: DOM_CAPABILITY_NAME, version } as const;
}

/** Typed values passed to a DOM component instance. */
export interface ComponentOnceDomRenderInput<TProps, THostContext, TPayload> {
  readonly props: TProps;
  readonly context: THostContext;
  readonly payload: TPayload;
}

/** Live DOM instance returned by one component mount. */
export interface ComponentOnceDomMountHandle<TProps, THostContext, TPayload> {
  /** Replace the application values shown by this mounted instance. */
  update(input: ComponentOnceDomRenderInput<TProps, THostContext, TPayload>): void;
  /** Release listeners/resources and stop owning the target contents. */
  destroy(): void;
}

/** Trusted DOM implementation registered with ComponentOnce. */
export interface ComponentOnceDomImplementation<TProps, THostContext, TPayload> {
  /** Mount into one host-owned target and return its explicit lifecycle handle. */
  mount(
    target: Element,
    input: ComponentOnceDomRenderInput<TProps, THostContext, TPayload>,
  ): ComponentOnceDomMountHandle<TProps, THostContext, TPayload>;
}

/** Core definition specialized to an ordinary DOM implementation. */
export type ComponentOnceDomDefinition<TProps, THostContext, TPayload> =
  ComponentOnceDefinition<
    ComponentOnceDomImplementation<TProps, THostContext, TPayload>,
    TProps,
    THostContext,
    TPayload
  >;

/** Input used to define one typed DOM component. */
export interface DefineDomComponentInput<TProps, THostContext, TPayload> {
  readonly manifest: ComponentOnceManifest;
  readonly implementation: ComponentOnceDomImplementation<TProps, THostContext, TPayload>;
  readonly validateProps?: ComponentOnceValidator<TProps>;
  readonly validatePayload?: ComponentOnceValidator<TPayload>;
}

/** Selects typed values that a host explicitly wants to revalidate before mount. */
export interface ComponentOnceDomValidationRequest {
  readonly props?: boolean;
  readonly payload?: boolean;
}

/** Input for mounting an already typed DOM definition. */
export interface ComponentOnceDomMountInput<TProps, THostContext, TPayload>
  extends ComponentOnceDomRenderInput<TProps, THostContext, TPayload> {
  readonly definition: ComponentOnceDomDefinition<TProps, THostContext, TPayload>;
  readonly target: Element;
  readonly validation?: boolean | ComponentOnceDomValidationRequest;
  readonly hostCapabilities?: readonly ComponentOnceCapability[];
  readonly capabilityCompatibility?: ComponentOnceCapabilityCompatibility;
}

/** Unknown values received from an untyped host/storage boundary. */
export interface ComponentOnceDomBoundaryInput<THostContext> {
  readonly props: unknown;
  readonly context: THostContext;
  readonly payload: unknown;
}

/** Raw values plus target/definition needed for one validated mount. */
export interface ComponentOnceDomBoundaryMountInput<TProps, THostContext, TPayload>
  extends ComponentOnceDomBoundaryInput<THostContext> {
  readonly definition: ComponentOnceDomDefinition<TProps, THostContext, TPayload>;
  readonly target: Element;
  readonly hostCapabilities?: readonly ComponentOnceCapability[];
  readonly capabilityCompatibility?: ComponentOnceCapabilityCompatibility;
}

/** Host-wide runtime policy bound once by createDomHost. */
export interface ComponentOnceDomHostOptions {
  /** Additional application/runtime capabilities; the DOM adapter capability is added automatically. */
  readonly capabilities?: readonly ComponentOnceCapability[];
  /** Optional compatibility rule shared by every mount from this host helper. */
  readonly capabilityCompatibility?: ComponentOnceCapabilityCompatibility;
}

/** Mount input for a DOM host whose capability policy has already been bound. */
export type ComponentOnceBoundDomMountInput<TProps, THostContext, TPayload> = Omit<
  ComponentOnceDomMountInput<TProps, THostContext, TPayload>,
  "hostCapabilities" | "capabilityCompatibility"
>;

/** Boundary mount input for a DOM host whose capability policy has already been bound. */
export type ComponentOnceBoundDomBoundaryMountInput<TProps, THostContext, TPayload> = Omit<
  ComponentOnceDomBoundaryMountInput<TProps, THostContext, TPayload>,
  "hostCapabilities" | "capabilityCompatibility"
>;

/** Concise DOM host facade with application types and runtime compatibility policy fixed once. */
export interface ComponentOnceDomHost<THostContext> {
  /** Define a component while choosing its own persisted Props and per-render Payload types. */
  define<TProps, TPayload>(
    input: DefineDomComponentInput<TProps, THostContext, TPayload>,
  ): ComponentOnceDomDefinition<TProps, THostContext, TPayload>;
  /** Mount typed values using the host-wide capability policy. */
  mount<TProps, TPayload>(
    input: ComponentOnceBoundDomMountInput<TProps, THostContext, TPayload>,
  ): ComponentOnceDomMountHandle<TProps, THostContext, TPayload>;
  /** Validate unknown props/payload without changing the trusted host context. */
  validateBoundary<TProps, TPayload>(
    definition: ComponentOnceDomDefinition<TProps, THostContext, TPayload>,
    input: ComponentOnceDomBoundaryInput<THostContext>,
  ): ComponentOnceDomRenderInput<TProps, THostContext, TPayload>;
  /** Validate and mount unknown boundary values using the host-wide capability policy. */
  mountBoundary<TProps, TPayload>(
    input: ComponentOnceBoundDomBoundaryMountInput<TProps, THostContext, TPayload>,
  ): ComponentOnceDomMountHandle<TProps, THostContext, TPayload>;
}

/** DOM definition field that may provide a boundary validator. */
export type ComponentOnceDomValidationField = "props" | "payload";

/** Thrown when a raw boundary needs a validator that the definition did not provide. */
export class ComponentOnceDomValidatorMissingError extends Error {
  public readonly field: ComponentOnceDomValidationField;
  public readonly manifest: ComponentOnceManifest;

  public constructor(field: ComponentOnceDomValidationField, manifest: ComponentOnceManifest) {
    super(
      "Component \"" + manifest.id + "\" version \"" + manifest.version +
        "\" has no " + field + " validator.",
    );
    this.name = new.target.name;
    this.field = field;
    this.manifest = manifest;
  }
}

/** Define one trusted typed DOM implementation. */
export function defineDomComponent<TProps, THostContext, TPayload>(
  input: DefineDomComponentInput<TProps, THostContext, TPayload>,
): ComponentOnceDomDefinition<TProps, THostContext, TPayload> {
  return {
    manifest: input.manifest,
    implementation: input.implementation,
    ...(input.validateProps === undefined ? {} : { validateProps: input.validateProps }),
    ...(input.validatePayload === undefined ? {} : { validatePayload: input.validatePayload }),
  };
}

/** Mount one typed DOM definition after compatibility and optional validation checks. */
export function mountDomComponent<TProps, THostContext, TPayload>(
  input: ComponentOnceDomMountInput<TProps, THostContext, TPayload>,
): ComponentOnceDomMountHandle<TProps, THostContext, TPayload> {
  assertDomCompatible(input);
  return mountCompatibleDomComponent(input);
}

function mountCompatibleDomComponent<TProps, THostContext, TPayload>(
  input: ComponentOnceDomMountInput<TProps, THostContext, TPayload>,
): ComponentOnceDomMountHandle<TProps, THostContext, TPayload> {
  const validation = normalizeValidation(input.validation);
  const props = validation.props
    ? validateField(input.definition, "props", input.props)
    : input.props;
  const payload = validation.payload
    ? validateField(input.definition, "payload", input.payload)
    : input.payload;
  return input.definition.implementation.mount(input.target, {
    props,
    context: input.context,
    payload,
  });
}

/** Validate unknown persisted props and payload once at a DOM host boundary. */
export function validateDomComponentBoundary<TProps, THostContext, TPayload>(
  definition: ComponentOnceDomDefinition<TProps, THostContext, TPayload>,
  input: ComponentOnceDomBoundaryInput<THostContext>,
): ComponentOnceDomRenderInput<TProps, THostContext, TPayload> {
  return {
    props: validateField(definition, "props", input.props),
    context: input.context,
    payload: validateField(definition, "payload", input.payload),
  };
}

/** Check compatibility, validate one raw boundary, then mount without repeated checks. */
export function mountDomComponentBoundary<TProps, THostContext, TPayload>(
  input: ComponentOnceDomBoundaryMountInput<TProps, THostContext, TPayload>,
): ComponentOnceDomMountHandle<TProps, THostContext, TPayload> {
  assertDomCompatible(input);
  const validated = validateDomComponentBoundary(input.definition, input);
  return mountCompatibleDomComponent({
    definition: input.definition,
    target: input.target,
    ...validated,
  });
}

function assertDomCompatible<TProps, THostContext, TPayload>(
  input: ComponentOnceDomMountInput<TProps, THostContext, TPayload> |
    ComponentOnceDomBoundaryMountInput<TProps, THostContext, TPayload>,
): void {
  assertComponentOnceCompatible(
    input.definition.manifest,
    withDomCapability(input.hostCapabilities),
    input.capabilityCompatibility,
  );
}

/**
 * Create the normal application-facing DOM facade.
 *
 * The DOM capability is supplied by this adapter itself, so callers only bind application-specific
 * capabilities and compatibility policy once.
 */
export function createDomHost<THostContext>(
  options: ComponentOnceDomHostOptions = {},
): ComponentOnceDomHost<THostContext> {
  const hostCapabilities = options.capabilities;
  const capabilityCompatibility = options.capabilityCompatibility;
  return {
    define: <TProps, TPayload>(
      input: DefineDomComponentInput<TProps, THostContext, TPayload>,
    ) => defineDomComponent(input),
    mount: <TProps, TPayload>(
      input: ComponentOnceBoundDomMountInput<TProps, THostContext, TPayload>,
    ) => {
      const {
        hostCapabilities: _callerHostCapabilities,
        capabilityCompatibility: _callerCapabilityCompatibility,
        ...mountInput
      } = input as ComponentOnceDomMountInput<TProps, THostContext, TPayload>;
      return mountDomComponent({
        ...mountInput,
        ...(hostCapabilities === undefined ? {} : { hostCapabilities }),
        ...(capabilityCompatibility === undefined ? {} : { capabilityCompatibility }),
      });
    },
    validateBoundary: <TProps, TPayload>(
      definition: ComponentOnceDomDefinition<TProps, THostContext, TPayload>,
      input: ComponentOnceDomBoundaryInput<THostContext>,
    ) => validateDomComponentBoundary(definition, input),
    mountBoundary: <TProps, TPayload>(
      input: ComponentOnceBoundDomBoundaryMountInput<TProps, THostContext, TPayload>,
    ) => {
      const {
        hostCapabilities: _callerHostCapabilities,
        capabilityCompatibility: _callerCapabilityCompatibility,
        ...boundaryInput
      } = input as ComponentOnceDomBoundaryMountInput<TProps, THostContext, TPayload>;
      return mountDomComponentBoundary({
        ...boundaryInput,
        ...(hostCapabilities === undefined ? {} : { hostCapabilities }),
        ...(capabilityCompatibility === undefined ? {} : { capabilityCompatibility }),
      });
    },
  };
}

function withDomCapability(
  available: readonly ComponentOnceCapability[] | undefined,
): readonly ComponentOnceCapability[] {
  const extra = (available ?? []).filter((capability) => capability.name !== DOM_CAPABILITY_NAME);
  return [{ name: DOM_CAPABILITY_NAME, version: DOM_CAPABILITY_VERSION }, ...extra];
}

function normalizeValidation(
  validation: boolean | ComponentOnceDomValidationRequest | undefined,
): Required<ComponentOnceDomValidationRequest> {
  if (validation === true) return { props: true, payload: true };
  if (validation === false || validation === undefined) return { props: false, payload: false };
  return { props: validation.props ?? false, payload: validation.payload ?? false };
}

function validateField<TProps, THostContext, TPayload>(
  definition: ComponentOnceDomDefinition<TProps, THostContext, TPayload>,
  field: "props",
  value: unknown,
): TProps;
function validateField<TProps, THostContext, TPayload>(
  definition: ComponentOnceDomDefinition<TProps, THostContext, TPayload>,
  field: "payload",
  value: unknown,
): TPayload;
function validateField<TProps, THostContext, TPayload>(
  definition: ComponentOnceDomDefinition<TProps, THostContext, TPayload>,
  field: ComponentOnceDomValidationField,
  value: unknown,
): TProps | TPayload {
  const validator = field === "props" ? definition.validateProps : definition.validatePayload;
  if (validator === undefined) {
    throw new ComponentOnceDomValidatorMissingError(field, definition.manifest);
  }
  return validator(value);
}
