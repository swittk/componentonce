import {
  assertComponentOnceCompatible,
  type ComponentOnceCapability,
  type ComponentOnceCapabilityCompatibility,
  type ComponentOnceDefinition,
  type ComponentOnceManifest,
  type ComponentOnceValidator,
} from "@componentonce/core";

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
  assertComponentOnceCompatible(
    input.definition.manifest,
    input.hostCapabilities ?? [],
    input.capabilityCompatibility,
  );
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

/** Validate one raw boundary then mount without a second validation pass. */
export function mountDomComponentBoundary<TProps, THostContext, TPayload>(
  input: ComponentOnceDomBoundaryMountInput<TProps, THostContext, TPayload>,
): ComponentOnceDomMountHandle<TProps, THostContext, TPayload> {
  const validated = validateDomComponentBoundary(input.definition, input);
  return mountDomComponent({
    definition: input.definition,
    target: input.target,
    ...validated,
    ...(input.hostCapabilities === undefined
      ? {}
      : { hostCapabilities: input.hostCapabilities }),
    ...(input.capabilityCompatibility === undefined
      ? {}
      : { capabilityCompatibility: input.capabilityCompatibility }),
  });
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
