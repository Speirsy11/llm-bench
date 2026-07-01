import { describe, expect, it } from "vitest";

import { createRunnerHttpHandler } from "./runner-http";
import {
  createInMemoryRunnerJobStore,
  createRunnerJobService,
} from "./runner-jobs";
import {
  createInMemoryRunnerProtocolStore,
  createRunnerProtocolService,
} from "./runner-protocol";

const pairingInput = {
  protocolVersion: "1.0",
  name: "fixture-runner",
  publicKey: "public-key",
  capabilities: ["workspaces", "files"],
  environment: {
    os: "linux",
    architecture: "arm64",
    cpuClass: "fixture",
    memoryMb: 8192,
    runtimeVersions: { node: "22.21.0" },
    harnessVersions: {},
    sandboxMode: "process",
    contentHashes: { runner: "sha256:runner" },
  },
};

describe("runner HTTP protocol", () => {
  it("pairs, leases, records progress, and completes through /api/v1/runner", async () => {
    const protocol = createRunnerProtocolService({
      store: createInMemoryRunnerProtocolStore(),
      randomToken: (() => {
        const values = ["device", "CODE", "runner-token"];
        return () => values.shift() ?? "unused";
      })(),
    });
    const jobs = createRunnerJobService({
      store: createInMemoryRunnerJobStore(),
      randomToken: () => "lease-token",
    });
    await jobs.enqueue({
      ownerId: "owner-1",
      benchmark: { id: "repository-repair", version: "1.0.0" },
      requiredCapabilities: ["workspaces", "files"],
    });
    const handle = createRunnerHttpHandler({
      protocol,
      jobs,
      baseUrl: "https://bench.example",
    });

    const pairingResponse = await handle(
      new Request("https://bench.example/api/v1/runner/pairings", {
        method: "POST",
        body: JSON.stringify(pairingInput),
      }),
      ["pairings"],
    );
    const pairing = (await pairingResponse.json()) as {
      deviceCode: string;
      userCode: string;
    };
    await protocol.approvePairing(
      { userId: "owner-1", githubLogin: "owner", isAdmin: false },
      pairing.userCode,
    );
    const poll = await handle(
      new Request(
        `https://bench.example/api/v1/runner/pairings/${pairing.deviceCode}`,
      ),
      ["pairings", pairing.deviceCode],
    );
    const approved = (await poll.json()) as { token: string };
    const authorized = {
      authorization: `Bearer ${approved.token}`,
      "content-type": "application/json",
    };
    const leaseResponse = await handle(
      new Request("https://bench.example/api/v1/runner/lease", {
        method: "POST",
        headers: authorized,
        body: JSON.stringify({ protocolVersion: "1.0" }),
      }),
      ["lease"],
    );
    const leased = (await leaseResponse.json()) as {
      lease: { jobId: string; attemptId: string; leaseToken: string };
    };
    const eventResponse = await handle(
      new Request("https://bench.example/api/v1/runner/events", {
        method: "POST",
        headers: authorized,
        body: JSON.stringify({
          protocolVersion: "1.0",
          attemptId: leased.lease.attemptId,
          leaseToken: leased.lease.leaseToken,
          events: [
            {
              sequence: 0,
              event: {
                type: "job_started",
                at: "2026-07-01T10:00:00.000Z",
                jobId: leased.lease.jobId,
              },
            },
          ],
        }),
      }),
      ["events"],
    );
    const heartbeat = await handle(
      new Request("https://bench.example/api/v1/runner/heartbeat", {
        method: "POST",
        headers: authorized,
        body: JSON.stringify({ protocolVersion: "1.0", status: "online" }),
      }),
      ["heartbeat"],
    );
    const checkpoint = await handle(
      new Request("https://bench.example/api/v1/runner/checkpoints", {
        method: "POST",
        headers: authorized,
        body: JSON.stringify({
          protocolVersion: "1.0",
          attemptId: leased.lease.attemptId,
          leaseToken: leased.lease.leaseToken,
          checkpoint: { sequence: 1, resumable: true, state: { cursor: 1 } },
        }),
      }),
      ["checkpoints"],
    );
    const cancellation = await handle(
      new Request(
        `https://bench.example/api/v1/runner/cancellation?attemptId=${leased.lease.attemptId}&leaseToken=${leased.lease.leaseToken}`,
        { headers: authorized },
      ),
      ["cancellation"],
    );
    const completionResponse = await handle(
      new Request("https://bench.example/api/v1/runner/completion", {
        method: "POST",
        headers: authorized,
        body: JSON.stringify({
          protocolVersion: "1.0",
          attemptId: leased.lease.attemptId,
          leaseToken: leased.lease.leaseToken,
          status: "completed",
          observations: [{ metricId: "hidden_test_pass_ratio", value: 1 }],
          artifacts: [],
          error: null,
        }),
      }),
      ["completion"],
    );

    expect(pairingResponse.status).toBe(201);
    expect(poll.status).toBe(200);
    expect(leaseResponse.status).toBe(200);
    expect(await eventResponse.json()).toEqual({ throughSequence: 0 });
    expect(heartbeat.status).toBe(200);
    expect(checkpoint.status).toBe(204);
    expect(await cancellation.json()).toEqual({ cancellationRequested: false });
    expect(completionResponse.status).toBe(204);
    expect(
      (
        await handle(
          new Request("https://bench.example/api/v1/runner/cancellation", {
            headers: authorized,
          }),
          ["cancellation"],
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await handle(
          new Request("https://bench.example/api/v1/runner/unknown", {
            headers: authorized,
          }),
          ["unknown"],
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await handle(
          new Request("https://bench.example/api/v1/runner/lease", {
            method: "POST",
            body: JSON.stringify({ protocolVersion: "1.0" }),
          }),
          ["lease"],
        )
      ).status,
    ).toBe(401);
    const invalidHeartbeat = await handle(
      new Request("https://bench.example/api/v1/runner/heartbeat", {
        method: "POST",
        headers: authorized,
        body: "{}",
      }),
      ["heartbeat"],
    );
    expect(invalidHeartbeat.status).toBe(400);
    const malformedHeartbeat = await handle(
      new Request("https://bench.example/api/v1/runner/heartbeat", {
        method: "POST",
        headers: authorized,
        body: "{",
      }),
      ["heartbeat"],
    );
    expect(malformedHeartbeat.status).toBe(400);

    const revoked = await handle(
      new Request(
        `https://bench.example/api/v1/runner/runners/${approved.token}/revoke`,
        { method: "POST", headers: authorized },
      ),
      ["runners", "wrong-id", "revoke"],
    );
    expect(revoked.status).toBe(404);
    const authenticatedRunner = await protocol.authenticate(approved.token);
    expect(
      (
        await handle(
          new Request(
            `https://bench.example/api/v1/runner/runners/${authenticatedRunner.id}/revoke`,
            { method: "POST", headers: authorized },
          ),
          ["runners", authenticatedRunner.id, "revoke"],
        )
      ).status,
    ).toBe(204);
    expect(
      (
        await handle(
          new Request("https://bench.example/api/v1/runner/lease", {
            method: "POST",
            headers: authorized,
            body: JSON.stringify({ protocolVersion: "1.0" }),
          }),
          ["lease"],
        )
      ).status,
    ).toBe(401);

    const brokenRequest = {
      method: "POST",
      // Deliberately exercise the handler's non-Error rejection boundary.
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
      json: () => Promise.reject("not-an-error"),
    } as unknown as Request;
    const invalid = await handle(brokenRequest, ["pairings"]);
    expect(await invalid.json()).toEqual({ error: "Runner request failed." });

    const failingHandle = createRunnerHttpHandler({
      protocol: {
        ...protocol,
        authenticate: () => Promise.reject(new Error("database unavailable")),
      },
      jobs,
      baseUrl: "https://bench.example",
    });
    const failed = await failingHandle(
      new Request("https://bench.example/api/v1/runner/lease", {
        method: "POST",
        headers: authorized,
        body: JSON.stringify({ protocolVersion: "1.0" }),
      }),
      ["lease"],
    );
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ error: "Runner request failed." });
  });
});
