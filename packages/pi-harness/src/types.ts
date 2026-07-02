import type { AdapterRunRequest, AdapterRunResult } from "@llm-bench/contracts";

export type PiRunRequest = AdapterRunRequest;

export interface PiRunResult extends AdapterRunResult {
  metadata: {
    harness: "pi";
    model: string;
    version: string | null;
  };
}
