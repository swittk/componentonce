import type { ComponentOnceDiagnostic, ComponentOnceTrustedBundleArtifact } from "@componentonce/compiler-esbuild";

/** One compiler result kept in memory; revision is a dev update number, never a package version. */
export interface ComponentOnceDevArtifact {
  readonly revision: number;
  readonly definitionExport: string;
  readonly artifact: ComponentOnceTrustedBundleArtifact;
}

/** Small event-stream status; executable bundle bytes are fetched separately on success. */
export interface ComponentOnceDevStatus {
  readonly revision: number;
  readonly hostRevision: number;
  readonly stage: "source" | "host";
  readonly ok: boolean;
  readonly durationMs: number;
  readonly diagnostics: readonly ComponentOnceDiagnostic[];
}
