import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  cancelJobAction,
  launchExperimentAction,
  retryJobAction,
  saveCredentialProfileAction,
} from "./actions";

const saveCredentialProfile = vi.fn();
const launchExperiment = vi.fn();
const cancelJob = vi.fn();
const retryJob = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("./auth", () => ({
  getDashboardActor: () =>
    Promise.resolve({
      userId: "e2e-user",
      githubLogin: "e2e",
      isAdmin: false,
    }),
}));
vi.mock("./runtime", () => ({
  getDashboardControlPlane: () => ({
    dashboard: {
      saveCredentialProfile,
      launchExperiment,
      cancelJob,
      retryJob,
    },
  }),
}));

describe("dashboard credential action", () => {
  beforeEach(() => {
    saveCredentialProfile.mockReset();
    launchExperiment.mockReset();
    cancelJob.mockReset();
    retryJob.mockReset();
  });

  it("rejects malformed masked metadata before persistence", async () => {
    const formData = new FormData();
    formData.set("runnerId", "70b70847-ec1c-4aeb-ac0f-bf7db0328efe");
    formData.set("label", "OpenRouter");
    formData.set("provider", "openrouter");
    formData.set("maskedSecret", "••••entire-short-secret");
    formData.set("algorithm", "x25519-xsalsa20poly1305-seal");
    formData.set("keyFingerprint", "ZmFrZS1maW5nZXJwcmludA==");
    formData.set(
      "ciphertext",
      "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEB",
    );

    await expect(saveCredentialProfileAction(formData)).rejects.toThrow(
      "Credential mask is invalid.",
    );
    expect(saveCredentialProfile).not.toHaveBeenCalled();
  });

  it("persists a valid ciphertext-only credential submission", async () => {
    const formData = credentialForm();
    formData.set("maskedSecret", "••••7f3a");

    await saveCredentialProfileAction(formData);

    expect(saveCredentialProfile).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "e2e-user" }),
      expect.objectContaining({
        provider: "openrouter",
        maskedSecret: "••••7f3a",
      }),
    );
  });

  it("launches selected routes and delegates cancel and retry", async () => {
    const launch = new FormData();
    launch.set("name", "Repair tracer");
    launch.set("runnerId", "runner-1");
    launch.set("credentialProfileId", "credential-1");
    launch.set("harness", "llmbench");
    launch.set("spendConfirmed", "on");
    launch.append("modelRoute", "openrouter-gpt-4o");
    launch.append("modelRoute", "unknown");

    await launchExperimentAction(launch);
    expect(launchExperiment).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        name: "Repair tracer",
        spendConfirmed: true,
        modelRoutes: [expect.objectContaining({ id: "openrouter-gpt-4o" })],
      }),
    );

    const job = new FormData();
    job.set("jobId", "job-1");
    await cancelJobAction(job);
    await retryJobAction(job);
    expect(cancelJob).toHaveBeenCalledWith(expect.anything(), "job-1");
    expect(retryJob).toHaveBeenCalledWith(expect.anything(), "job-1");
  });

  it("launches a selected native harness without a hosted credential", async () => {
    const launch = new FormData();
    launch.set("name", "Codex repair");
    launch.set("runnerId", "runner-1");
    launch.set("harness", "codex");
    launch.set("spendConfirmed", "on");

    await launchExperimentAction(launch);

    expect(launchExperiment).toHaveBeenCalledWith(expect.anything(), {
      name: "Codex repair",
      runnerId: "runner-1",
      spendConfirmed: true,
      modelRoutes: [
        { id: "codex-gpt-5.4", provider: "codex", model: "gpt-5.4" },
      ],
      harnesses: [
        {
          id: "codex",
          version: "1.0.0",
          capabilities: [
            "response_generation",
            "workspaces",
            "files",
            "session_resume",
          ],
          modelRoutes: [
            { id: "codex-gpt-5.4", provider: "codex", model: "gpt-5.4" },
          ],
        },
      ],
      toolsets: [
        {
          id: "native",
          version: "1.0.0",
          tools: [],
          mcpProfiles: [],
        },
      ],
    });
  });

  it("maps a Claude selection to its native model and rejects Pi", async () => {
    const launch = new FormData();
    launch.set("name", "Claude repair");
    launch.set("runnerId", "runner-1");
    launch.set("harness", "claude");
    launch.set("spendConfirmed", "on");

    await launchExperimentAction(launch);

    expect(launchExperiment).toHaveBeenCalledWith(expect.anything(), {
      name: "Claude repair",
      runnerId: "runner-1",
      spendConfirmed: true,
      modelRoutes: [
        {
          id: "claude-sonnet-4-6",
          provider: "claude",
          model: "claude-sonnet-4-6",
        },
      ],
      harnesses: [
        {
          id: "claude",
          version: "1.0.0",
          capabilities: [
            "response_generation",
            "workspaces",
            "files",
            "session_resume",
          ],
          modelRoutes: [
            {
              id: "claude-sonnet-4-6",
              provider: "claude",
              model: "claude-sonnet-4-6",
            },
          ],
        },
      ],
      toolsets: [
        {
          id: "native",
          version: "1.0.0",
          tools: [],
          mcpProfiles: [],
        },
      ],
    });

    launchExperiment.mockClear();
    launch.set("harness", "pi");
    await expect(launchExperimentAction(launch)).rejects.toThrow(
      "Unsupported dashboard harness: pi.",
    );
    expect(launchExperiment).not.toHaveBeenCalled();
  });

  it("rejects missing required fields", async () => {
    await expect(cancelJobAction(new FormData())).rejects.toThrow(
      "jobId is required",
    );
  });
});

function credentialForm(): FormData {
  const formData = new FormData();
  formData.set("runnerId", "70b70847-ec1c-4aeb-ac0f-bf7db0328efe");
  formData.set("label", "OpenRouter");
  formData.set("provider", "openrouter");
  formData.set("algorithm", "x25519-xsalsa20poly1305-seal");
  formData.set("keyFingerprint", "ZmFrZS1maW5nZXJwcmludA==");
  formData.set(
    "ciphertext",
    "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEB",
  );
  return formData;
}
