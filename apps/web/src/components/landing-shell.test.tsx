import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { LandingShell } from "./landing-shell";

describe("LandingShell", () => {
  it("explains the public methodology and offers GitHub sign-in", () => {
    const html = renderToStaticMarkup(
      <LandingShell
        results={[
          {
            id: "experiment-public",
            name: "Curated repair comparison",
            benchmarkIds: ["repository-repair"],
            resultCount: 4,
            curatedAt: "2026-07-28T12:00:00.000Z",
          },
        ]}
      />,
    );

    expect(html).toContain("Compare models, harnesses, and tools separately");
    expect(html).toContain("Agentic repository repair");
    expect(html).toContain("Sign in with GitHub");
    expect(html).toContain("Curated repair comparison");
    expect(html).toContain('href="/results/experiment-public"');
    expect(html).toContain("4 results");
  });

  it("labels the editorial fixture when no curated result exists yet", () => {
    const html = renderToStaticMarkup(<LandingShell results={[]} />);

    expect(html).toContain("Methodology preview");
    expect(html).toContain("Fixture data");
    expect(html).toContain("No curated results published yet");
  });
});
