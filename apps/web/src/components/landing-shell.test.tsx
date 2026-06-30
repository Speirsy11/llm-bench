import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { LandingShell } from "./landing-shell";

describe("LandingShell", () => {
  it("explains the public methodology and offers GitHub sign-in", () => {
    const html = renderToStaticMarkup(<LandingShell />);

    expect(html).toContain("Compare models, harnesses, and tools separately");
    expect(html).toContain("Agentic repository repair");
    expect(html).toContain("Sign in with GitHub");
  });
});
