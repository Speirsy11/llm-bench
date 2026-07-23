import { isValidElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import DashboardPage from "./page";

const mocks = vi.hoisted(() => ({
  listRunners: vi.fn(),
  listCredentialProfiles: vi.fn(),
  listExperiments: vi.fn(),
  previewExperiment: vi.fn(),
  getDashboardActorSession: vi.fn(() =>
    Promise.resolve({
      actor: { userId: "user-1" },
      session: { user: { githubLogin: "octocat", name: null } },
    }),
  ),
}));

vi.mock("@/app/dashboard/auth", () => ({
  getDashboardActorSession: mocks.getDashboardActorSession,
}));
vi.mock("@/app/dashboard/runtime", () => ({
  getDashboardControlPlane: () => ({
    dashboard: {
      listRunners: mocks.listRunners,
      listCredentialProfiles: mocks.listCredentialProfiles,
      listExperiments: mocks.listExperiments,
      previewExperiment: mocks.previewExperiment,
    },
  }),
}));
vi.mock("@/components/dashboard-shell", () => ({
  DashboardShell: () => null,
}));

describe("dashboard page", () => {
  beforeEach(() => {
    mocks.listRunners.mockResolvedValue([]);
    mocks.listCredentialProfiles.mockResolvedValue([]);
    mocks.listExperiments.mockResolvedValue([]);
    mocks.previewExperiment.mockReset();
  });

  it("renders an empty dashboard without requesting a preview", async () => {
    const element = await DashboardPage();
    expect(element.props).toMatchObject({
      githubLogin: "octocat",
      name: "octocat",
      previews: {},
      runners: [],
    });
    expect(mocks.previewExperiment).not.toHaveBeenCalled();
  });

  it("previews the primary runner and credential", async () => {
    mocks.listRunners.mockResolvedValue([
      {
        id: "runner-1",
        environment: {
          harnessVersions: { codex: "0.142.1", claude: "2.1.198" },
        },
      },
    ]);
    mocks.listCredentialProfiles.mockResolvedValue([
      { id: "credential-1", runnerId: "runner-1" },
    ]);
    mocks.previewExperiment.mockImplementation(
      (_actor: unknown, input: { harnesses: { id: string }[] }) =>
        Promise.resolve({ harnessId: input.harnesses[0]?.id }),
    );

    const element = await DashboardPage();
    const props = element.props as { previews: unknown };
    expect(props.previews).toEqual({
      llmbench: { harnessId: "llmbench" },
      codex: { harnessId: "codex" },
      claude: { harnessId: "claude" },
    });
    expect(mocks.previewExperiment).toHaveBeenCalledTimes(3);
    expect(mocks.previewExperiment).toHaveBeenNthCalledWith(
      1,
      { userId: "user-1" },
      expect.objectContaining({
        runnerId: "runner-1",
        credentialProfileId: "credential-1",
        harnesses: [expect.objectContaining({ id: "llmbench" })],
      }),
    );
  });

  it("previews the selected runner with only its bound credential", async () => {
    mocks.listRunners.mockResolvedValue([
      {
        id: "runner-offline",
        status: "offline",
        environment: { harnessVersions: {} },
      },
      {
        id: "runner-selected",
        status: "online",
        environment: { harnessVersions: { codex: "0.142.1" } },
      },
    ]);
    mocks.listCredentialProfiles.mockResolvedValue([
      { id: "credential-offline", runnerId: "runner-offline" },
      { id: "credential-selected", runnerId: "runner-selected" },
    ]);
    mocks.previewExperiment.mockImplementation(
      (_actor: unknown, input: { harnesses: { id: string }[] }) =>
        Promise.resolve({ harnessId: input.harnesses[0]?.id }),
    );

    const element = await DashboardPage({
      searchParams: Promise.resolve({ runnerId: "runner-selected" }),
    });

    expect(isValidElement<{ selectedRunnerId: string | null }>(element)).toBe(
      true,
    );
    if (!isValidElement<{ selectedRunnerId: string | null }>(element)) {
      throw new Error("Expected DashboardPage to return a React element.");
    }
    expect(element.props.selectedRunnerId).toBe("runner-selected");
    expect(mocks.previewExperiment).toHaveBeenCalledWith(
      { userId: "user-1" },
      expect.objectContaining({
        runnerId: "runner-selected",
        credentialProfileId: "credential-selected",
      }),
    );
    expect(mocks.previewExperiment).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ runnerId: "runner-offline" }),
    );
  });

  it("defaults to an online runner instead of an older offline runner", async () => {
    mocks.listRunners.mockResolvedValue([
      {
        id: "runner-offline",
        status: "offline",
        environment: { harnessVersions: {} },
      },
      {
        id: "runner-online",
        status: "online",
        environment: { harnessVersions: { codex: "0.142.1" } },
      },
    ]);

    const element = await DashboardPage();

    expect(isValidElement<{ selectedRunnerId: string | null }>(element)).toBe(
      true,
    );
    if (!isValidElement<{ selectedRunnerId: string | null }>(element)) {
      throw new Error("Expected DashboardPage to return a React element.");
    }
    expect(element.props.selectedRunnerId).toBe("runner-online");
    expect(mocks.previewExperiment).toHaveBeenCalledWith(
      { userId: "user-1" },
      expect.objectContaining({ runnerId: "runner-online" }),
    );
  });

  it("previews a native Codex target when no hosted credential exists", async () => {
    mocks.listRunners.mockResolvedValue([
      {
        id: "runner-1",
        environment: {
          harnessVersions: { codex: "0.142.1", claude: "2.1.198" },
        },
      },
    ]);
    mocks.previewExperiment.mockImplementation(
      (_actor: unknown, input: { harnesses: { id: string }[] }) =>
        Promise.resolve({ harnessId: input.harnesses[0]?.id }),
    );

    const element = await DashboardPage();
    const props = element.props as { previews: unknown };
    expect(props.previews).toEqual({
      codex: { harnessId: "codex" },
      claude: { harnessId: "claude" },
    });
    expect(mocks.previewExperiment).toHaveBeenCalledTimes(2);
    expect(mocks.previewExperiment).toHaveBeenCalledWith(
      { userId: "user-1" },
      {
        name: "Repository repair",
        runnerId: "runner-1",
        modelRoutes: [
          { id: "codex-gpt-5.4", provider: "codex", model: "gpt-5.4" },
        ],
        harnesses: [expect.objectContaining({ id: "codex" })],
        toolsets: [expect.objectContaining({ id: "native" })],
      },
    );
    expect(mocks.previewExperiment).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        harnesses: [expect.objectContaining({ id: "llmbench" })],
      }),
    );
  });

  it("does not offer native previews without compatible runner CLIs", async () => {
    mocks.listRunners.mockResolvedValue([
      {
        id: "runner-1",
        environment: { harnessVersions: { codex: "unknown" } },
      },
    ]);

    const element = await DashboardPage();
    expect(isValidElement<{ previews: unknown }>(element)).toBe(true);
    if (!isValidElement<{ previews: unknown }>(element)) {
      throw new Error("Expected DashboardPage to return a React element.");
    }
    expect(element.props.previews).toEqual({});
    expect(mocks.previewExperiment).not.toHaveBeenCalled();
  });
});
