import type { AdapterRunRequest, AdapterRunResult } from "@llm-bench/contracts";

export type ClaudeRunRequest = AdapterRunRequest;

export interface ClaudeRunResult extends AdapterRunResult {
  metadata: {
    harness: "claude";
    model: string;
    sandbox: "read-only" | "workspace-write";
    version: string | null;
  };
}
