import { isValidElement } from "react";
import { describe, expect, it, vi } from "vitest";

import RunnerPairingPage from "./dashboard/runners/pair/page";
import E2eDashboardTracerPage from "./e2e/dashboard-tracer/page";
import RootLayout, { metadata } from "./layout";
import HomePage from "./page";

const mocks = vi.hoisted(() => ({
  notFound: vi.fn(),
  list: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  notFound: mocks.notFound,
  redirect: mocks.redirect,
}));
vi.mock("@/components/landing-shell", () => ({
  LandingShell: () => "landing",
}));
vi.mock("@/app/dashboard/runtime", () => ({
  getDashboardControlPlane: () => ({
    publicResults: { list: mocks.list },
  }),
}));
vi.mock("@/components/runner-pairing-form", () => ({
  RunnerPairingForm: () => "pairing-form",
}));

describe("app pages", () => {
  it("renders the root, curated home, and pairing page elements", async () => {
    mocks.list.mockResolvedValue([
      {
        id: "public-1",
        name: "Public comparison",
        benchmarkIds: ["performance"],
        resultCount: 2,
        curatedAt: "2026-07-28T12:00:00.000Z",
      },
    ]);
    expect(metadata.title).toBe("LLMBench");
    expect(RootLayout({ children: "child" }).type).toBe("html");
    const home = await HomePage();
    expect(isValidElement<{ results: readonly unknown[] }>(home)).toBe(true);
    if (!isValidElement<{ results: readonly unknown[] }>(home)) {
      throw new Error("Expected HomePage to return a React element.");
    }
    expect(home.props.results).toHaveLength(1);
    expect(RunnerPairingPage().type).toBe("main");
  });

  it("keeps the tracer route development-only", () => {
    E2eDashboardTracerPage();
    expect(mocks.redirect).toHaveBeenCalledWith("/dashboard");
  });
});
