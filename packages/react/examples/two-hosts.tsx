import { renderReactComponent, defineReactComponent } from "@componentonce/react";

interface BannerProps {
  readonly prefix: string;
}

interface BrowserHostContext {
  readonly kind: "browser";
  readonly locale: string;
  readonly navigate: (path: string) => void;
}

interface WorkerHostContext {
  readonly kind: "worker";
  readonly jobName: string;
  readonly retry: (jobId: number) => Promise<void>;
}

interface PagePayload {
  readonly kind: "page";
  readonly pathname: string;
}

interface JobPayload {
  readonly kind: "job";
  readonly jobId: number;
  readonly attempt: number;
}

type HostContext = BrowserHostContext | WorkerHostContext;
type Payload = PagePayload | JobPayload;

// One exact module accepts the two host-owned type pairs without ComponentOnce
// knowing either shape.
const statusBanner = defineReactComponent<BannerProps, HostContext, Payload>({
  manifest: { id: "example/status-banner", version: "1.0.0" },
  component: ({ props, context, payload }) => {
    const host = context.kind === "browser" ? context.locale : context.jobName;
    const value = payload.kind === "page" ? payload.pathname : `attempt ${payload.attempt}`;
    return <strong>{props.prefix}: {host} / {value}</strong>;
  },
});

/** The same exact definition rendered inside a browser application. */
export const browserElement = renderReactComponent({
  definition: statusBanner,
  props: { prefix: "Status" },
  context: {
    kind: "browser",
    locale: "en-GB",
    navigate: () => undefined,
  },
  payload: { kind: "page", pathname: "/reports" },
});

/** The same exact definition rendered inside a background worker application. */
export const workerElement = renderReactComponent({
  definition: statusBanner,
  props: { prefix: "Status" },
  context: {
    kind: "worker",
    jobName: "monthly-report",
    retry: async () => undefined,
  },
  payload: { kind: "job", jobId: 81, attempt: 2 },
});
