import { act, create } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ThemeControl } from "./theme-control";

describe("ThemeControl", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("announces the applied theme and persists a keyboard activation", async () => {
    const root = fakeDocumentRoot("dark");
    const setItem = vi.fn();
    vi.stubGlobal("document", { documentElement: root });
    vi.stubGlobal("localStorage", { setItem });
    vi.stubGlobal("window", new EventTarget());

    let renderer: ReturnType<typeof create> | undefined;
    await act(() => {
      renderer = create(<ThemeControl />);
    });
    if (!renderer) throw new Error("Theme control was not rendered.");
    const readyRenderer = renderer;

    const button = readyRenderer.root.findByType("button");
    const buttonProps = button.props as {
      readonly "aria-label": string;
      readonly "aria-pressed": boolean;
      readonly onClick: () => void;
    };
    expect(buttonProps["aria-label"]).toBe("Dark theme");
    expect(buttonProps["aria-pressed"]).toBe(true);

    await act(() => buttonProps.onClick());

    expect(root.dataset.theme).toBe("light");
    expect(root.classList.contains("dark")).toBe(false);
    expect(root.style.colorScheme).toBe("light");
    expect(setItem).toHaveBeenCalledWith("llmbench-theme", "light");
    expect(readyRenderer.root.findByType("button").props["aria-label"]).toBe(
      "Dark theme",
    );
    await act(() => readyRenderer.unmount());
  });
});

function fakeDocumentRoot(initialTheme: "dark" | "light") {
  const classes = new Set(initialTheme === "dark" ? ["dark"] : []);
  return {
    classList: {
      contains: (value: string) => classes.has(value),
      toggle: (value: string, force: boolean) =>
        force ? classes.add(value) : classes.delete(value),
    },
    dataset: { theme: initialTheme },
    style: { colorScheme: initialTheme },
  };
}
