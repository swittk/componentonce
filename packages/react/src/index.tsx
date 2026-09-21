import { createElement, version as reactVersion, type ComponentType, type ReactElement } from "react";
import {
  assertComponentOnceCompatible,
  type ComponentOnceCapability,
  type ComponentOnceCapabilityCompatibility,
  type ComponentOnceDefinition,
  type ComponentOnceManifest,
  type ComponentOnceRequirement,
  type ComponentOnceValidator,
} from "@componentonce/core";

/** Stable core capability name used for the host React runtime. */
export const REACT_CAPABILITY_NAME = "react";

/** Create an explicit React runtime requirement recorded in the component manifest. */
export function createReactRequirement(version: string): ComponentOnceRequirement {
  return { name: REACT_CAPABILITY_NAME, version };
}

/** Props passed to one trusted React implementation by its host. */
export interface ComponentOnceReactRenderInput<TProps, THostContext, TPayload> {
  readonly props: TProps;
  readonly context: THostContext;
  readonly payload: TPayload;
}

/** React implementation shape registered with ComponentOnce. */
export type ComponentOnceReactComponent<TProps, THostContext, TPayload> =
  ComponentType<ComponentOnceReactRenderInput<TProps, THostContext, TPayload>>;

/** A core definition whose implementation is a typed React component. */
export type ComponentOnceReactDefinition<TProps, THostContext, TPayload> =
  ComponentOnceDefinition<
    ComponentOnceReactComponent<TProps, THostContext, TPayload>,
    TProps,
    THostContext,
    TPayload
  >;

/** Input used to define one typed React component. */
export interface DefineReactComponentInput<TProps, THostContext, TPayload> {
  readonly manifest: ComponentOnceManifest;
  readonly component: ComponentOnceReactComponent<TProps, THostContext, TPayload>;
  readonly validateProps?: ComponentOnceValidator<TProps>;
  readonly validatePayload?: ComponentOnceValidator<TPayload>;
}

/** Selects typed values that the renderer should explicitly revalidate. */
export interface ComponentOnceReactValidationRequest {
  readonly props?: boolean;
  readonly payload?: boolean;
}

/** Input used to render an already typed exact React definition. */
export interface ComponentOnceReactRendererInput<TProps, THostContext, TPayload>
  extends ComponentOnceReactRenderInput<TProps, THostContext, TPayload> {
  readonly definition: ComponentOnceReactDefinition<TProps, THostContext, TPayload>;
  /** Validation is off by default; `true` requests both validators. */
  readonly validation?: boolean | ComponentOnceReactValidationRequest;
  /** Runtime/application capabilities exposed by the host. */
  readonly hostCapabilities?: readonly ComponentOnceCapability[];
  /** Optional host-defined compatibility policy; exact matching is the core default. */
  readonly capabilityCompatibility?: ComponentOnceCapabilityCompatibility;
}

/** Unknown props and payload received at an untyped host boundary. */
export interface ComponentOnceReactBoundaryInput<THostContext> {
  readonly props: unknown;
  readonly context: THostContext;
  readonly payload: unknown;
}

/** The definition and raw values needed to validate an untyped render boundary. */
export interface ComponentOnceReactBoundaryRenderInput<TProps, THostContext, TPayload>
  extends ComponentOnceReactBoundaryInput<THostContext> {
  readonly definition: ComponentOnceReactDefinition<TProps, THostContext, TPayload>;
  /** Runtime/application capabilities exposed by the host. */
  readonly hostCapabilities?: readonly ComponentOnceCapability[];
  /** Optional host-defined compatibility policy; exact matching is the core default. */
  readonly capabilityCompatibility?: ComponentOnceCapabilityCompatibility;
}

/** A definition field that can carry an optional boundary validator. */
export type ComponentOnceReactValidationField = "props" | "payload";

/** Thrown when a caller requests boundary validation that a definition does not provide. */
export class ComponentOnceReactValidatorMissingError extends Error {
  public readonly field: ComponentOnceReactValidationField;
  public readonly manifest: ComponentOnceManifest;

  public constructor(
    field: ComponentOnceReactValidationField,
    manifest: ComponentOnceManifest,
  ) {
    super(
      `Component "${manifest.id}" version "${manifest.version}" has no ${field} validator.`,
    );
    this.name = new.target.name;
    this.field = field;
    this.manifest = manifest;
  }
}

/** Helpers with host context and payload types fixed for one application integration. */
export interface ComponentOnceReactHostHelpers<THostContext, TPayload> {
  /** Define a component while inferring only its persisted props type. */
  define<TProps>(
    input: DefineReactComponentInput<TProps, THostContext, TPayload>,
  ): ComponentOnceReactDefinition<TProps, THostContext, TPayload>;
  /** Render typed values without validation unless the request explicitly enables it. */
  render<TProps>(
    input: ComponentOnceReactRendererInput<TProps, THostContext, TPayload>,
  ): ReactElement;
  /** Validate unknown props and payload once and preserve the host context unchanged. */
  validateBoundary<TProps>(
    definition: ComponentOnceReactDefinition<TProps, THostContext, TPayload>,
    input: ComponentOnceReactBoundaryInput<THostContext>,
  ): ComponentOnceReactRenderInput<TProps, THostContext, TPayload>;
  /** Validate and render values received from an untyped boundary. */
  renderBoundary<TProps>(
    input: ComponentOnceReactBoundaryRenderInput<TProps, THostContext, TPayload>,
  ): ReactElement;
}

