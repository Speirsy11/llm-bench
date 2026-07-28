import { beforeEach, describe, expect, it, vi } from "vitest";

const close = vi.fn();
const createControlPlane = vi.fn(() => ({ close }));
const parseWebEnv = vi.fn(() => ({ databaseUrl: "postgresql://test" }));

vi.mock("@llm-bench/control-plane", () => ({ createControlPlane }));
vi.mock("@/env", () => ({ parseWebEnv }));

describe("dashboard runtime", () => {
  beforeEach(() => {
    vi.resetModules();
    close.mockReset();
    createControlPlane.mockClear();
    parseWebEnv.mockClear();
  });

  it("creates one control plane and closes it on process shutdown", async () => {
    const once = vi.spyOn(process, "once");
    const { getDashboardControlPlane } = await import("./runtime");

    const first = getDashboardControlPlane();
    expect(getDashboardControlPlane()).toBe(first);
    expect(createControlPlane).toHaveBeenCalledTimes(1);
    expect(parseWebEnv).toHaveBeenCalledWith(process.env);

    const shutdown = once.mock.calls.find(
      ([signal]) => signal === "SIGTERM",
    )?.[1];
    expect(shutdown).toBeTypeOf("function");
    if (typeof shutdown === "function") shutdown();
    expect(close).toHaveBeenCalledOnce();
    once.mockRestore();
  });
});
