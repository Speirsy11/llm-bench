import { describe, expect, it, vi } from "vitest";

import RunnerPairingPage from "./dashboard/runners/pair/page";
import E2eDashboardTracerPage from "./e2e/dashboard-tracer/page";
import RootLayout, { metadata } from "./layout";
import HomePage from "./page";

const mocks = vi.hoisted(() => ({
  notFound: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  notFound: mocks.notFound,
  redirect: mocks.redirect,
}));
vi.mock("@/components/landing-shell", () => ({
  LandingShell: () => "landing",
}));
vi.mock("@/components/runner-pairing-form", () => ({
  RunnerPairingForm: () => "pairing-form",
}));

describe("app pages", () => {
  it("renders the root, home, and pairing page elements", () => {
    expect(metadata.title).toBe("LLMBench");
    expect(RootLayout({ children: "child" }).type).toBe("html");
    expect(HomePage().type).toBeTypeOf("function");
    expect(RunnerPairingPage().type).toBe("main");
  });

  it("keeps the tracer route development-only", () => {
    E2eDashboardTracerPage();
    expect(mocks.redirect).toHaveBeenCalledWith("/dashboard");
  });
});
