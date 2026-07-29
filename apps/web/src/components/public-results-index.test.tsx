import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PublicResultsIndex } from "./public-results-index";

describe("PublicResultsIndex", () => {
  it("lists curated snapshots with benchmark and sample context", () => {
    const html = renderToStaticMarkup(
      <PublicResultsIndex
        results={[
          {
            id: "experiment-1",
            name: "Repair matrix",
            benchmarkIds: ["repository-repair", "performance"],
            resultCount: 6,
            curatedAt: "2026-07-28T12:00:00.000Z",
          },
          {
            id: "experiment-2",
            name: "Single result",
            benchmarkIds: ["performance"],
            resultCount: 1,
            curatedAt: "2026-07-29T12:00:00.000Z",
          },
        ]}
      />,
    );

    expect(html).toContain("Public result library");
    expect(html).toContain("Repair matrix");
    expect(html).toContain("Repository Repair");
    expect(html).toContain("Performance");
    expect(html).toContain("6 results");
    expect(html).toContain("1 result ·");
    expect(html).toContain('href="/results/experiment-1"');
  });

  it("renders a complete empty state", () => {
    const html = renderToStaticMarkup(<PublicResultsIndex results={[]} />);

    expect(html).toContain("No curated results published yet");
    expect(html).toContain("Open the methodology");
  });
});