/** Host-wide runtime policy bound once by createReactHost. */
export interface ComponentOnceReactHostOptions {
  /** Additional application/runtime capabilities; the actual peer React version is added automatically. */
  readonly capabilities?: readonly ComponentOnceCapability[];
  /** Optional compatibility rule shared by every render from this host helper. */
  readonly capabilityCompatibility?: ComponentOnceCapabilityCompatibility;
}

/** Render input for a host whose capability policy has already been bound. */
export type ComponentOnceBoundReactRendererInput<TProps, THostContext, TPayload> = Omit<
  ComponentOnceReactRendererInput<TProps, THostContext, TPayload>,
  "hostCapabilities" | "capabilityCompatibility"
>;

/** Boundary render input for a host whose capability policy has already been bound. */
export type ComponentOnceBoundReactBoundaryRenderInput<TProps, THostContext, TPayload> = Omit<
  ComponentOnceReactBoundaryRenderInput<TProps, THostContext, TPayload>,
  "hostCapabilities" | "capabilityCompatibility"
>;

/** Concise React host facade with application types and runtime compatibility policy fixed once. */
export interface ComponentOnceReactHost<THostContext> {
  /** Define a component while choosing its own persisted Props and per-render Payload types. */
  define<TProps, TPayload>(
    input: DefineReactComponentInput<TProps, THostContext, TPayload>,
  ): ComponentOnceReactDefinition<TProps, THostContext, TPayload>;
  /** Render typed values using the host-wide capability policy. */
  render<TProps, TPayload>(
    input: ComponentOnceBoundReactRendererInput<TProps, THostContext, TPayload>,
  ): ReactElement;
  /** Validate unknown props/payload without changing the trusted host context. */
  validateBoundary<TProps, TPayload>(
    definition: ComponentOnceReactDefinition<TProps, THostContext, TPayload>,
    input: ComponentOnceReactBoundaryInput<THostContext>,
  ): ComponentOnceReactRenderInput<TProps, THostContext, TPayload>;
  /** Validate and render unknown boundary values using the host-wide capability policy. */
  renderBoundary<TProps, TPayload>(
    input: ComponentOnceBoundReactBoundaryRenderInput<TProps, THostContext, TPayload>,
  ): ReactElement;
}

/** Define one typed React component without teaching core anything about React. */
export function defineReactComponent<TProps, THostContext, TPayload>(
  input: DefineReactComponentInput<TProps, THostContext, TPayload>,
): ComponentOnceReactDefinition<TProps, THostContext, TPayload> {
  return {
    manifest: input.manifest,
    implementation: input.component,
    ...(input.validateProps === undefined ? {} : { validateProps: input.validateProps }),
    ...(input.validatePayload === undefined ? {} : { validatePayload: input.validatePayload }),
  };
}

/** Render an exact React definition, with optional validation requested by the host. */
export function renderReactComponent<TProps, THostContext, TPayload>(
  input: ComponentOnceReactRendererInput<TProps, THostContext, TPayload>,
): ReactElement {
  assertReactCompatible(input);
  return renderCompatibleReactComponent(input);
}

function renderCompatibleReactComponent<TProps, THostContext, TPayload>(
  input: ComponentOnceReactRendererInput<TProps, THostContext, TPayload>,
): ReactElement {
  const validation = normalizeValidation(input.validation);
  const props = validation.props
    ? validateField(input.definition, "props", input.props)
    : input.props;
  const payload = validation.payload
    ? validateField(input.definition, "payload", input.payload)
    : input.payload;

  return createElement(input.definition.implementation, {
    props,
    context: input.context,
    payload,
  });
}

/** Validate unknown props and payload once at a host boundary. */
export function validateReactComponentBoundary<TProps, THostContext, TPayload>(
  definition: ComponentOnceReactDefinition<TProps, THostContext, TPayload>,
  input: ComponentOnceReactBoundaryInput<THostContext>,
): ComponentOnceReactRenderInput<TProps, THostContext, TPayload> {
  return {
    props: validateField(definition, "props", input.props),
    context: input.context,
    payload: validateField(definition, "payload", input.payload),
  };
}

/** Check compatibility, validate unknown boundary values, then render without repeated checks. */
export function renderReactComponentBoundary<TProps, THostContext, TPayload>(
  input: ComponentOnceReactBoundaryRenderInput<TProps, THostContext, TPayload>,
): ReactElement {
  assertReactCompatible(input);
  const validated = validateReactComponentBoundary(input.definition, input);
  return renderCompatibleReactComponent({
    definition: input.definition,
    ...validated,
  });
}

