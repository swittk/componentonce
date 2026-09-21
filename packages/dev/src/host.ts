import type { ReactElement, ReactNode } from "react";
import type { ComponentOnceCapability, ComponentOnceCapabilityCompatibility } from "@componentonce/core";

/** One host-defined visual variant exposed by the workbench without assuming a CSS/theme framework. */
export interface ComponentOnceDevThemeVariant {
  readonly value: string;
  readonly label: string;
}

/** A named, serializable preview scenario. Context input is data, not the host's functions. */
export interface ComponentOnceDevFixture<TProps = unknown, TPayload = unknown, TContextInput = unknown> {
  readonly name: string;
  readonly props: TProps;
  readonly payload: TPayload;
  readonly context?: TContextInput;
}

/** Browser-only host adapter: real externals, providers, initialization, and test scenarios. */
export interface ComponentOnceReactDevHost<TContext = unknown, TContextInput = unknown, TProps = unknown, TPayload = unknown> {
  readonly name?: string;
  /** Exact import specifier -> actual runtime singleton. React is supplied by the workbench. */
  readonly externals?: Readonly<Record<string, unknown>>;
  readonly capabilities?: readonly ComponentOnceCapability[];
  readonly capabilityCompatibility?: ComponentOnceCapabilityCompatibility;
  readonly fixtures?: readonly ComponentOnceDevFixture<TProps, TPayload, TContextInput>[];
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
export function defineReactDevHost<TContext = unknown, TContextInput = unknown, TProps = unknown, TPayload = unknown>(
  host: ComponentOnceReactDevHost<TContext, TContextInput, TProps, TPayload>,
): ComponentOnceReactDevHost<TContext, TContextInput, TProps, TPayload> {
  return host;
}
