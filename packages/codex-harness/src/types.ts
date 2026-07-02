import type { AdapterRunRequest, AdapterRunResult } from "@llm-bench/contracts";

export type CodexRunRequest = AdapterRunRequest;

export interface CodexRunResult extends AdapterRunResult {
  metadata: {
    harness: "codex";
    model: string;
    sandbox: "read-only" | "workspace-write";
    version: string | null;
  };
}
