import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

async function samples(page: import("@playwright/test").Page, text: string) {
  await page.goto("/");
  await page.getByRole("button", { name: "2. Samples", exact: true }).click();
  await page.getByLabel("Sample table", { exact: true }).fill(text);
  await page
    .getByRole("button", { name: "Review samples and calculate" })
    .click();
}

test("invalid rows stay visible and need a reason before export", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open practice experiment" }).click();
  await page
    .getByRole("button", { name: "Review samples and calculate" })
    .click();
  await expect(
    page.getByText("4 input rows · 2 ready · 0 excluded · 2 need correction"),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "invalid", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Download CSV" }),
  ).toBeDisabled();
  await page.getByLabel("Exclude 3", { exact: true }).check();
  await page
    .getByLabel("Reason 3", { exact: true })
    .fill("Insufficient RNA for this target.");
  await page.getByLabel("Exclude 4", { exact: true }).check();
  await page.getByRole("button", { name: "Recalculate", exact: true }).click();
  await expect(
    page.getByText("An excluded sample needs a reason."),
  ).toBeVisible();
  await page
    .getByLabel("Reason 4", { exact: true })
    .fill("Concentration needs remeasurement.");
  await page.getByRole("button", { name: "Recalculate", exact: true }).click();
  await expect(
    page.getByText("4 input rows · 2 ready · 2 excluded · 0 need correction"),
  ).toBeVisible();
  await page.getByLabel("I checked sample IDs").check();
  await expect(
    page.getByRole("button", { name: "Download CSV" }),
  ).toBeEnabled();
});

test("reviewed CSV, workbook and portable experiment survive save and reopen", async ({
  page,
}) => {
  await samples(
    page,
    "Sample\tConcentration\tAvailable\nAnimal A\t50\t10\nAnimal B\t1000\t5",
  );
  await expect(
    page.getByText("2 input rows · 2 ready · 0 excluded · 0 need correction"),
  ).toBeVisible();
  await page.getByLabel("I checked sample IDs").check();
  const csvEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download CSV" }).click();
  const csv = await readFile((await (await csvEvent).path())!, "utf8");
  expect(csv).toContain("Animal A");
  expect(csv).toContain('"4"');
  const xlsxEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download Excel workbook" }).click();
  const xlsx = await xlsxEvent;
  expect((await readFile((await xlsx.path())!)).subarray(0, 2).toString()).toBe(
    "PK",
  );
  const savedEvent = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download experiment package" })
    .click();
  const path = (await (await savedEvent).path())!;
  const saved = JSON.parse(await readFile(path, "utf8"));
  expect(saved.payload.experiment.reviewed).toBe(true);
  expect(saved.payload.result.rows).toHaveLength(2);
  await page.reload();
  await page.getByLabel("Open experiment", { exact: true }).setInputFiles(path);
  await expect(
    page.getByText("Experiment reopened with its reviewed choices."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Download CSV" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "1. Recipe", exact: true }).click();
  await page.getByLabel("RNA target (ng)", { exact: true }).fill("100");
  await page
    .getByRole("button", { name: "3. Review & export", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Download CSV" }),
  ).toBeDisabled();
  await expect(
    page.getByText("Results need recalculation after the latest changes."),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Master mix and individual aliquots" }),
  ).toBeHidden();
});

test("custom recipe, individual reagent, undo and new experiment carry only the recipe", async ({
  page,
}) => {
  await samples(page, "Animal A\t50\t10");
  await page.getByRole("button", { name: "1. Recipe", exact: true }).click();
  await page.getByLabel("Permit a different reaction volume").check();
  await page.getByLabel("Reaction volume (µL)", { exact: true }).fill("25");
  await page
    .getByText("Edit reaction components and scaling details", { exact: true })
    .click();
  await page.getByLabel("Pool reagent 4", { exact: true }).uncheck();
  await page
    .getByRole("button", { name: "3. Review & export", exact: true })
    .click();
  await page.getByRole("button", { name: "Recalculate", exact: true }).click();
  await expect(
    page.getByText("Add individually", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "1. Recipe", exact: true }).click();
  await page.getByLabel("RNA target (ng)", { exact: true }).fill("300");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByLabel("RNA target (ng)", { exact: true })).toHaveValue(
    "200",
  );
  page.on("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "New experiment", exact: true })
    .click();
  await expect(
    page.getByLabel("Reaction volume (µL)", { exact: true }),
  ).toHaveValue("25");
  await page.getByRole("button", { name: "2. Samples", exact: true }).click();
  await expect(page.getByLabel("Sample table", { exact: true })).toHaveValue(
    "",
  );
});

test("reserved recipe name and source-file admission cannot create unreopenable saves", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Save named recipe" }).click();
  await expect(
    page.getByText(
      "Error: Choose a custom name; the built-in legacy name is reserved.",
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "2. Samples", exact: true }).click();
  const file = {
    name: "test.tsv",
    mimeType: "text/tab-separated-values",
    buffer: Buffer.from("Animal A\t50\t10"),
  };
  for (let i = 0; i < 30; i++) {
    await page
      .getByLabel("Load sample table", { exact: true })
      .setInputFiles(file);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            JSON.parse(localStorage.getItem("easylab-next:cdna:experiment:v1")!)
              .source_copies.length,
        ),
      )
      .toBe(i + 1);
  }
  await page
    .getByLabel("Load sample table", { exact: true })
    .setInputFiles(file);
  await expect(
    page.getByText(
      "This experiment already contains 30 source files. Start a new experiment to import another file.",
    ),
  ).toBeVisible();
  const savedEvent = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Save experiment", exact: true })
    .click();
  const path = (await (await savedEvent).path())!;
  await page.getByLabel("Open experiment", { exact: true }).setInputFiles(path);
  await expect(
    page.getByText("Inputs reopened; review the recalculated results."),
  ).toBeVisible();
});
