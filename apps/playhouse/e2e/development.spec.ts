import { expect, test } from "./fixtures";

test("Development Console filters and persists feature CRUD", async ({ auth }) => {
  await auth.page.goto("/development");
  await expect(auth.page.getByRole("heading", { name: "Carnival Development" })).toBeVisible();
  await expect(auth.page.getByText("Features, priorities & development sequence")).toBeVisible();
  await expect(auth.page.getByRole("row", { name: /Drag Email into PlayHouse/ })).toBeVisible();

  await auth.page.getByRole("button", { name: "Gmail", exact: true }).click();
  await expect(auth.page.getByRole("row", { name: /Drag Email into PlayHouse/ })).toBeVisible();
  await expect(auth.page.getByRole("row", { name: /Play Templates/ })).toHaveCount(0);
  await auth.page.getByRole("button", { name: "All Features", exact: true }).click();

  await auth.page.getByPlaceholder("Search features...").fill("Slack Integration");
  await expect(auth.page.getByRole("row", { name: /Slack Integration/ })).toBeVisible();
  await auth.page.getByPlaceholder("Search features...").fill("");
  await auth.page.getByLabel("Filter by status").selectOption("Ready");
  await auth.page.getByLabel("Filter by priority").selectOption("Medium");
  await expect(auth.page.getByRole("row", { name: /Play Templates/ })).toBeVisible();
  await auth.page.getByLabel("Filter by status").selectOption("All Statuses");
  await auth.page.getByLabel("Filter by priority").selectOption("All Priorities");

  await auth.page.getByRole("button", { name: /New Feature/ }).click();
  const dialog = auth.page.getByRole("dialog", { name: "New Feature" });
  await dialog.getByLabel(/Title/).fill("E2E Development Feature");
  await dialog.getByLabel(/Description/).fill("Created through the Development Console API.");
  await dialog.getByLabel("Component").selectOption("Logger / Changelog");
  await dialog.getByLabel("Status").selectOption("Planned");
  await dialog.getByLabel("Priority").selectOption("High");
  await dialog.getByLabel("Sequence").fill("0");
  await dialog.getByText("Drag Email into PlayHouse").click();
  await dialog.getByRole("button", { name: "Save Feature" }).click();
  await expect(auth.page.getByRole("row", { name: /E2E Development Feature/ })).toBeVisible();

  await auth.page.reload();
  const row = auth.page.getByRole("row", { name: /E2E Development Feature/ });
  await expect(row).toBeVisible();
  await row.click();
  const edit = auth.page.getByRole("dialog", { name: "Edit Feature" });
  await expect(edit.getByLabel("Sequence")).toHaveValue("0");
  await expect(edit.getByText("Drag Email into PlayHouse")).toBeVisible();
  await edit.getByLabel(/Title/).fill("E2E Development Feature Updated");
  await edit.getByRole("button", { name: "Save Changes" }).click();
  await expect(auth.page.getByRole("row", { name: /E2E Development Feature Updated/ })).toBeVisible();

  await auth.page.getByRole("row", { name: /E2E Development Feature Updated/ }).click();
  await auth.page.getByRole("button", { name: "Delete Feature" }).click();
  await auth.page.getByRole("button", { name: "Confirm Delete" }).click();
  await expect(auth.page.getByRole("row", { name: /E2E Development Feature Updated/ })).toHaveCount(0);
});
