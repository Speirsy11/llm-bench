import type { PluginMessage } from "@speirsy11/llm-bench-harness-sdk";
import { encodeProtocolLine } from "@speirsy11/llm-bench-harness-sdk";
import { describe, expect, it } from "vitest";

import type {
  ProcessRunner,
  ProcessRunRequest,
  ProcessRunResult,
} from "@llm-bench/process-harness";

import { probeExecutablePlugin } from "./plugin-probe";

describe("probeExecutablePlugin", () => {
  it("reads one strict handshake using an isolated bounded process", async () => {
    const runner = new ProbeRunner([
      {
        kind: "handshake_reply",
        protocolVersion: "1.0.0",
        manifest: {
          id: "fixture",
          name: "Fixture",
          version: "1.2.3",
          capabilities: ["response_generation"],
          modelRoutes: [
            { id: "fixture", provider: "local", model: "fixture-model" },
          ],
        },
      },
    ]);

    await expect(
      probeExecutablePlugin(["/opt/plugins/fixture", "--jsonl"], {
        runner,
        environment: { HOME: "/private", PATH: "/bin" },
      }),
    ).resolves.toMatchObject({
      protocolVersion: "1.0.0",
      manifest: { id: "fixture", version: "1.2.3" },
    });
    expect(runner.request).toMatchObject({
      argv: ["/opt/plugins/fixture", "--jsonl"],
      cwd: "/opt/plugins",
      env: { PATH: "/bin" },
      maxOutputBytes: 1_048_576,
    });
    expect(runner.input()).toEqual({
      kind: "handshake_request",
      protocolVersion: "1.0.0",
    });
  });

  it("rejects process failures, malformed lifecycle output, and unknown majors", async () => {
    await expect(
      probeExecutablePlugin(["/plugin"], {
        runner: new ProbeRunner([], { exitCode: 4, stderr: "failed" }),
      }),
    ).rejects.toThrow("exited with code 4: failed");
    await expect(
      probeExecutablePlugin(["/plugin"], {
        runner: new ProbeRunner([], { exitCode: null }),
      }),
    ).rejects.toThrow("exited with code null");
    await expect(
      probeExecutablePlugin(["/plugin"], {
        runner: new ProbeRunner([]),
      }),
    ).rejects.toThrow("exactly one handshake reply");
    await expect(
      probeExecutablePlugin(["/plugin"], {
        runner: new ProbeRunner([
          { kind: "handshake_request", protocolVersion: "1.0.0" },
        ]),
      }),
    ).rejects.toThrow("exactly one handshake reply");
    await expect(
      probeExecutablePlugin(["/plugin"], {
        runner: new ProbeRunner([
          {
            kind: "handshake_reply",
            protocolVersion: "2.0.0",
            manifest: {
              id: "fixture",
              name: "Fixture",
              version: "1.0.0",
              capabilities: [],
              modelRoutes: [],
            },
          },
        ]),
      }),
    ).rejects.toThrow("supported major 1");
  });
});

class ProbeRunner implements ProcessRunner {
  request: ProcessRunRequest | undefined;

  constructor(
    private readonly messages: PluginMessage[],
    private readonly result: Partial<ProcessRunResult> = {},
  ) {}

  run(request: ProcessRunRequest): Promise<ProcessRunResult> {
    this.request = request;
    return Promise.resolve({
      exitCode: 0,
      signal: null,
      stdoutLines: this.messages.map((message) =>
        encodeProtocolLine(message).trimEnd(),
      ),
      stderr: "",
      outputBytes: 0,
      cancelled: false,
      ...this.result,
    });
  }

  input(): unknown {
    return JSON.parse((this.request?.stdin ?? "").trim());
  }
}
