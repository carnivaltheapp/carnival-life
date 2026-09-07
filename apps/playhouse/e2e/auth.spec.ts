import { expect, test } from "./fixtures";

test("unauthenticated screen and build stamp render", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Carnival PlayHouse" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in with Google" })).toBeVisible();
  await expect(page.getByTestId("version-stamp")).toHaveText(
    /^Version .+ · \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/,
  );
});

test("disposable authenticated session loads the PlayHouse shell", async ({ auth }) => {
  await auth.page.goto("/");

  await expect(auth.page.getByRole("heading", { name: "Today" })).toBeVisible();
  await expect(auth.page.getByRole("navigation")).toContainText("Backlog");
  await expect(auth.page.getByTestId("play-count")).toHaveText("0 Plays");
  await expect(auth.page.getByTestId("version-stamp")).toBeVisible();
});

test("Go to Date reuses the single-day view with previous and next navigation", async ({ auth }) => {
  await auth.page.goto("/");

  await expect(auth.page.getByRole("button", { name: "Previous day" })).toBeDisabled();
  await auth.page.getByRole("button", { name: "Go to Date" }).click();
  const datePicker = auth.page.locator('input[type="date"][aria-label="Go to Date"]');
  await expect(datePicker).toBeVisible();
  await expect(datePicker).toHaveAttribute("min", /^\d{4}-\d{2}-\d{2}$/);
  await datePicker.fill("2026-09-21");
  await expect(auth.page).toHaveURL(/\?date=2026-09-21$/);
  await expect(auth.page.getByRole("heading", { name: "Monday, September 21" })).toBeVisible();

  await auth.page.getByRole("link", { name: "Previous day" }).click();
  await expect(auth.page).toHaveURL(/\?date=2026-09-20$/);
  await expect(auth.page.getByRole("heading", { name: "Sunday, September 20" })).toBeVisible();

  await auth.page.getByRole("link", { name: "Next day" }).click();
  await expect(auth.page).toHaveURL(/\?date=2026-09-21$/);
  await auth.page.getByRole("link", { name: "Next day" }).click();
  await expect(auth.page).toHaveURL(/\?date=2026-09-22$/);
});
