import { beforeEach, describe, expect, it, vi } from "vitest";

const close = vi.fn();
const createControlPlane = vi.fn((_options: unknown) => ({ close }));
const parseWebEnv = vi.fn(() => ({ databaseUrl: "postgresql://test" }));
const get = vi.fn();

vi.mock("@llm-bench/control-plane", () => ({
  createControlPlane,
  PublicArtifactReader: class PublicArtifactReader {},
}));
vi.mock("@/env", () => ({ parseWebEnv }));
vi.mock("@vercel/blob", () => ({ get }));

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

  it("reads response evidence only through the private blob API", async () => {
    const once = vi.spyOn(process, "once");
    const bytes = new TextEncoder().encode('{"evidence":true}');
    get.mockResolvedValue({
      statusCode: 200,
      stream: new Blob([bytes]).stream(),
    });
    const { getDashboardControlPlane } = await import("./runtime");

    getDashboardControlPlane();
    const options = createControlPlane.mock.calls[0]?.[0] as
      | { artifactReader?: { read(pathname: string): Promise<Uint8Array> } }
      | undefined;

    await expect(
      options?.artifactReader?.read("attempts/private/evidence.json"),
    ).resolves.toEqual(bytes);
    expect(get).toHaveBeenCalledWith("attempts/private/evidence.json", {
      access: "private",
    });
    once.mockRestore();
  });
});
