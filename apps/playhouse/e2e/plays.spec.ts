import type { Locator } from "@playwright/test";

import { expect, test } from "./fixtures";
import { createPlay, openCreatePlay, openEditPlay, playRow } from "./support/playhouse";

async function choosePlayer(
  form: Locator,
  query: string,
  displayName: string,
) {
  const input = form.getByRole("combobox", { name: "Player", exact: true });
  await input.fill(query);
  const option = form.getByRole("option", { name: new RegExp(displayName) });
  await expect(option).toBeVisible();
  await option.click();
  await expect(input).toHaveValue(displayName);
}

async function browserCalendarDate(page: Parameters<typeof playRow>[0]) {
  return page.evaluate(() => {
    const parts = new Intl.DateTimeFormat("en-CA", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).formatToParts(new Date());
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  });
}

test("new Play defaults Duration to 30 and Place to Office", async ({ auth }) => {
  await auth.page.goto("/");
  const form = await openCreatePlay(auth.page);

  await expect(form.getByLabel("Duration (minutes)")).toHaveValue("30");
  await expect(form.locator('select[name="place"]')).toHaveValue("office");
});

test("blank and HTTP(S) URL variants persist correctly", async ({ auth }) => {
  await auth.page.goto("/");
  const cases = [
    { entered: "", saved: null, title: "Blank URL" },
    { entered: "google.com", saved: "https://google.com", title: "Scheme-less URL" },
    { entered: "http://example.com/path", saved: "http://example.com/path", title: "HTTP URL" },
    {
      entered: "https://example.com/path",
      saved: "https://example.com/path",
      title: "HTTPS URL",
    },
  ];

  for (const item of cases) {
    await createPlay(auth.page, item.title, { url: item.entered });
  }

  const { data, error } = await auth.user
    .from("plays")
    .select("title, url")
    .eq("owner_user_id", auth.userId)
    .in("title", cases.map((item) => item.title));
  expect(error).toBeNull();
  expect(Object.fromEntries((data ?? []).map((play) => [play.title, play.url]))).toEqual(
    Object.fromEntries(cases.map((item) => [item.title, item.saved])),
  );
});

test("invalid Create stays open and preserves every entered value", async ({ auth }) => {
  await auth.page.goto("/");
  const form = await openCreatePlay(auth.page);
  await form.getByLabel("Title").fill("Preserve this Play");
  await form.getByLabel("URL").fill("/not-a-web-address");
  await form.getByLabel("Branch").fill("Regression");
  await form.getByLabel("Note").fill("Keep this note");
  await form.getByLabel("Duration (minutes)").fill("45");
  await choosePlayer(form, "Dav", auth.contacts[0].displayName);
  await form.getByLabel("Push").selectOption("weekdays");
  await form.locator('select[name="place"]').selectOption("outside");
  await form.getByRole("button", { name: "Create Play" }).click();

  await expect(auth.page.getByTestId("create-play")).toHaveAttribute("open", "");
  await expect(form.getByRole("alert")).toContainText("highlighted fields");
  await expect(form.getByLabel("Title")).toHaveValue("Preserve this Play");
  await expect(form.getByLabel("URL")).toHaveValue("/not-a-web-address");
  await expect(form.getByLabel("Branch")).toHaveValue("Regression");
  await expect(form.getByLabel("Note")).toHaveValue("Keep this note");
  await expect(form.getByLabel("Duration (minutes)")).toHaveValue("45");
  await expect(
    form.getByRole("combobox", { name: "Player", exact: true }),
  ).toHaveValue(auth.contacts[0].displayName);
  await expect(form.getByLabel("Push")).toHaveValue("weekdays");
  await expect(form.locator('select[name="place"]')).toHaveValue("outside");
});

test("successful Create closes, appears immediately, and updates count", async ({ auth }) => {
  await auth.page.goto("/");
  await expect(auth.page.getByTestId("play-count")).toHaveText("0 Plays");

  await createPlay(auth.page, "Immediately visible");

  await expect(auth.page.getByTestId("create-play")).not.toHaveAttribute("open", "");
  await expect(auth.page.getByTestId("play-count")).toHaveText("1 Play");
  await expect(playRow(auth.page, "Immediately visible")).toBeVisible();
});

test("Edit updates title and URL while preserving Duration and Place", async ({ auth }) => {
  await auth.page.goto("/");
  await createPlay(auth.page, "Before edit", { url: "example.com/original" });
  const compactRow = playRow(auth.page, "Before edit");
  await expect(compactRow.locator(".playRowLine")).toContainText("Normal");
  await expect(compactRow.locator(".playRowLine")).toContainText("30m");
  await expect(compactRow.locator(".playRowLine")).toContainText("office");
  await expect(
    compactRow.getByRole("button", { exact: true, name: "Done" }),
  ).toBeVisible();
  await expect(compactRow.getByRole("button", { name: "Trash" })).toBeVisible();
  const { form } = await openEditPlay(auth.page, "Before edit");

  await expect(form.getByLabel("Duration (minutes)")).toHaveValue("30");
  await expect(form.locator('select[name="place"]')).toHaveValue("office");
  await expect(form.getByLabel("URL")).toHaveValue("https://example.com/original");
  await form.getByLabel("Title").fill("After edit");
  await form.getByLabel("URL").fill("http://example.com/updated");
  await form.getByRole("button", { name: "Save changes" }).click();

  await expect(playRow(auth.page, "Before edit")).toHaveCount(0);
  const updatedRow = playRow(auth.page, "After edit");
  await expect(updatedRow).toBeVisible();
  await expect(updatedRow.getByTestId("edit-play")).not.toHaveAttribute("open", "");
  const { data, error } = await auth.user
    .from("plays")
    .select("duration_minutes, place, url")
    .eq("owner_user_id", auth.userId)
    .eq("title", "After edit")
    .single();
  expect(error).toBeNull();
  expect(data).toMatchObject({
    duration_minutes: 30,
    place: "office",
    url: "http://example.com/updated",
  });
});

