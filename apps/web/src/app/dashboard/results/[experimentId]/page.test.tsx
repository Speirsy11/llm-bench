import { isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import PrivateResultPage from "./page";

const mocks = vi.hoisted(() => ({
  getDashboardActor: vi.fn(),
  notFound: vi.fn(),
  previewAnalysis: vi.fn(),
}));

vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("@/app/dashboard/auth", () => ({
  getDashboardActor: mocks.getDashboardActor,
}));
vi.mock("@/app/dashboard/runtime", () => ({
  getDashboardControlPlane: () => ({
    publicResults: { previewAnalysis: mocks.previewAnalysis },
  }),
}));
vi.mock("@/components/public-result-shell", () => ({
  PublicResultShell: ({ context }: { readonly context: string }) => (
    <svg
      aria-label="Experiment result chart"
      data-context={context}
      role="img"
    />
  ),
}));

describe("private result page", () => {
  beforeEach(() => {
    mocks.getDashboardActor.mockReset();
    mocks.notFound.mockReset();
    mocks.previewAnalysis.mockReset();
    mocks.notFound.mockImplementation(() => {
      throw new Error("NEXT_NOT_FOUND");
    });
  });

  it("renders the owned experiment through the private chart context", async () => {
    const actor = {
      userId: "owner-1",
      githubLogin: "owner",
      isAdmin: false,
    };
    const result = { schemaVersion: 1, id: "experiment-1" };
    mocks.getDashboardActor.mockResolvedValue(actor);
    mocks.previewAnalysis.mockResolvedValue({ blockers: [], view: result });

    const element = await PrivateResultPage({
      params: Promise.resolve({ experimentId: "experiment-1" }),
    });

    expect(isValidElement(element)).toBe(true);
    expect(mocks.previewAnalysis).toHaveBeenCalledWith(actor, "experiment-1");
    const markup = renderToStaticMarkup(element);
    expect(markup).toContain('aria-label="Experiment result chart"');
    expect(markup).toContain('data-context="private"');
  });

  it("explains partial or unavailable evidence without hiding an owned experiment", async () => {
    mocks.getDashboardActor.mockResolvedValue({
      userId: "owner-1",
      githubLogin: "owner",
      isAdmin: false,
    });
    mocks.previewAnalysis.mockResolvedValue({
      blockers: ["Job job-1 has malformed or unverifiable response evidence."],
      view: null,
    });

    const element = await PrivateResultPage({
      params: Promise.resolve({ experimentId: "experiment-1" }),
    });
    const html = renderToStaticMarkup(element);

    expect(mocks.notFound).not.toHaveBeenCalled();
    expect(html).toContain("Charts are not available yet");
    expect(html).toContain("malformed or unverifiable response evidence");
    expect(html).toContain('href="/dashboard"');
  });

  it("renders available charts alongside partial-evidence warnings", async () => {
    mocks.getDashboardActor.mockResolvedValue({
      userId: "owner-1",
      githubLogin: "owner",
      isAdmin: false,
    });
    mocks.previewAnalysis.mockResolvedValue({
      blockers: ["Job job-1 is missing a valid runner environment."],
      view: { schemaVersion: 1, id: "experiment-1" },
    });

    const element = await PrivateResultPage({
      params: Promise.resolve({ experimentId: "experiment-1" }),
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain("Partial analysis");
    expect(html).toContain("missing a valid runner environment");
    expect(html).toContain('data-context="private"');
  });

  it("returns not found when the experiment is missing or belongs to another user", async () => {
    mocks.getDashboardActor.mockResolvedValue({
      userId: "other-user",
      githubLogin: "other",
      isAdmin: false,
    });
    mocks.previewAnalysis.mockResolvedValue(null);

    await expect(
      PrivateResultPage({
        params: Promise.resolve({ experimentId: "private-experiment" }),
      }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("denies anonymous access before querying private analysis", async () => {
    mocks.getDashboardActor.mockRejectedValue(new Error("NEXT_REDIRECT"));

    await expect(
      PrivateResultPage({
        params: Promise.resolve({ experimentId: "private-experiment" }),
      }),
    ).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.previewAnalysis).not.toHaveBeenCalled();
  });
});
