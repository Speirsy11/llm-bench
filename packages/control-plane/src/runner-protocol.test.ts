import { describe, expect, it } from "vitest";

import {
  createInMemoryRunnerProtocolStore,
  createRunnerProtocolService,
} from "./runner-protocol";

const pairingInput = {
  protocolVersion: "1.0" as const,
  name: "fixture-runner",
  publicKey: "public-key",
  capabilities: ["workspaces", "files"] as ("workspaces" | "files")[],
  environment: {
    os: "linux" as const,
    architecture: "arm64",
    cpuClass: "fixture-cpu",
    memoryMb: 8192,
    runtimeVersions: { node: "22.21.0" },
    harnessVersions: {},
    sandboxMode: "process",
    contentHashes: { runner: "sha256:runner" },
  },
};

describe("runner pairing", () => {
  it("returns a runner token once and persists only its hash", async () => {
    const store = createInMemoryRunnerProtocolStore();
    const service = createRunnerProtocolService({
      store,
      now: () => new Date("2026-07-01T10:00:00.000Z"),
      randomToken: (() => {
        const values = ["device-secret", "USER-CODE", "runner-secret"];
        return () => values.shift() ?? "unused";
      })(),
    });

    const pairing = await service.startPairing(pairingInput);
    await service.approvePairing(
      { userId: "owner-1", githubLogin: "owner", isAdmin: false },
      pairing.userCode,
    );
    const approved = await service.pollPairing(pairing.deviceCode);

    expect(approved).toMatchObject({
      status: "approved",
      token: "runner-secret",
    });
    await expect(service.pollPairing(pairing.deviceCode)).rejects.toThrow(
      "Pairing code has already been consumed.",
    );
    await expect(service.authenticate("runner-secret")).resolves.toMatchObject({
      ownerId: "owner-1",
      name: "fixture-runner",
    });
    expect(JSON.stringify(store.inspect())).not.toContain("runner-secret");
    expect(JSON.stringify(store.inspect())).not.toContain("USER-CODE");
  });

  it("allows only one poller to consume an approved pairing", async () => {
    const service = createRunnerProtocolService({
      store: createInMemoryRunnerProtocolStore(),
      randomToken: (() => {
        const values = ["device", "CODE", "token-one", "token-two"];
        return () => values.shift() ?? "unused";
      })(),
    });
    const pairing = await service.startPairing(pairingInput);
    await service.approvePairing(
      { userId: "owner", githubLogin: "owner", isAdmin: false },
      pairing.userCode,
    );

    const polls = await Promise.allSettled([
      service.pollPairing(pairing.deviceCode),
      service.pollPairing(pairing.deviceCode),
    ]);

    expect(polls.filter(({ status }) => status === "fulfilled")).toHaveLength(
      1,
    );
    expect(polls.filter(({ status }) => status === "rejected")).toHaveLength(1);
    const approval = polls.find(
      (
        poll,
      ): poll is PromiseFulfilledResult<
        Awaited<ReturnType<typeof service.pollPairing>>
      > => poll.status === "fulfilled",
    )?.value;
    if (approval?.status !== "approved") {
      throw new Error("Expected one approved poll.");
    }
    await expect(service.authenticate(approval.token)).resolves.toMatchObject({
      ownerId: "owner",
    });
  });

  it("rejects an expired code and a second user's approval", async () => {
    let currentTime = new Date("2026-07-01T10:00:00.000Z");
    const service = createRunnerProtocolService({
      store: createInMemoryRunnerProtocolStore(),
      now: () => currentTime,
      randomToken: (() => {
        const values = ["device-1", "CODE-1", "token-1", "device-2", "CODE-2"];
        return () => values.shift() ?? "unused";
      })(),
    });
    const first = await service.startPairing(pairingInput);
    await service.approvePairing(
      { userId: "owner-1", githubLogin: "owner", isAdmin: false },
      first.userCode,
    );

    await expect(
      service.approvePairing(
        { userId: "owner-2", githubLogin: "other", isAdmin: false },
        first.userCode,
      ),
    ).rejects.toThrow("Pairing code has already been approved.");

    const second = await service.startPairing(pairingInput);
    currentTime = new Date("2026-07-01T10:11:00.000Z");
    await expect(service.pollPairing(second.deviceCode)).rejects.toThrow(
      "Pairing code has expired.",
    );
  });

  it("allows only the owner to revoke a runner token", async () => {
    const service = createRunnerProtocolService({
      store: createInMemoryRunnerProtocolStore(),
      randomToken: (() => {
        const values = ["device", "CODE", "runner-token"];
        return () => values.shift() ?? "unused";
      })(),
    });
    const owner = {
      userId: "owner-1",
      githubLogin: "owner",
      isAdmin: false,
    };
    const pairing = await service.startPairing(pairingInput);
    const { runnerId } = await service.approvePairing(owner, pairing.userCode);
    await service.pollPairing(pairing.deviceCode);

    await expect(
      service.revokeRunner({ ...owner, userId: "owner-2" }, runnerId),
    ).rejects.toThrow("Runner is unavailable.");
    const staleHeartbeat = {
      ...(await service.authenticate("runner-token")),
    };
    await service.revokeRunner(owner, runnerId);
    await service.heartbeat(staleHeartbeat);
    await expect(service.authenticate("runner-token")).rejects.toThrow(
      "Runner authentication failed.",
    );
  });

  it("reports pending and rejects unknown pairing, runner, and token inputs", async () => {
    const store = createInMemoryRunnerProtocolStore();
    const service = createRunnerProtocolService({ store });
    const pairing = await service.startPairing(pairingInput);

    await expect(service.pollPairing(pairing.deviceCode)).resolves.toEqual({
      status: "pending",
    });
    await expect(service.pollPairing("unknown-device")).rejects.toThrow(
      "Pairing code is invalid.",
    );
    await expect(
      service.approvePairing(
        { userId: "owner", githubLogin: "owner", isAdmin: false },
        "unknown-code",
      ),
    ).rejects.toThrow("Pairing code is invalid.");
    await expect(service.authenticate("unknown-token")).rejects.toThrow(
      "Runner authentication failed.",
    );
    await expect(
      service.revokeRunner(
        { userId: "owner", githubLogin: "owner", isAdmin: false },
        "missing-runner",
      ),
    ).rejects.toThrow("Runner is unavailable.");
    expect(() => store.recordHeartbeat("missing", new Date())).toThrow(
      "Runner is unavailable.",
    );

    const orphanRunner = {
      id: "orphan-runner",
      ownerId: "owner",
      name: "orphan",
      publicKey: "key",
      capabilities: ["files" as const],
      environment: pairingInput.environment,
      tokenHash: "hash",
      revokedAt: null,
      status: "offline" as const,
      lastSeenAt: null,
    };
    await expect(
      store.approvePairing(
        {
          deviceCodeHash: "missing",
          userCodeHash: "missing",
          request: pairingInput,
          expiresAt: new Date("2999-01-01T00:00:00.000Z"),
          ownerId: "owner",
          runnerId: orphanRunner.id,
          consumed: false,
        },
        orphanRunner,
      ),
    ).resolves.toBe(false);
  });

  it("records a heartbeat and rejects a pairing whose runner disappeared", async () => {
    const store = createInMemoryRunnerProtocolStore();
    const service = createRunnerProtocolService({
      store,
      randomToken: (() => {
        const values = ["device", "CODE"];
        return () => values.shift() ?? "unused";
      })(),
    });
    const pairing = await service.startPairing(pairingInput);
    const { runnerId } = await service.approvePairing(
      { userId: "owner", githubLogin: "owner", isAdmin: false },
      pairing.userCode,
    );
    const runner = await store.findRunnerById(runnerId);
    if (!runner) throw new Error("Expected runner.");
    await service.heartbeat(runner);
    expect(runner.status).toBe("online");
    expect(runner.lastSeenAt).toBeInstanceOf(Date);

    const missingRunnerStore = {
      ...store,
      findRunnerById: () => Promise.resolve(null),
    };
    const missingRunnerService = createRunnerProtocolService({
      store: missingRunnerStore,
    });
    await expect(
      missingRunnerService.pollPairing(pairing.deviceCode),
    ).rejects.toThrow("Paired runner is unavailable.");
  });

  it("allows only one owner to win an approval race", async () => {
    const service = createRunnerProtocolService({
      store: createInMemoryRunnerProtocolStore(),
    });
    const pairing = await service.startPairing(pairingInput);
    const approvals = await Promise.allSettled([
      service.approvePairing(
        { userId: "owner-1", githubLogin: "one", isAdmin: false },
        pairing.userCode,
      ),
      service.approvePairing(
        { userId: "owner-2", githubLogin: "two", isAdmin: false },
        pairing.userCode,
      ),
    ]);

    expect(
      approvals.filter(({ status }) => status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      approvals.filter(({ status }) => status === "rejected"),
    ).toHaveLength(1);
  });

  it("rejects when the persistence layer loses an approval race", async () => {
    const store = createInMemoryRunnerProtocolStore();
    const service = createRunnerProtocolService({
      store: {
        ...store,
        approvePairing: () => Promise.resolve(false),
      },
    });
    const pairing = await service.startPairing(pairingInput);

    await expect(
      service.approvePairing(
        { userId: "owner", githubLogin: "owner", isAdmin: false },
        pairing.userCode,
      ),
    ).rejects.toThrow("Pairing code has already been approved.");
  });
});
