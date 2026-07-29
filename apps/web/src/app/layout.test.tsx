import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import RootLayout from "./layout";

describe("RootLayout", () => {
  it("initializes color preference before rendering the global theme control", () => {
    const html = renderToStaticMarkup(
      <RootLayout>
        <main>Application</main>
      </RootLayout>,
    );

    expect(html).toContain("llmbench-theme");
    expect(html.indexOf("llmbench-theme")).toBeLessThan(html.indexOf("<body"));
    expect(html).toContain('aria-label="Dark theme"');
    expect(html).toContain("<main>Application</main>");
  });
});
