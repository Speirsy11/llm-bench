import { beforeAll, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  authorizeArtifactUpload: vi.fn(),
  validateRunnerArtifactUpload: vi.fn(),
  httpHandler: vi.fn(),
  createRunnerHttpHandler: vi.fn(),
}));

vi.mock("@/env", () => ({
  parseWebEnv: () => ({ databaseUrl: "postgresql://test" }),
}));
vi.mock("@llm-bench/control-plane", () => ({
  createDatabase: () => ({ db: "database" }),
  PostgresRunnerProtocolStore: class {},
  PostgresRunnerJobStore: class {},
  createRunnerProtocolService: () => ({ authenticate: mocks.authenticate }),
  createRunnerJobService: () => ({
    authorizeArtifactUpload: mocks.authorizeArtifactUpload,
  }),
  validateRunnerArtifactUpload: mocks.validateRunnerArtifactUpload,
  createRunnerHttpHandler: mocks.createRunnerHttpHandler,
}));

describe("runner route runtime", () => {
  beforeAll(() => {
    mocks.createRunnerHttpHandler.mockReturnValue(mocks.httpHandler);
  });

  it("authenticates the runner and validates a leased upload", async () => {
    mocks.authenticate.mockResolvedValue({ id: "runner-1" });
    mocks.validateRunnerArtifactUpload.mockReturnValue({
      maximumSizeInBytes: 123,
    });
    const { authorizeRunnerBlobUpload } = await import("./runtime");
    const input = {
      runnerToken: "token",
      attemptId: "attempt-1",
      leaseToken: "lease-1",
      pathname: "artifact.json",
      contentHash: "sha256:abc",
      byteLength: 12,
    };

    await expect(authorizeRunnerBlobUpload(input)).resolves.toEqual({
      runnerId: "runner-1",
      maximumSizeInBytes: 123,
    });
    expect(mocks.authorizeArtifactUpload).toHaveBeenCalledWith(
      { id: "runner-1" },
      input,
    );
  });

  it("dispatches through an HTTP handler with the request origin", async () => {
    const response = new Response("ok");
    mocks.createRunnerHttpHandler.mockReturnValue(mocks.httpHandler);
    mocks.httpHandler.mockResolvedValue(response);
    const { handleRunnerRequest } = await import("./runtime");
    const request = new Request("https://bench.example/api/v1/runner/jobs");
    await expect(handleRunnerRequest(request, ["jobs"])).resolves.toBe(
      response,
    );
    expect(mocks.createRunnerHttpHandler).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: "https://bench.example" }),
    );
    expect(mocks.httpHandler).toHaveBeenCalledWith(request, ["jobs"]);
  });
});
