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
  await auth.page.addInitScript(() => {
    const original = HTMLInputElement.prototype.showPicker;
    if (!original) return;
    HTMLInputElement.prototype.showPicker = function showPicker() {
      this.dataset.showPickerCalls = String(Number(this.dataset.showPickerCalls ?? 0) + 1);
      return original.call(this);
    };
  });
  await auth.page.goto("/");

  await expect(auth.page.getByRole("button", { name: "Previous day" })).toBeDisabled();
  const trigger = auth.page.getByRole("button", { name: "Go to Date" });
  const datePicker = auth.page.locator('input[type="date"][aria-label="Go to Date"]');
  await trigger.click();
  await expect(datePicker).toHaveAttribute("data-show-picker-calls", "1");
  await auth.page.keyboard.press("Escape");
  await trigger.click();
  await expect(datePicker).toHaveAttribute("data-show-picker-calls", "2");
  await expect(datePicker).toHaveAttribute("min", /^\d{4}-\d{2}-\d{2}$/);
  await datePicker.evaluate((input, date) => {
    const picker = input as HTMLInputElement;
    picker.value = date;
    picker.dispatchEvent(new Event("input", { bubbles: true }));
    picker.dispatchEvent(new Event("change", { bubbles: true }));
  }, "2026-09-21");
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
