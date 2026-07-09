import { expect, test } from "@playwright/test";

test("dashboard tracer launches, cancels, retries, and renders a result", async ({
  page,
}) => {
  await page.goto("/e2e/dashboard-tracer");

  await expect(page.getByText("Fixture runner", { exact: true })).toBeVisible();
  await expect(page.getByText("2 projected jobs")).toBeVisible();

  await page.getByRole("button", { name: "Save credential" }).click();
  await expect(page.getByText("OpenRouter fixture")).toBeVisible();

  await page.getByLabel("Confirm unknown spend").check();
  await page.getByRole("button", { name: "Launch experiment" }).click();
  await expect(
    page.getByText("openrouter-gpt-4o · llmbench", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("openrouter-llama · llmbench", { exact: true }),
  ).toBeVisible();

  await page
    .getByText("openrouter-llama · llmbench", { exact: true })
    .locator("xpath=ancestor::div[button][1]")
    .getByRole("button", { name: "Cancel" })
    .click();
  await expect(page.getByText("cancelled")).toBeVisible();
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByText("queued · retry")).toBeVisible();

  await page.getByRole("button", { name: "Run fixture runner" }).click();
  await expect(page.getByText("Hidden test pass ratio:")).toHaveCount(2);
  await expect(page.getByText("2/3 completed")).toBeVisible();
});
