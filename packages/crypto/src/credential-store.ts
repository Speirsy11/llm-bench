import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { RunnerKeyPair, SealedCredential } from "./types";
import { SEALED_BOX_ALGORITHM } from "./types";

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
    if (keyPair.publicKey.length === 0 || keyPair.privateKey.length === 0) {
      throw new Error("Runner key pair is incomplete.");
    }
    await this.writePrivateFile(this.keyPairPath(), keyPair);
  }

  async keyPair(): Promise<RunnerKeyPair | null> {
    const raw = await this.readPrivate(this.keyPairPath());
    if (raw === null) return null;
    const value = raw as Partial<RunnerKeyPair>;
    if (typeof value.publicKey !== "string" || typeof value.privateKey !== "string") {
      throw new Error("Runner key pair file is malformed; re-pair the runner.");
    }
    return { publicKey: value.publicKey, privateKey: value.privateKey };
  }

  async saveSealedCredential(
    name: string,
    sealed: SealedCredential,
  ): Promise<void> {
    if (sealed.algorithm !== SEALED_BOX_ALGORITHM) {
      throw new Error("Refusing to store credential with unknown algorithm.");
    }
    await this.writePrivateFile(this.sealedPath(name), sealed);
  }

  async sealedCredential(name: string): Promise<SealedCredential | null> {
    const raw = await this.readPrivate(this.sealedPath(name));
    if (raw === null) return null;
    const value = raw as Partial<SealedCredential>;
    if (
      value.algorithm !== SEALED_BOX_ALGORITHM ||
      typeof value.runnerId !== "string" ||
      typeof value.keyFingerprint !== "string" ||
      typeof value.ciphertext !== "string"
    ) {
      throw new Error(`Sealed credential ${name} is malformed.`);
    }
    return {
      algorithm: value.algorithm,
      runnerId: value.runnerId,
      keyFingerprint: value.keyFingerprint,
      ciphertext: value.ciphertext,
    };
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
        if (error.code === "ENOENT") return null;
        throw error;
      },
    );
    return raw === null ? null : JSON.parse(raw);
  }
}
