import { afterEach, describe, expect, it, vi } from "vitest";

import { initializeTheme } from "./theme-initialization";

describe("initializeTheme", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    {
      preference: "light",
      systemDark: true,
      expected: "light",
      label: "a persisted light preference",
    },
    {
      preference: "dark",
      systemDark: false,
      expected: "dark",
      label: "a persisted dark preference",
    },
    {
      preference: null,
      systemDark: true,
      expected: "dark",
      label: "the dark system preference",
    },
  ] as const)(
    "applies $label before content paints",
    ({ expected, preference, systemDark }) => {
      const root = fakeDocumentRoot();
      vi.stubGlobal("document", { documentElement: root });
      vi.stubGlobal("localStorage", {
        getItem: () => preference,
      });
      vi.stubGlobal("matchMedia", () => ({ matches: systemDark }));

      initializeTheme();

      expect(root.dataset.theme).toBe(expected);
      expect(root.classList.contains("dark")).toBe(expected === "dark");
      expect(root.style.colorScheme).toBe(expected);
    },
  );
});

function fakeDocumentRoot() {
  const classes = new Set<string>();
  return {
    classList: {
      contains: (value: string) => classes.has(value),
      toggle: (value: string, force: boolean) =>
        force ? classes.add(value) : classes.delete(value),
    },
    dataset: {} as Record<string, string>,
    style: { colorScheme: "" },
  };
}