function assertReactCompatible<TProps, THostContext, TPayload>(
  input: ComponentOnceReactRendererInput<TProps, THostContext, TPayload> |
    ComponentOnceReactBoundaryRenderInput<TProps, THostContext, TPayload>,
): void {
  assertComponentOnceCompatible(
    input.definition.manifest,
    withReactCapability(input.hostCapabilities),
    input.capabilityCompatibility,
  );
}

/** Create concise definition and rendering helpers pinned to one host's own types. */
export function createReactHostHelpers<THostContext, TPayload>(): ComponentOnceReactHostHelpers<
  THostContext,
  TPayload
> {
  return {
    define: <TProps,>(input: DefineReactComponentInput<TProps, THostContext, TPayload>) =>
      defineReactComponent(input),
    render: <TProps,>(input: ComponentOnceReactRendererInput<TProps, THostContext, TPayload>) =>
      renderReactComponent(input),
    validateBoundary: <TProps, TPayload>(
      definition: ComponentOnceReactDefinition<TProps, THostContext, TPayload>,
      input: ComponentOnceReactBoundaryInput<THostContext>,
    ) => validateReactComponentBoundary(definition, input),
    renderBoundary: <TProps,>(
      input: ComponentOnceReactBoundaryRenderInput<TProps, THostContext, TPayload>,
    ) => renderReactComponentBoundary(input),
  };
}

/**
 * Create the normal application-facing React facade.
 *
 * The React capability comes from this package's peer React singleton, so callers only provide
 * additional host capabilities once instead of repeating them on every render.
 */
export function createReactHost<THostContext>(
  options: ComponentOnceReactHostOptions = {},
): ComponentOnceReactHost<THostContext> {
  const hostCapabilities = options.capabilities;
  const capabilityCompatibility = options.capabilityCompatibility;
  return {
    define: <TProps, TPayload>(
      input: DefineReactComponentInput<TProps, THostContext, TPayload>,
    ) => defineReactComponent(input),
    render: <TProps, TPayload>(
      input: ComponentOnceBoundReactRendererInput<TProps, THostContext, TPayload>,
    ) => {
      const {
        hostCapabilities: _callerHostCapabilities,
        capabilityCompatibility: _callerCapabilityCompatibility,
        ...renderInput
      } = input as ComponentOnceReactRendererInput<TProps, THostContext, TPayload>;
      return renderReactComponent({
        ...renderInput,
        ...(hostCapabilities === undefined ? {} : { hostCapabilities }),
        ...(capabilityCompatibility === undefined ? {} : { capabilityCompatibility }),
      });
    },
    validateBoundary: <TProps, TPayload>(
      definition: ComponentOnceReactDefinition<TProps, THostContext, TPayload>,
      input: ComponentOnceReactBoundaryInput<THostContext>,
    ) => validateReactComponentBoundary(definition, input),
    renderBoundary: <TProps, TPayload>(
      input: ComponentOnceBoundReactBoundaryRenderInput<TProps, THostContext, TPayload>,
    ) => {
      const {
        hostCapabilities: _callerHostCapabilities,
        capabilityCompatibility: _callerCapabilityCompatibility,
        ...boundaryInput
      } = input as ComponentOnceReactBoundaryRenderInput<TProps, THostContext, TPayload>;
      return renderReactComponentBoundary({
        ...boundaryInput,
        ...(hostCapabilities === undefined ? {} : { hostCapabilities }),
        ...(capabilityCompatibility === undefined ? {} : { capabilityCompatibility }),
      });
    },
  };
}

function withReactCapability(
  available: readonly ComponentOnceCapability[] | undefined,
): readonly ComponentOnceCapability[] {
  const extra = (available ?? []).filter((capability) => capability.name !== REACT_CAPABILITY_NAME);
  return [{ name: REACT_CAPABILITY_NAME, version: reactVersion }, ...extra];
}

function normalizeValidation(
  validation: boolean | ComponentOnceReactValidationRequest | undefined,
): Required<ComponentOnceReactValidationRequest> {
  if (validation === true) return { props: true, payload: true };
  if (validation === false || validation === undefined) {
    return { props: false, payload: false };
  }
  return {
    props: validation.props ?? false,
    payload: validation.payload ?? false,
  };
}

function validateField<TProps, THostContext, TPayload>(
  definition: ComponentOnceReactDefinition<TProps, THostContext, TPayload>,
  field: "props",
  value: unknown,
): TProps;
function validateField<TProps, THostContext, TPayload>(
  definition: ComponentOnceReactDefinition<TProps, THostContext, TPayload>,
  field: "payload",
  value: unknown,
): TPayload;
function validateField<TProps, THostContext, TPayload>(
  definition: ComponentOnceReactDefinition<TProps, THostContext, TPayload>,
  field: ComponentOnceReactValidationField,
  value: unknown,
): TProps | TPayload {
  const validator = field === "props" ? definition.validateProps : definition.validatePayload;
  if (validator === undefined) {
    throw new ComponentOnceReactValidatorMissingError(field, definition.manifest);
  }
  return validator(value);
}
