import { describe, expect, it } from "vitest";

import {
  pollRunnerPairing,
  RunnerHttpTransport,
  startRunnerPairing,
} from "./http-transport";

describe("RunnerHttpTransport", () => {
  it("authenticates and validates a leased job from the v1 API", async () => {
    const requests: Request[] = [];
    const transport = new RunnerHttpTransport({
      serverUrl: "https://bench.example",
      token: "runner-token",
      fetch: (request) => {
        requests.push(request);
        return Promise.resolve(
          Response.json({
            protocolVersion: "1.0",
            lease: {
              jobId: "70b70847-ec1c-4aeb-ac0f-bf7db0328efe",
              attemptId: "d0da824f-6f6a-4a01-af27-f7448d22bb39",
              leaseToken: "lease-token",
              benchmark: { id: "repository-repair", version: "1.0.0" },
              queuePosition: 0,
              checkpoint: null,
              cancellationRequested: false,
            },
          }),
        );
      },
    });

    await expect(transport.lease()).resolves.toMatchObject({
      benchmark: { id: "repository-repair" },
    });
    expect(requests[0]?.url).toBe("https://bench.example/api/v1/runner/lease");
    expect(requests[0]?.headers.get("authorization")).toBe(
      "Bearer runner-token",
    );
  });

  it("drives every authenticated runner operation", async () => {
    const paths: string[] = [];
    const fetch = (request: Request) => {
      const url = new URL(request.url);
      paths.push(`${request.method} ${url.pathname}`);
      if (url.pathname.endsWith("/heartbeat")) {
        return Promise.resolve(
          Response.json({
            protocolVersion: "1.0",
            serverTime: "2026-07-01T10:00:00.000Z",
          }),
        );
      }
      if (url.pathname.endsWith("/lease")) {
        return Promise.resolve(
          Response.json({ protocolVersion: "1.0", lease: null }),
        );
      }
      if (url.pathname.endsWith("/events")) {
        return Promise.resolve(Response.json({ throughSequence: 0 }));
      }
      if (url.pathname.endsWith("/cancellation")) {
        return Promise.resolve(Response.json({ cancellationRequested: false }));
      }
      return Promise.resolve(new Response(null, { status: 204 }));
    };
    const transport = new RunnerHttpTransport({
      serverUrl: "https://bench.example/",
      token: "runner-token",
      fetch,
    });
    const activeLease = {
      jobId: "70b70847-ec1c-4aeb-ac0f-bf7db0328efe",
      attemptId: "d0da824f-6f6a-4a01-af27-f7448d22bb39",
      leaseToken: "lease-token",
      benchmark: { id: "repository-repair", version: "1.0.0" },
      queuePosition: 0,
      checkpoint: null,
      cancellationRequested: false,
    };

    await transport.heartbeat();
    await expect(transport.lease()).resolves.toBeNull();
    await expect(
      transport.recordEvents(activeLease, [
        {
          sequence: 0,
          event: {
            type: "job_started",
            at: "2026-07-01T10:00:00.000Z",
            jobId: activeLease.jobId,
          },
        },
      ]),
    ).resolves.toEqual({ throughSequence: 0 });
    await transport.saveCheckpoint(activeLease, {
      sequence: 1,
      resumable: true,
      state: { cursor: 1 },
    });
    await expect(transport.cancellationStatus(activeLease)).resolves.toEqual({
      cancellationRequested: false,
    });
    await transport.complete(activeLease, {
      status: "completed",
      observations: [],
      artifacts: [],
      error: null,
    });
    await transport.logout("runner-1");

    expect(paths).toEqual([
      "POST /api/v1/runner/heartbeat",
      "POST /api/v1/runner/lease",
      "POST /api/v1/runner/events",
      "POST /api/v1/runner/checkpoints",
      "GET /api/v1/runner/cancellation",
      "POST /api/v1/runner/completion",
      "POST /api/v1/runner/runners/runner-1/revoke",
    ]);
  });

  it("starts and polls device pairing and surfaces API errors", async () => {
    const requests: Request[] = [];
    const fetch = (request: Request) => {
      requests.push(request);
      if (request.method === "POST") {
        return Promise.resolve(
          Response.json({
            deviceCode: "device",
            userCode: "CODE",
            verificationUri: "https://bench.example/pair",
            expiresAt: "2026-07-01T10:10:00.000Z",
            intervalSeconds: 2,
          }),
        );
      }
      return Promise.resolve(Response.json({ status: "pending" }));
    };
    const environment = {
      os: "linux" as const,
      architecture: "arm64",
      cpuClass: "fixture",
      memoryMb: 8192,
      runtimeVersions: { node: "22.21.0" },
      harnessVersions: {},
      sandboxMode: "process",
      contentHashes: {},
    };

    await expect(
      startRunnerPairing(
        {
          serverUrl: "https://bench.example/",
          name: "runner",
          publicKey: "key",
          capabilities: ["workspaces", "files"],
          environment,
        },
        fetch,
      ),
    ).resolves.toMatchObject({ userCode: "CODE" });
    await expect(
      pollRunnerPairing("https://bench.example/", "device code", fetch),
    ).resolves.toEqual({ status: "pending" });
    expect(requests[1]?.url).toContain("device%20code");

    const failing = new RunnerHttpTransport({
      serverUrl: "https://bench.example",
      token: "token",
      fetch: () =>
        Promise.resolve(
          Response.json({ error: "Token revoked." }, { status: 401 }),
        ),
    });
    await expect(failing.lease()).rejects.toThrow("Token revoked.");
    await expect(
      startRunnerPairing(
        {
          serverUrl: "https://bench.example",
          name: "runner",
          publicKey: "key",
          capabilities: ["workspaces", "files"],
          environment,
        },
        () => Promise.resolve(new Response(null, { status: 500 })),
      ),
    ).rejects.toThrow("Pairing failed (500).");
    await expect(
      startRunnerPairing(
        {
          serverUrl: "https://bench.example",
          name: "runner",
          publicKey: "key",
          capabilities: ["workspaces", "files"],
          environment,
        },
        () =>
          Promise.resolve(
            Response.json({ error: "Pairing disabled." }, { status: 403 }),
          ),
      ),
    ).rejects.toThrow("Pairing disabled.");
    await expect(
      pollRunnerPairing("https://bench.example", "device", () =>
        Promise.resolve(new Response(null, { status: 500 })),
      ),
    ).rejects.toThrow("Pairing poll failed (500).");

    const originalFetch = globalThis.fetch;
    globalThis.fetch = () =>
      Promise.resolve(new Response("bad", { status: 502 }));
    try {
      await expect(
        new RunnerHttpTransport({
          serverUrl: "https://bench.example",
          token: "token",
        }).lease(),
      ).rejects.toThrow("Runner API failed (502).");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
