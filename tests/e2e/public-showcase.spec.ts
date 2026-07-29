import { expect, test } from "@playwright/test";

const EXPERIMENT_ID = "13000000-0000-4000-8000-000000000013";

test("anonymous visitors can inspect public evidence but not private runs", async ({
  page,
  request,
}, testInfo) => {
  const headers = {
    "x-llm-bench-e2e-token": String(testInfo.config.metadata.e2eToken),
  };
  await expect(
    (await request.post("/api/e2e/reset", { headers })).json(),
  ).resolves.toEqual({ reset: true });
  await expect(
    (await request.post("/api/e2e/showcase", { headers })).json(),
  ).resolves.toEqual({ experimentId: EXPERIMENT_ID });

  await page.goto("/results");
  await expect(
    page.getByRole("heading", { name: "Public result library" }),
  ).toBeVisible();
  await page
    .getByRole("link", {
      name: /Tool-use models under identical conditions/u,
    })
    .click();

  await expect(page).toHaveURL(new RegExp(`/results/${EXPERIMENT_ID}$`, "u"));
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Tool-use models under identical conditions",
    }),
  ).toBeVisible();
  const exactValueTables = page.getByRole("table", { name: "Exact values" });
  await expect(exactValueTables).toHaveCount(2);
  await expect(exactValueTables.getByText("n=3", { exact: true })).toHaveCount(
    2,
  );
  await expect(
    exactValueTables.getByText("Missing", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("img", { name: "Schema compliance aggregate ranking" }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", {
      name: "Schema compliance measured response samples",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("table", { name: "Ordered measured response samples" }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", { name: "Quality versus cost" }),
  ).toBeVisible();
  await page
    .getByText("Diff evidence summary", { exact: true })
    .first()
    .click();
  await expect(
    page.getByText("response_evidence", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Trajectories and chronological results",
    }),
  ).toBeVisible();

  await page.goto("/results/13000000-0000-4000-8000-000000000099");
  await expect(
    page.getByRole("heading", { level: 1, name: "404" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Tool-use models under identical conditions",
    }),
  ).toHaveCount(0);
});
