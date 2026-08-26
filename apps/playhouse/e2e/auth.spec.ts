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