test("Play moves date to Basket and Basket back to date", async ({ auth }) => {
  await auth.page.goto("/");
  await createPlay(auth.page, "Move both ways");
  let edit = await openEditPlay(auth.page, "Move both ways");
  await edit.form.locator('select[name="placementKind"]').selectOption("basket");
  await edit.form.locator('select[name="basketId"]').selectOption({ label: "Backlog" });
  await edit.form.getByRole("button", { name: "Save changes" }).click();
  await expect(playRow(auth.page, "Move both ways")).toHaveCount(0);

  await auth.page.getByRole("link", { name: "Backlog" }).click();
  await expect(playRow(auth.page, "Move both ways")).toBeVisible();
  edit = await openEditPlay(auth.page, "Move both ways");
  await edit.form.locator('select[name="placementKind"]').selectOption("calendar");
  await edit.form
    .getByLabel("Date", { exact: true })
    .fill(await browserCalendarDate(auth.page));
  await edit.form.getByRole("button", { name: "Save changes" }).click();
  await expect(playRow(auth.page, "Move both ways")).toHaveCount(0);

  await auth.page.getByRole("link", { name: "Today" }).click();
  await expect(playRow(auth.page, "Move both ways")).toBeVisible();
});

test("Play moved from Backlog to Today remains visible after refresh", async ({ auth }) => {
  await auth.page.goto("/?basket=backlog");
  await createPlay(auth.page, "Backlog to Today");

  const edit = await openEditPlay(auth.page, "Backlog to Today");
  await edit.form.locator('select[name="placementKind"]').selectOption("calendar");
  const today = await browserCalendarDate(auth.page);
  await edit.form.getByLabel("Date", { exact: true }).fill(today);
  await edit.form.getByRole("button", { name: "Save changes" }).click();

  await expect(playRow(auth.page, "Backlog to Today")).toHaveCount(0);
  const saved = await auth.user
    .from("plays")
    .select("basket_id, scheduled_date")
    .eq("owner_user_id", auth.userId)
    .eq("title", "Backlog to Today")
    .single();
  expect(saved.error).toBeNull();
  expect(saved.data).toEqual({ basket_id: null, scheduled_date: today });

  await auth.page.getByRole("link", { name: "Today" }).click();
  await expect(playRow(auth.page, "Backlog to Today")).toBeVisible();
  await auth.page.reload();
  await expect(playRow(auth.page, "Backlog to Today")).toBeVisible();
});

test("Player can be created, displayed, changed, and cleared", async ({ auth }) => {
  await auth.page.goto("/");
  const createForm = await openCreatePlay(auth.page);
  await createForm.getByLabel("Title").fill("Player lifecycle");
  await choosePlayer(createForm, "Dav", auth.contacts[0].displayName);
  await createForm.getByRole("button", { name: "Create Play" }).click();

  let row = playRow(auth.page, "Player lifecycle");
  await expect(row.getByTestId("play-player")).toHaveText(auth.contacts[0].displayName);
  let persistence = await auth.user
    .from("plays")
    .select("player_contact_id")
    .eq("owner_user_id", auth.userId)
    .eq("title", "Player lifecycle")
    .single();
  expect(persistence.error).toBeNull();
  expect(persistence.data?.player_contact_id).toBeTruthy();
  let cachedContact = await auth.user
    .from("contact_references")
    .select("display_name, provider_resource_name")
    .eq("id", persistence.data?.player_contact_id ?? "")
    .single();
  expect(cachedContact.error).toBeNull();
  expect(cachedContact.data).toMatchObject({
    display_name: auth.contacts[0].displayName,
    provider_resource_name: auth.contacts[0].resourceName,
  });

  let edit = await openEditPlay(auth.page, "Player lifecycle");
  await expect(
    edit.form.getByRole("combobox", { name: "Player", exact: true }),
  ).toHaveValue(auth.contacts[0].displayName);
  await choosePlayer(edit.form, "Bla", auth.contacts[1].displayName);
  await edit.form.getByRole("button", { name: "Save changes" }).click();

  row = playRow(auth.page, "Player lifecycle");
  await expect(row.getByTestId("play-player")).toHaveText(auth.contacts[1].displayName);
  persistence = await auth.user
    .from("plays")
    .select("player_contact_id")
    .eq("owner_user_id", auth.userId)
    .eq("title", "Player lifecycle")
    .single();
  expect(persistence.error).toBeNull();
  expect(persistence.data?.player_contact_id).toBeTruthy();
  cachedContact = await auth.user
    .from("contact_references")
    .select("display_name, provider_resource_name")
    .eq("id", persistence.data?.player_contact_id ?? "")
    .single();
  expect(cachedContact.error).toBeNull();
  expect(cachedContact.data).toMatchObject({
    display_name: auth.contacts[1].displayName,
    provider_resource_name: auth.contacts[1].resourceName,
  });

  edit = await openEditPlay(auth.page, "Player lifecycle");
  await edit.form.getByRole("button", { name: "Clear Player" }).click();
  await edit.form.getByRole("button", { name: "Save changes" }).click();

  row = playRow(auth.page, "Player lifecycle");
  await expect(row.getByTestId("play-player")).toHaveText("—");
  persistence = await auth.user
    .from("plays")
    .select("player_contact_id")
    .eq("owner_user_id", auth.userId)
    .eq("title", "Player lifecycle")
    .single();
  expect(persistence.error).toBeNull();
  expect(persistence.data?.player_contact_id).toBeNull();
});
