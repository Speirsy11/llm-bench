import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

import type { RunnerLease, RunnerTerminalRequest } from "@llm-bench/contracts";
import {
  RunnerLeaseSchema,
  RunnerTerminalRequestSchema,
} from "@llm-bench/contracts";

export interface RunnerCredentials {
  serverUrl: string;
  runnerId: string;
  token: string;
  publicKey: string;
  privateKey: string;
}

export interface ActiveRunnerJob {
  lease: RunnerLease;
  terminal: Omit<
    RunnerTerminalRequest,
    "protocolVersion" | "attemptId" | "leaseToken"
  > | null;
  artifactsUploaded: boolean;
}

const RunnerCredentialsSchema = z.strictObject({
  serverUrl: z.string().min(1),
  runnerId: z.string().min(1),
  token: z.string().min(1),
  publicKey: z.string().min(1),
  privateKey: z.string().min(1),
});

const ActiveRunnerJobSchema = z.strictObject({
  lease: RunnerLeaseSchema,
  terminal: RunnerTerminalRequestSchema.omit({
    protocolVersion: true,
    attemptId: true,
    leaseToken: true,
  }).nullable(),
  artifactsUploaded: z.boolean(),
});

const ProcessIdSchema = z.strictObject({
  pid: z.number().int().positive(),
});

export class RunnerStateStore {
  constructor(readonly root: string) {}

  async saveCredentials(credentials: RunnerCredentials): Promise<void> {
    await this.writePrivateFile(this.credentialsPath(), credentials);
  }

  async credentials(): Promise<RunnerCredentials | null> {
    const raw = await readFile(this.credentialsPath(), "utf8").catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      },
    );
    return raw === null
      ? null
      : parsePrivateJson(raw, RunnerCredentialsSchema, "credentials.json");
  }

  async clearCredentials(): Promise<void> {
    await rm(this.credentialsPath(), { force: true });
  }

  async saveActiveJob(active: ActiveRunnerJob): Promise<void> {
    await this.writePrivateFile(join(this.root, "active-job.json"), active);
  }

  async activeJob(): Promise<ActiveRunnerJob | null> {
    return this.readPrivate("active-job.json", ActiveRunnerJobSchema);
  }

  async clearActiveJob(): Promise<void> {
    await rm(join(this.root, "active-job.json"), { force: true });
  }

  async saveProcessId(pid: number): Promise<void> {
    await this.writePrivateFile(join(this.root, "runner.pid"), { pid });
  }

  async processId(): Promise<number | null> {
    const value = await this.readPrivate("runner.pid", ProcessIdSchema);
    return value?.pid ?? null;
  }

  async clearProcessId(): Promise<void> {
    await rm(join(this.root, "runner.pid"), { force: true });
  }

  path(name: "events" | "checkpoints" | "artifacts"): string {
    return join(this.root, name);
  }

  async ensureRoot(): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    await chmod(this.root, 0o700);
  }

  private credentialsPath(): string {
    return join(this.root, "credentials.json");
  }

  private async writePrivateFile(path: string, value: unknown): Promise<void> {
    await this.ensureRoot();
    const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(value)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, path);
    await chmod(path, 0o600);
  }

  private async readPrivate<T extends z.ZodType>(
    name: string,
    schema: T,
  ): Promise<z.infer<T> | null> {
    const raw = await readFile(join(this.root, name), "utf8").catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      },
    );
    return raw === null ? null : parsePrivateJson(raw, schema, name);
  }
}

function parsePrivateJson<T extends z.ZodType>(
  raw: string,
  schema: T,
  name: string,
): z.infer<T> {
  try {
    return schema.parse(JSON.parse(raw));
  } catch (error) {
    throw new Error(
      `Runner state file ${name} is invalid; remove it and run login/start again.`,
      { cause: error },
    );
  }
}
