import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { RunnerLease, RunnerTerminalRequest } from "@llm-bench/contracts";

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

export class RunnerStateStore {
  constructor(readonly root: string) {}

  async saveCredentials(credentials: RunnerCredentials): Promise<void> {
    await this.ensureRoot();
    const path = this.credentialsPath();
    await writeFile(path, `${JSON.stringify(credentials)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await chmod(path, 0o600);
  }

  async credentials(): Promise<RunnerCredentials | null> {
    const raw = await readFile(this.credentialsPath(), "utf8").catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      },
    );
    return raw === null ? null : (JSON.parse(raw) as RunnerCredentials);
  }

  async clearCredentials(): Promise<void> {
    await rm(this.credentialsPath(), { force: true });
  }

  async saveActiveJob(active: ActiveRunnerJob): Promise<void> {
    await this.writePrivate("active-job.json", active);
  }

  async activeJob(): Promise<ActiveRunnerJob | null> {
    return this.readPrivate<ActiveRunnerJob>("active-job.json");
  }

  async clearActiveJob(): Promise<void> {
    await rm(join(this.root, "active-job.json"), { force: true });
  }

  async saveProcessId(pid: number): Promise<void> {
    await this.writePrivate("runner.pid", { pid });
  }

  async processId(): Promise<number | null> {
    const value = await this.readPrivate<{ pid: number }>("runner.pid");
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

  private async writePrivate(name: string, value: unknown): Promise<void> {
    await this.ensureRoot();
    const path = join(this.root, name);
    await writeFile(path, `${JSON.stringify(value)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await chmod(path, 0o600);
  }

  private async readPrivate<T>(name: string): Promise<T | null> {
    const raw = await readFile(join(this.root, name), "utf8").catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      },
    );
    return raw === null ? null : (JSON.parse(raw) as T);
  }
}
