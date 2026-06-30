import { appendFile, readFile } from "node:fs/promises";

import type { BenchmarkEvent } from "@llm-bench/contracts";
import { BenchmarkEventSchema } from "@llm-bench/contracts";

/**
 * Append-only JSONL spool of benchmark events. Every event is validated against
 * the contract schema on the way in and on the way out, so a malformed or
 * forged record is rejected rather than silently trusted.
 */
export class JsonlEventSpool {
  constructor(private readonly filePath: string) {}

  /** Validates and appends a single event as one JSONL line. */
  async append(event: BenchmarkEvent): Promise<void> {
    const validated = BenchmarkEventSchema.parse(event);
    await appendFile(this.filePath, `${JSON.stringify(validated)}\n`, "utf8");
  }

  /** Reads every spooled event, rejecting any line that fails validation. */
  async events(): Promise<BenchmarkEvent[]> {
    const raw = await readFile(this.filePath, "utf8").catch(() => "");
    return raw
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => BenchmarkEventSchema.parse(JSON.parse(line)));
  }
}
