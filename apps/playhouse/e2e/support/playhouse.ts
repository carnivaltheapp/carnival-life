import { expect, type Locator, type Page } from "@playwright/test";

export function playRow(page: Page, title: string): Locator {
  return page.getByTestId("play-row").filter({
    has: page.locator(".playCopy strong", { hasText: title }),
  });
}

export async function openCreatePlay(page: Page) {
  const disclosure = page.getByTestId("create-play");
  await disclosure.getByText("+ New Play", { exact: true }).click();
  await expect(disclosure).toHaveAttribute("open", "");
  return disclosure.locator("form.playForm");
}

export async function openEditPlay(page: Page, title: string) {
  const row = playRow(page, title);
  const disclosure = row.getByTestId("edit-play");
  await disclosure.getByText("Edit", { exact: true }).click();
  await expect(disclosure).toHaveAttribute("open", "");
  return { disclosure, form: disclosure.locator("form.playForm"), row };
}

export async function createPlay(
  page: Page,
  title: string,
  options: { basket?: string; url?: string } = {},
) {
  const form = await openCreatePlay(page);
  await form.getByLabel("Title").fill(title);
  if (options.url !== undefined) {
    await form.getByLabel("URL").fill(options.url);
  }
  if (options.basket) {
    await form.getByLabel("Placement").selectOption("basket");
    await form.getByLabel("Basket").selectOption({ label: options.basket });
  }
  await form.getByRole("button", { name: "Create Play" }).click();
  await expect(page.getByTestId("create-play")).not.toHaveAttribute("open", "");
  await expect(playRow(page, title)).toBeVisible();
}
