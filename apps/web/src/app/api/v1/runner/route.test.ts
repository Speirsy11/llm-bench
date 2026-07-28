import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET, POST } from "./[...path]/route";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  handleUpload: vi.fn(),
  authorizeRunnerBlobUpload: vi.fn(),
  handleRunnerRequest: vi.fn(),
  approvePairing: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@vercel/blob/client", () => ({ handleUpload: mocks.handleUpload }));
vi.mock("./runtime", () => ({
  authorizeRunnerBlobUpload: mocks.authorizeRunnerBlobUpload,
  handleRunnerRequest: mocks.handleRunnerRequest,
  runnerProtocol: { approvePairing: mocks.approvePairing },
}));

const context = (path: string[]) => ({ params: Promise.resolve({ path }) });

describe("runner API route dispatch", () => {
  beforeEach(() => {
    mocks.auth.mockReset();
    mocks.handleUpload.mockReset();
    mocks.authorizeRunnerBlobUpload.mockReset();
    mocks.handleRunnerRequest.mockReset();
    mocks.approvePairing.mockReset();
  });

  it("forwards generic GET and POST requests to the runner handler", async () => {
    const response = new Response("forwarded");
    mocks.handleRunnerRequest.mockResolvedValue(response);
    const get = new Request("http://example.test/jobs");
    const post = new Request("http://example.test/jobs", { method: "POST" });
    await expect(GET(get, context(["jobs"]))).resolves.toBe(response);
    await expect(POST(post, context(["jobs"]))).resolves.toBe(response);
    expect(mocks.handleRunnerRequest).toHaveBeenCalledTimes(2);
  });

  it("requires an authenticated session to approve pairings", async () => {
    mocks.auth.mockResolvedValue(null);
    const response = await POST(
      jsonRequest("http://example.test/pairings/approve", { userCode: "ABC" }),
      context(["pairings", "approve"]),
    );
    expect(response.status).toBe(401);
  });

  it("validates, approves, and reports pairing failures", async () => {
    mocks.auth.mockResolvedValue({
      user: { id: "user-1", githubLogin: "octocat" },
    });
    const missing = await POST(
      jsonRequest("http://example.test/pairings/approve", {}),
      context(["pairings", "approve"]),
    );
    expect(missing.status).toBe(400);

    mocks.approvePairing.mockResolvedValue({ status: "approved" });
    const approved = await POST(
      jsonRequest("http://example.test/pairings/approve", { userCode: "ABC" }),
      context(["pairings", "approve"]),
    );
    await expect(approved.json()).resolves.toEqual({ status: "approved" });

    mocks.approvePairing.mockRejectedValue("failure");
    const failed = await POST(
      jsonRequest("http://example.test/pairings/approve", { userCode: "ABC" }),
      context(["pairings", "approve"]),
    );
    expect(failed.status).toBe(400);
    await expect(failed.json()).resolves.toEqual({ error: "Pairing failed." });
  });

  it("authorizes artifact uploads without exposing runner credentials", async () => {
    mocks.authorizeRunnerBlobUpload.mockResolvedValue({
      runnerId: "runner-1",
      maximumSizeInBytes: 1024,
    });
    mocks.handleUpload.mockImplementation(
      ({
        onBeforeGenerateToken,
      }: {
        onBeforeGenerateToken: (
          pathname: string,
          payload: string,
        ) => Promise<Record<string, unknown>>;
      }) =>
        onBeforeGenerateToken(
          "result.json",
          JSON.stringify({
            runnerToken: "secret-token",
            attemptId: "attempt-1",
            leaseToken: "lease-1",
            contentHash: "sha256:abc",
            byteLength: 12,
          }),
        ),
    );
    const response = await POST(
      jsonRequest("http://example.test/artifacts/upload", { type: "blob" }),
      context(["artifacts", "upload"]),
    );
    const body = (await response.json()) as {
      allowOverwrite: boolean;
      maximumSizeInBytes: number;
      tokenPayload: string;
    };
    expect(body.maximumSizeInBytes).toBe(1024);
    expect(body.allowOverwrite).toBe(false);
    expect(body.tokenPayload).not.toContain("secret-token");
    expect(mocks.authorizeRunnerBlobUpload).toHaveBeenCalledWith(
      expect.objectContaining({ pathname: "result.json" }),
    );
  });

  it.each([
    [new SyntaxError("bad json"), 400],
    [new Error("Artifact upload is invalid."), 400],
    [new Error("Runner authentication failed."), 401],
    [new Error("Attempt lease is unavailable."), 401],
    [new Error("Attempt is already terminal."), 409],
    ["unknown", 500],
    [new Error("Blob unavailable"), 500],
  ])("maps upload failure %p to %i", async (error, status) => {
    mocks.handleUpload.mockRejectedValue(error);
    const response = await POST(
      jsonRequest("http://example.test/artifacts/upload", {}),
      context(["artifacts", "upload"]),
    );
    expect(response.status).toBe(status);
  });
});

function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
