import { expect, test } from "./fixtures";

test("unauthenticated screen and build stamp render", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Carnival PlayHouse" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in with Google" })).toBeVisible();
  await expect(page.getByTestId("version-stamp")).toHaveText("P3-PH-BRANCH-SQUEEZE-18");
});

test("disposable authenticated session loads the PlayHouse shell", async ({ auth }) => {
  await auth.page.goto("/");

  await expect(auth.page.locator(".headerViewTitle")).toContainText(/, /);
  await expect(auth.page.getByRole("button", { name: "User menu" })).toBeVisible();
  await auth.page.getByRole("button", { name: "Baskets" }).click();
  await expect(auth.page.getByRole("navigation")).toContainText("Backlog");
  await expect(auth.page.getByTestId("play-count")).toHaveText("0 Plays");
  await expect(auth.page.getByTestId("version-stamp")).toBeVisible();
});

test("avatar menu owns Profile, Settings, and Sign Out", async ({ auth }) => {
  await auth.page.goto("/");

  const header = auth.page.locator(".appHeader");
  await expect(header.getByText("PlayHouse E2E User")).toHaveCount(0);
  await expect(header.getByText(/@example\.test/)).toHaveCount(0);
  await expect(header.getByRole("button", { name: "Sign Out" })).toHaveCount(0);
  await expect(header.locator(".settingsButton")).toHaveCount(0);

  await header.getByRole("button", { name: "User menu" }).click();
  const menu = auth.page.getByRole("dialog", { name: "User menu" });
  await expect(menu.getByRole("button")).toHaveText(["Profile", "Settings", "Sign Out"]);
  await expect(menu.getByRole("button").last()).toHaveText("Sign Out");

  await menu.getByRole("button", { name: "Profile" }).click();
  const profile = menu.getByRole("region", { name: "Profile" });
  await expect(profile).toContainText("PlayHouse E2E User");
  await expect(profile).toContainText(/@example\.test/);

  await menu.getByRole("button", { name: "Sign Out" }).click();
  await expect(auth.page.getByRole("button", { name: "Sign in with Google" })).toBeVisible();
});

test("Go to Date reuses the single-day view without heading arrows", async ({ auth }) => {
  await auth.page.addInitScript(() => {
    const original = HTMLInputElement.prototype.showPicker;
    if (!original) return;
    HTMLInputElement.prototype.showPicker = function showPicker() {
      this.dataset.showPickerCalls = String(Number(this.dataset.showPickerCalls ?? 0) + 1);
      return original.call(this);
    };
  });
  await auth.page.goto("/");

  await expect(auth.page.getByRole("button", { name: "Previous day" })).toHaveCount(0);
  await expect(auth.page.getByRole("link", { name: "Next day" })).toHaveCount(0);
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

});
