import { describe, expect, it } from "vitest";

import type { RunnerIdentity } from "@llm-bench/crypto";
import { generateRunnerKeyPair, sealCredential } from "@llm-bench/crypto";

import {
  CredentialResolutionError,
  CredentialResolver,
} from "./credential-resolver";

async function runner(runnerId: string): Promise<RunnerIdentity> {
  return { runnerId, ...(await generateRunnerKeyPair()) };
}

const RUNNER_A_ID = "00000000-0000-4000-8000-00000000000a";
const RUNNER_B_ID = "00000000-0000-4000-8000-00000000000b";

describe("CredentialResolver", () => {
  it("resolves a credential sealed for this runner", async () => {
    const runnerA = await runner(RUNNER_A_ID);
    const sealed = await sealCredential({
      runnerId: runnerA.runnerId,
      recipientPublicKey: runnerA.publicKey,
      secret: "sk-or-canary",
    });
    const resolver = new CredentialResolver(runnerA, { openrouter: sealed });

    expect(resolver.available()).toEqual(["openrouter"]);
    const secret = await resolver.resolve("openrouter");
    expect(secret.reveal()).toBe("sk-or-canary");
  });

  it("denies a credential sealed for a different runner", async () => {
    const runnerA = await runner(RUNNER_A_ID);
    const runnerB = await runner(RUNNER_B_ID);
    const sealed = await sealCredential({
      runnerId: runnerA.runnerId,
      recipientPublicKey: runnerA.publicKey,
      secret: "sk-or-canary",
    });
    const resolver = new CredentialResolver(runnerB, { openrouter: sealed });

    await expect(resolver.resolve("openrouter")).rejects.toMatchObject({
      reason: "wrong-runner",
    });
  });

  it("rejects an unregistered requirement", async () => {
    const resolver = new CredentialResolver(await runner(RUNNER_A_ID));
    await expect(resolver.resolve("openrouter")).rejects.toBeInstanceOf(
      CredentialResolutionError,
    );
  });
});
