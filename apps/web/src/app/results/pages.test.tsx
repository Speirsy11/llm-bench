import { isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ResultPage from "./[experimentId]/page";
import ResultsError from "./error";
import ResultsLoading from "./loading";
import ResultsPage from "./page";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  list: vi.fn(),
  notFound: vi.fn(),
}));

vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("@/app/dashboard/runtime", () => ({
  getDashboardControlPlane: () => ({
    publicResults: { get: mocks.get, list: mocks.list },
  }),
}));
vi.mock("@/components/public-result-shell", () => ({
  PublicResultShell: () => null,
}));
vi.mock("@/components/public-results-index", () => ({
  PublicResultsIndex: () => null,
}));

describe("public result pages", () => {
  beforeEach(() => {
    mocks.get.mockReset();
    mocks.list.mockReset();
    mocks.notFound.mockReset();
    mocks.notFound.mockImplementation(() => {
      throw new Error("NEXT_NOT_FOUND");
    });
  });

  it("loads the anonymous result library", async () => {
    const results = [
      {
        id: "experiment-1",
        name: "Public fixture",
        benchmarkIds: ["performance"],
        resultCount: 2,
        curatedAt: "2026-07-28T12:00:00.000Z",
      },
    ];
    mocks.list.mockResolvedValue(results);

    const element = await ResultsPage();

    expect(isValidElement(element)).toBe(true);
    expect(element.props).toEqual({ results });
  });

  it("loads only a curated snapshot by public identifier", async () => {
    const result = { schemaVersion: 1, id: "experiment-1" };
    mocks.get.mockResolvedValue(result);

    const element = await ResultPage({
      params: Promise.resolve({ experimentId: "experiment-1" }),
    });

    expect(mocks.get).toHaveBeenCalledWith("experiment-1");
    expect(element.props).toEqual({ result });
  });

  it("returns not found for private or missing snapshots", async () => {
    mocks.get.mockResolvedValue(null);

    await expect(
      ResultPage({
        params: Promise.resolve({ experimentId: "private-experiment" }),
      }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("renders a public result loading skeleton", () => {
    const loading = ResultsLoading();
    expect(isValidElement<{ readonly "aria-label": string }>(loading)).toBe(
      true,
    );
    if (!isValidElement<{ readonly "aria-label": string }>(loading)) {
      throw new Error("Expected ResultsLoading to return a React element.");
    }
    expect(loading.props["aria-label"]).toBe("Loading public results");
  });

  it("renders an accessible recoverable error state without private detail", () => {
    const html = renderToStaticMarkup(<ResultsError reset={() => undefined} />);

    expect(html).toContain("<main");
    expect(html).toContain('aria-labelledby="results-error-heading"');
    expect(html).toContain("The evidence could not be loaded.");
    expect(html).toContain("No private data was exposed.");
    expect(html).toContain("<button");
    expect(html).toContain("Try again");
    expect(html).toContain('href="/results"');
    expect(html).toContain("flex-wrap");
  });
});
