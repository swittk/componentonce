import type { ReactElement, ReactNode } from "react";
import type {
  ComponentOnceCapability,
  ComponentOnceCapabilityCompatibility,
} from "@componentonce/core";

/** One host-defined visual variant exposed by the workbench without assuming a CSS/theme framework. */
export interface ComponentOnceDevThemeVariant {
  readonly value: string;
  readonly label: string;
}

/** Serializable marker resolved to one host-owned callable before preview validation/rendering. */
export interface ComponentOnceDevFunctionReference {
  readonly $componentonceFunction: string;
  /** Optional leading arguments bound ahead of arguments supplied by the component at call time. */
  readonly bind?: readonly unknown[];
}

/** Any callable implementation exposed only by the browser host profile. */
export type ComponentOnceDevFunction = (...args: never[]) => unknown;

/** Described actual/mock callable shown in the workbench catalog. */
export interface ComponentOnceDevFunctionEntry {
  readonly call: ComponentOnceDevFunction;
  readonly description?: string;
  readonly mode?: "actual" | "mock";
}

/**
 * Serializable development input for a real runtime value.
 * Function-valued fields become host-catalog references while ordinary nested values retain shape.
 */
export type ComponentOnceDevInput<T> =
  T extends (...args: never[]) => unknown
    ? ComponentOnceDevFunctionReference
    : T extends readonly (infer TItem)[]
      ? readonly ComponentOnceDevInput<TItem>[]
      : T extends object
        ? { readonly [TKey in keyof T]: ComponentOnceDevInput<T[TKey]> }
        : T;

/** A named, serializable preview scenario. Callables use ComponentOnceDevFunctionReference markers. */
export interface ComponentOnceDevFixture<
  TProps = unknown,
  TPayload = unknown,
  TContextInput = unknown,
> {
  readonly name: string;
  readonly props: ComponentOnceDevInput<TProps>;
  readonly payload: ComponentOnceDevInput<TPayload>;
  readonly context?: ComponentOnceDevInput<TContextInput>;
}

/** Browser-only host adapter: real externals, providers, callables, initialization, and test scenarios. */
export interface ComponentOnceReactDevHost<
  TContext = unknown,
  TContextInput = unknown,
  TProps = unknown,
  TPayload = unknown,
> {
  readonly name?: string;
  /** Exact import specifier -> actual runtime singleton. React is supplied by the workbench. */
  readonly externals?: Readonly<Record<string, unknown>>;
  readonly capabilities?: readonly ComponentOnceCapability[];
  readonly capabilityCompatibility?: ComponentOnceCapabilityCompatibility;
  /**
   * Named actual or mock callables available to fixture markers.
   * The component receives ordinary function values; this catalog never enters persisted component props.
   */
  readonly functions?: Readonly<
    Record<string, ComponentOnceDevFunction | ComponentOnceDevFunctionEntry>
  >;
  readonly fixtures?: readonly ComponentOnceDevFixture<
    TProps,
    TPayload,
    TContextInput
  >[];
  /** Optional host-defined visual variants. The workbench assumes no CSS framework or naming convention. */
  readonly themes?: readonly ComponentOnceDevThemeVariant[];
  /** Apply the selected host visual variant. Defaults to setting documentElement.dataset.theme. */
  readonly applyTheme?: (value: string) => void;
  /** Called in the browser once before any component executes. Never run by the Node compiler. */
  readonly setup?: () => void | Promise<void>;
  readonly createContext?: (input: TContextInput) => TContext;
  /** Supply providers/theme/query cache around the real component. */
  readonly wrap?: (element: ReactElement, context: TContext) => ReactNode;
  /** Release host-owned resources when the preview frame is replaced/closed. */
  readonly dispose?: () => void;
}

/** Type a host profile without coupling ComponentOnce to a product or changing its values. */
export function defineReactDevHost<
  TContext = unknown,
  TContextInput = unknown,
  TProps = unknown,
  TPayload = unknown,
>(
  host: ComponentOnceReactDevHost<TContext, TContextInput, TProps, TPayload>,
): ComponentOnceReactDevHost<TContext, TContextInput, TProps, TPayload> {
  return host;
}
