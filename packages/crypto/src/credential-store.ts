import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import {
  RawX25519KeySchema,
  RunnerPublicKeySchema,
  SealedCredentialSchema,
} from "@llm-bench/contracts";

import type { RunnerKeyPair, SealedCredential } from "./types";

/**
 * Protected on-disk store for a runner's private key and the sealed credentials
 * addressed to it. The key pair and every sealed blob are written atomically
 * with `0600` permissions under a `0700` directory. Plaintext secrets are never
 * written here — only ciphertext produced by {@link sealCredential}.
 */
export class RunnerCredentialStore {
  constructor(readonly root: string) {}

  async ensureRoot(): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    await chmod(this.root, 0o700);
  }

  async saveKeyPair(keyPair: RunnerKeyPair): Promise<void> {
    const parsed = parseKeyPair(keyPair);
    if (!parsed) {
      throw new Error(
        "Runner key pair is incomplete or not canonical raw 32-byte X25519 material.",
      );
    }
    await this.writePrivateFile(this.keyPairPath(), parsed);
  }

  async keyPair(): Promise<RunnerKeyPair | null> {
    const raw = await this.readPrivate(this.keyPairPath());
    if (raw === undefined) return null;
    const value = parseKeyPair(raw);
    if (!value) {
      throw new Error("Runner key pair file is malformed; re-pair the runner.");
    }
    return value;
  }

  async saveSealedCredential(
    name: string,
    sealed: SealedCredential,
  ): Promise<void> {
    const parsed = SealedCredentialSchema.safeParse(sealed);
    if (!parsed.success) {
      throw new Error("Refusing to store credential with unknown algorithm.");
    }
    await this.writePrivateFile(this.sealedPath(name), parsed.data);
  }

  async sealedCredential(name: string): Promise<SealedCredential | null> {
    const raw = await this.readPrivate(this.sealedPath(name));
    if (raw === undefined) return null;
    const value = SealedCredentialSchema.safeParse(raw);
    if (!value.success) {
      throw new Error(`Sealed credential ${name} is malformed.`);
    }
    return value.data;
  }

  async deleteSealedCredential(name: string): Promise<void> {
    await rm(this.sealedPath(name), { force: true });
  }

  private keyPairPath(): string {
    return join(this.root, "runner-key.json");
  }

  private sealedPath(name: string): string {
    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(name)) {
      throw new Error(`Invalid credential name: ${name}`);
    }
    return join(this.root, `credential-${name}.json`);
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

  private async readPrivate(path: string): Promise<unknown> {
    const raw = await readFile(path, "utf8").catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return undefined;
        throw error;
      },
    );
    return raw === undefined ? undefined : JSON.parse(raw);
  }
}

function parseKeyPair(value: unknown): RunnerKeyPair | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Partial<RunnerKeyPair>;
  const publicKey = RunnerPublicKeySchema.safeParse(candidate.publicKey);
  const privateKey = RawX25519KeySchema.safeParse(candidate.privateKey);
  return publicKey.success && privateKey.success
    ? { publicKey: publicKey.data, privateKey: privateKey.data }
    : null;
}
