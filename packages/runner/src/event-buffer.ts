import {
  appendFile,
  chmod,
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { dirname } from "node:path";

import type { BenchmarkEvent } from "@llm-bench/contracts";
import { BenchmarkEventSchema } from "@llm-bench/contracts";

export interface BufferedEvent {
  sequence: number;
  event: BenchmarkEvent;
}

export class DurableEventBuffer {
  constructor(private readonly filePath: string) {}

  async append(event: BenchmarkEvent): Promise<BufferedEvent> {
    const validated = BenchmarkEventSchema.parse(event);
    const pending = await this.pending();
    const item = {
      sequence: (pending.at(-1)?.sequence ?? -1) + 1,
      event: validated,
    };
    await this.ensureParent();
    await appendFile(this.filePath, `${JSON.stringify(item)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await chmod(this.filePath, 0o600);
    return item;
  }

  async pending(): Promise<BufferedEvent[]> {
    const raw = await readFile(this.filePath, "utf8").catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return "";
        throw error;
      },
    );
    return raw
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const item = JSON.parse(line) as BufferedEvent;
        return { ...item, event: BenchmarkEventSchema.parse(item.event) };
      });
  }

  async flush(
    send: (events: BufferedEvent[]) => Promise<{ throughSequence: number }>,
  ): Promise<void> {
    const pending = await this.pending();
    if (pending.length === 0) return;
    const acknowledgement = await send(pending);
    const remaining = pending.filter(
      ({ sequence }) => sequence > acknowledgement.throughSequence,
    );
    await this.ensureParent();
    await writeFile(
      this.filePath,
      remaining.map((item) => JSON.stringify(item)).join("\n") +
        (remaining.length > 0 ? "\n" : ""),
      { encoding: "utf8", mode: 0o600 },
    );
    await chmod(this.filePath, 0o600);
  }

  private async ensureParent(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
    await chmod(dirname(this.filePath), 0o700);
  }
}
