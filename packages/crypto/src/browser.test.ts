import { describe, expect, it } from "vitest";

import { SEALED_CREDENTIAL_ALGORITHM } from "@llm-bench/contracts";

import { sealCredential } from "./browser";
import { generateRunnerKeyPair } from "./keys";
import { openCredential } from "./sealed-box";

describe("browser credential surface", () => {
  it("round-trips browser sealing through runner opening with production raw keys", async () => {
    const runnerId = "70b70847-ec1c-4aeb-ac0f-bf7db0328efe";
    const keys = await generateRunnerKeyPair();
    const sealed = await sealCredential({
      runnerId,
      recipientPublicKey: keys.publicKey,
      secret: "sk-or-browser-canary",
    });

    expect(sealed).toMatchObject({
      algorithm: SEALED_CREDENTIAL_ALGORITHM,
      runnerId,
    });
    expect(JSON.stringify(sealed)).not.toContain("browser-canary");
    const opened = await openCredential(sealed, { runnerId, ...keys });
    expect(opened.reveal()).toBe("sk-or-browser-canary");
  });
});
