import type { ComponentType } from "react";
import type {
  ComponentOnceDefinition,
  ComponentOnceManifest,
  ComponentOnceValidator,
} from "@componentonce/core";

/** Props passed to one trusted React implementation by its host. */
export interface ComponentOnceReactRenderInput<TProps, THostContext, TPayload> {
  readonly props: TProps;
  readonly context: THostContext;
  readonly payload: TPayload;
}

/** React implementation shape registered with ComponentOnce. */
export type ComponentOnceReactComponent<TProps, THostContext, TPayload> =
  ComponentType<ComponentOnceReactRenderInput<TProps, THostContext, TPayload>>;

/** Define one typed React component without teaching core anything about React. */
export function defineReactComponent<TProps, THostContext, TPayload>(input: {
  readonly manifest: ComponentOnceManifest;
  readonly component: ComponentOnceReactComponent<TProps, THostContext, TPayload>;
  readonly validateProps?: ComponentOnceValidator<TProps>;
  readonly validatePayload?: ComponentOnceValidator<TPayload>;
}): ComponentOnceDefinition<
  ComponentOnceReactComponent<TProps, THostContext, TPayload>,
  TProps,
  THostContext,
  TPayload
> {
  return {
    manifest: input.manifest,
    implementation: input.component,
    ...(input.validateProps === undefined ? {} : { validateProps: input.validateProps }),
    ...(input.validatePayload === undefined ? {} : { validatePayload: input.validatePayload }),
  };
}
