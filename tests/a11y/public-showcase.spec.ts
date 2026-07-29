import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import axe from "axe-core";

const EXPERIMENT_ID = "13000000-0000-4000-8000-000000000013";

test.beforeEach(async ({ page, request }, testInfo) => {
  const headers = {
    "x-llm-bench-e2e-token": String(testInfo.config.metadata.e2eToken),
  };
  await request.post("/api/e2e/reset", { headers });
  await request.post("/api/e2e/showcase", { headers });
  await page.goto(`/results/${EXPERIMENT_ID}`);
});

test("critical public evidence has names, structure, exact values, theme control, and keyboard access", async ({
  page,
}, testInfo) => {
  await expect(page.getByRole("main")).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(
    page.getByRole("img", {
      name: "Schema compliance aggregate ranking",
    }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("img", {
      name: "Schema compliance measured response samples",
    }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("table", { name: "Ordered measured response samples" }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("img", { name: "Quality versus time" }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("img", { name: "Quality versus cost" }),
  ).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "Exact values" })).toHaveCount(
    2,
  );
  const exactValueTables = page.getByRole("table", { name: "Exact values" });
  if (testInfo.project.name === "desktop-chrome") {
    await expect(exactValueTables).toHaveCount(2);
    await expect(
      page.getByRole("region", { name: "Scrollable exact values table" }),
    ).toHaveCount(2);
    await expect(exactValueTables.locator("th[scope=col]")).toHaveCount(16);
  } else {
    await expect(exactValueTables).toHaveCount(0);
    await expect(
      page.getByText("Provider cost", { exact: true }).first(),
    ).toBeVisible();
  }

  const unnamedInteractiveElements = await page
    .locator("a, button, input, select, textarea, summary")
    .evaluateAll((elements) =>
      elements
        .filter((element) => {
          const label =
            element.getAttribute("aria-label") ??
            element.getAttribute("title") ??
            element.textContent ??
            "";
          return label.trim().length === 0;
        })
        .map((element) => element.outerHTML),
    );
  expect(unnamedInteractiveElements).toEqual([]);

  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "LLMBench" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "All results" })).toBeFocused();

  const themeControl = page.getByRole("button", { name: "Dark theme" });
  await expect(themeControl).toBeVisible();
  const initialTheme = await page.locator("html").getAttribute("data-theme");
  await themeControl.focus();
  await page.keyboard.press("Space");
  const expectedTheme = initialTheme === "dark" ? "light" : "dark";
  await expect(page.locator("html")).toHaveAttribute(
    "data-theme",
    expectedTheme,
  );
  await expect(themeControl).toHaveAttribute(
    "aria-pressed",
    expectedTheme === "dark" ? "true" : "false",
  );
  await expectAccessibleAndReflowingInBothThemes(page);
});

test("critical public evidence stays inside the viewport", async ({
  page,
}, testInfo) => {
  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
  const exactValueContainer =
    testInfo.project.name === "desktop-chrome" ? "td:visible" : "dd:visible";
  await expect(
    page
      .locator(exactValueContainer)
      .filter({ hasText: /^Missing$/ })
      .first(),
  ).toBeVisible();
  await expect(
    page.locator(exactValueContainer).filter({ hasText: /^n=1$/ }).first(),
  ).toBeVisible();
});

test("landing, populated and empty libraries, and not-found reflow accessibly in both themes", async ({
  page,
  request,
}, testInfo) => {
  for (const path of ["/", "/results"]) {
    await page.goto(path);
    await expectAccessibleAndReflowingInBothThemes(page);
  }

  const headers = {
    "x-llm-bench-e2e-token": String(testInfo.config.metadata.e2eToken),
  };
  await request.post("/api/e2e/reset", { headers });
  await page.goto("/results");
  await expect(
    page.getByText("No curated results published yet", { exact: false }),
  ).toBeVisible();
  await expectAccessibleAndReflowingInBothThemes(page);

  await page.goto("/results/13000000-0000-4000-8000-000000000099");
  await expect(
    page.getByRole("heading", { level: 1, name: "404" }),
  ).toBeVisible();
  await expectAccessibleAndReflowingInBothThemes(page);
});

test("deterministic loading and error states reflow accessibly in both themes", async ({
  page,
}) => {
  await page.goto("/e2e/public-states/loading");
  await expect(
    page.getByRole("main", { name: "Loading public results" }),
  ).toBeVisible();
  await expectAccessibleAndReflowingInBothThemes(page);

  await page.goto("/e2e/public-states/error");
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "The evidence could not be loaded.",
    }),
  ).toBeVisible();
  await expectAccessibleAndReflowingInBothThemes(page);
});

async function expectAccessibleAndReflowingInBothThemes(
  page: Page,
): Promise<void> {
  for (const theme of ["light", "dark"] as const) {
    await page.evaluate((selectedTheme) => {
      localStorage.setItem("llmbench-theme", selectedTheme);
      document.documentElement.dataset.theme = selectedTheme;
    }, theme);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expectViewportReflow(page);
    await expectNoWcagAxeViolations(page);
  }
}

async function expectViewportReflow(page: Page): Promise<void> {
  const dimensions = await page.evaluate(() => ({
    viewportWidth: document.documentElement.clientWidth,
    contentWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.contentWidth).toBeLessThanOrEqual(dimensions.viewportWidth);
}

async function expectNoWcagAxeViolations(page: Page): Promise<void> {
  await page.addScriptTag({ content: axe.source });
  const violations = await page.evaluate(async () => {
    const engine = (
      globalThis as typeof globalThis & {
        axe: {
          run: (
            root: Document,
            options: {
              runOnly: { type: "tag"; values: string[] };
            },
          ) => Promise<{
            violations: {
              id: string;
              impact: string | null;
              nodes: {
                failureSummary: string | undefined;
                html: string;
                target: string[];
              }[];
            }[];
          }>;
        };
      }
    ).axe;
    const result = await engine.run(document, {
      runOnly: {
        type: "tag",
        values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
      },
    });
    return result.violations.map(({ id, impact, nodes }) => ({
      id,
      impact,
      nodes: nodes.map(({ failureSummary, html, target }) => ({
        failureSummary,
        html,
        target,
      })),
    }));
  });
  expect(violations).toEqual([]);
}
