import { randomUUID } from "node:crypto";
import {
  appendFile,
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
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
  private mutation = Promise.resolve();
  private flushes = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async append(event: BenchmarkEvent): Promise<BufferedEvent> {
    const validated = BenchmarkEventSchema.parse(event);
    return this.mutate(async () => {
      const pending = await this.readPending();
      const lastSequence = await this.lastSequence(pending);
      const item = { sequence: lastSequence + 1, event: validated };
      await this.ensureParent();
      await appendFile(this.filePath, `${JSON.stringify(item)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      await Promise.all([
        chmod(this.filePath, 0o600),
        this.persistSequence(item.sequence),
      ]);
      return item;
    });
  }

  async pending(): Promise<BufferedEvent[]> {
    return this.mutate(() => this.readPending());
  }

  private async readPending(): Promise<BufferedEvent[]> {
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
    const operation = this.flushes.then(async () => {
      const pending = await this.pending();
      if (pending.length === 0) return;
      const acknowledgement = await send(pending);
      await this.mutate(async () => {
        // Re-read after the network boundary so events appended while the send
        // was in flight cannot be erased by the acknowledgement rewrite.
        const current = await this.readPending();
        const remaining = current.filter(
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
      });
    });
    this.flushes = operation.catch(() => undefined);
    return operation;
  }

  private async lastSequence(pending: BufferedEvent[]): Promise<number> {
    const raw = await readFile(this.sequencePath(), "utf8").catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      },
    );
    if (raw === null) return pending.at(-1)?.sequence ?? -1;
    const sequence = Number(raw.trim());
    if (
      raw.trim().length === 0 ||
      !Number.isInteger(sequence) ||
      sequence < 0
    ) {
      const recovered = pending.at(-1)?.sequence;
      if (recovered !== undefined) return recovered;
      throw new Error("Runner event sequence file is invalid.");
    }
    return Math.max(sequence, pending.at(-1)?.sequence ?? -1);
  }

  private async persistSequence(sequence: number): Promise<void> {
    const path = this.sequencePath();
    const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, `${sequence}\n`, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      await chmod(temporaryPath, 0o600);
      await rename(temporaryPath, path);
      await chmod(path, 0o600);
    } finally {
      await rm(temporaryPath, { force: true });
    }
  }

  private sequencePath(): string {
    return `${this.filePath}.sequence`;
  }

  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutation.then(operation, operation);
    this.mutation = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async ensureParent(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
    await chmod(dirname(this.filePath), 0o700);
  }
}
