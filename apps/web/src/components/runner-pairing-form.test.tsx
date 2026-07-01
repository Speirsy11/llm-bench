import { renderToStaticMarkup } from "react-dom/server";
import { act, create } from "react-test-renderer";
import { describe, expect, it } from "vitest";

import { approveRunnerPairing, RunnerPairingForm } from "./runner-pairing-form";

describe("RunnerPairingForm", () => {
  it("renders an accessible one-time-code form", () => {
    const html = renderToStaticMarkup(<RunnerPairingForm />);

    expect(html).toContain('for="runner-code"');
    expect(html).toMatch(/autocomplete="one-time-code"/i);
    expect(html).toContain("Pair runner");
  });

  it("submits a trimmed code and reports server errors", async () => {
    const requests: { input: RequestInfo | URL; init?: RequestInit }[] = [];
    const success = (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ input, init });
      return Promise.resolve(Response.json({ runnerId: "runner-1" }));
    };

    await expect(approveRunnerPairing(" CODE ", success)).resolves.toBe(
      "Runner paired. You can close this page.",
    );
    expect(requests[0]?.init?.body).toBe('{"userCode":"CODE"}');
    await expect(
      approveRunnerPairing("bad", () =>
        Promise.resolve(
          Response.json({ error: "Code expired." }, { status: 400 }),
        ),
      ),
    ).rejects.toThrow("Code expired.");
  });

  it("updates the visible status after an interactive submission", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = () =>
      Promise.resolve(Response.json({ runnerId: "runner-1" }));
    try {
      let renderer: ReturnType<typeof create> | undefined;
      await act(() => {
        renderer = create(<RunnerPairingForm />);
      });
      if (!renderer) throw new Error("Renderer was not created.");
      const input = renderer.root.findByType("input");
      const form = renderer.root.findByType("form");
      const inputProps = input.props as {
        onChange(event: { target: { value: string } }): void;
      };
      const formProps = form.props as {
        onSubmit(event: { preventDefault(): void }): void;
      };
      await act(() => inputProps.onChange({ target: { value: "CODE" } }));
      await act(async () => {
        formProps.onSubmit({ preventDefault: () => undefined });
        await Promise.resolve();
      });

      expect(renderer.root.findByProps({ role: "status" }).children).toEqual([
        "Runner paired. You can close this page.",
      ]);
      renderer.unmount();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("disables controls while a pairing approval is pending", async () => {
    const originalFetch = globalThis.fetch;
    let resolveFetch: ((response: Response) => void) | undefined;
    let calls = 0;
    globalThis.fetch = () => {
      calls += 1;
      return new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      });
    };
    try {
      let renderer: ReturnType<typeof create> | undefined;
      await act(() => {
        renderer = create(<RunnerPairingForm />);
      });
      if (!renderer) throw new Error("Renderer was not created.");
      const input = renderer.root.findByType("input");
      const form = renderer.root.findByType("form");
      const inputProps = input.props as {
        onChange(event: { target: { value: string } }): void;
      };
      const formProps = form.props as {
        onSubmit(event: { preventDefault(): void }): void;
      };

      await act(() => inputProps.onChange({ target: { value: "CODE" } }));
      await act(() => {
        formProps.onSubmit({ preventDefault: () => undefined });
        formProps.onSubmit({ preventDefault: () => undefined });
      });

      expect(calls).toBe(1);
      expect(renderer.root.findByType("input").props.disabled).toBe(true);
      expect(renderer.root.findByType("button").props.disabled).toBe(true);

      await act(async () => {
        resolveFetch?.(Response.json({ runnerId: "runner-1" }));
        await Promise.resolve();
      });
      expect(renderer.root.findByType("input").props.disabled).toBe(false);
      renderer.unmount();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
