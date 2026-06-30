import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DashboardShell } from "./dashboard-shell";

describe("DashboardShell", () => {
  it("renders the signed-in user's private control-plane shell", () => {
    const html = renderToStaticMarkup(
      <DashboardShell githubLogin="speirsy11" name="Charlie" />,
    );

    expect(html).toContain("Good to see you, Charlie");
    expect(html).toContain("Private workspace");
    expect(html).toContain("No paired runner yet");
  });
});
