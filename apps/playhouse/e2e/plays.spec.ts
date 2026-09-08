import type { Locator } from "@playwright/test";

import { expect, test } from "./fixtures";
import { GRID_FONT_SIZE_STORAGE_KEY } from "../domain/grid-font-size";
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

function addIsoDays(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
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

test("multi-select does not insert a selection summary row", async ({ auth }) => {
  await auth.page.goto("/");
  await createPlay(auth.page, "First selected Play");
  await createPlay(auth.page, "Second selected Play");
  const header = auth.page.locator(".playGridHeader");
  const initialTop = (await header.boundingBox())?.y;
  const firstSelect = playRow(auth.page, "First selected Play").locator(".playSelectControl");
  const secondSelect = playRow(auth.page, "Second selected Play").locator(".playSelectControl");

  await firstSelect.click();
  await expect(firstSelect).toHaveAttribute("aria-pressed", "true");
  await secondSelect.click();
  await expect(secondSelect).toHaveAttribute("aria-pressed", "true");
  await expect(auth.page.locator(".selectionPanelHeader")).toHaveCount(0);
  await expect(auth.page.getByText(/\d+ selected/)).toHaveCount(0);
  await expect(auth.page.getByRole("button", { name: "Clear Selection" })).toHaveCount(0);
  expect((await header.boundingBox())?.y).toBe(initialTop);

  await firstSelect.click();
  await expect(firstSelect).toHaveAttribute("aria-pressed", "false");
  await expect(secondSelect).toHaveAttribute("aria-pressed", "true");
});

test("Edit updates title and URL while preserving Duration and Place", async ({ auth }) => {
  await auth.page.goto("/");
  await createPlay(auth.page, "Before edit", { url: "example.com/original" });
  const compactRow = playRow(auth.page, "Before edit");
  await expect(compactRow.locator(".playTypeMarker--headline")).toBeVisible();
  await expect(compactRow.locator(".playRowLine")).not.toContainText("30m");
  await expect(compactRow.locator(".playRowLine")).not.toContainText("office");
  await expect(
    compactRow.getByRole("button", { exact: true, name: "Done" }),
  ).toBeVisible();
  await expect(compactRow.getByRole("button", { name: "Trash" })).toBeVisible();
  await expect(compactRow.getByRole("button", { name: "Play information" })).toHaveCount(0);
  await expect(compactRow.locator(".statusActions > *")).toHaveCount(4);
  await expect(compactRow.getByRole("link", { name: "Open Play URL" })).toHaveAttribute(
    "href",
    "https://example.com/original",
  );
  const gridHeader = auth.page.locator(".playGridHeader");
  await expect(gridHeader.getByText("Assignee", { exact: true })).toBeVisible();
  await expect(gridHeader.getByText("Description", { exact: true })).toBeVisible();
  await expect(gridHeader.getByText("Branch", { exact: true })).toBeVisible();
  await expect(gridHeader.getByRole("columnheader", { name: "Done" })).toBeVisible();
  await expect(gridHeader.getByRole("columnheader", { name: "Trash" })).toBeVisible();
  await expect(gridHeader.getByRole("columnheader", { name: "Gmail" })).toBeVisible();
  await expect(gridHeader.getByRole("columnheader", { name: "URL" })).toBeVisible();
  expect(await gridHeader.evaluate((header) => getComputedStyle(header).gridTemplateColumns))
    .toBe(await compactRow.locator(".playRowLine").evaluate(
      (row) => getComputedStyle(row).gridTemplateColumns,
    ));
  const { disclosure, form } = await openEditPlay(auth.page, "Before edit");

  const infoButton = disclosure.getByRole("button", { name: "Play information" });
  await expect(infoButton).toBeVisible();
  expect(await infoButton.evaluate((button) =>
    button.previousElementSibling?.getAttribute("data-testid")
  )).toBe("play-title");
  await infoButton.click();
  const infoDialog = disclosure.locator(".playInfoDialog");
  await expect(infoDialog).toBeVisible();
  await expect(infoDialog.locator("pre")).toContainText('"title": "Before edit"');
  await expect(infoDialog.getByRole("button", { name: "Copy" })).toBeVisible();
  await infoDialog.getByRole("button", { name: "Close Play information" }).click();

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

test("Edit popup is compact on desktop and viewport-safe on mobile", async ({ auth }) => {
  await auth.page.goto("/");
  await createPlay(auth.page, "Responsive edit popup", {
    url: "https://example.com/a/very/long/path/that/must/not/widen/the-dialog",
  });
  const { disclosure, form } = await openEditPlay(auth.page, "Responsive edit popup");

  const desktopBox = await disclosure.boundingBox();
  expect(desktopBox?.width).toBeLessThanOrEqual(322);
  await expect(form.getByLabel("Title")).toHaveCSS("min-height", "31px");

  await auth.page.setViewportSize({ height: 700, width: 390 });
  const mobileBox = await disclosure.boundingBox();
  expect(mobileBox).not.toBeNull();
  expect(mobileBox!.x).toBeGreaterThanOrEqual(11);
  expect(mobileBox!.x + mobileBox!.width).toBeLessThanOrEqual(379);
  expect(mobileBox!.y).toBeGreaterThanOrEqual(11);
  expect(mobileBox!.height).toBeLessThanOrEqual(678);
  expect(await disclosure.evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth)).toBe(true);
  await form.getByRole("button", { name: "Save changes" }).scrollIntoViewIfNeeded();
  await expect(form.getByRole("button", { name: "Save changes" })).toBeInViewport();
});

test("Play moves date to Basket and Basket back to date", async ({ auth }) => {
  await auth.page.goto("/");
  await createPlay(auth.page, "Move both ways");
  let edit = await openEditPlay(auth.page, "Move both ways");
  await edit.form.locator('select[name="placementKind"]').selectOption("basket");
  await edit.form.locator('select[name="basketId"]').selectOption({ label: "Backlog" });
  await edit.form.getByRole("button", { name: "Save changes" }).click();
  await expect(playRow(auth.page, "Move both ways")).toHaveCount(0);

  await auth.page.getByRole("button", { name: "Baskets" }).click();
  await auth.page.getByRole("link", { name: "Backlog" }).click();
  await expect(playRow(auth.page, "Move both ways")).toBeVisible();
  edit = await openEditPlay(auth.page, "Move both ways");
  await edit.form.locator('select[name="placementKind"]').selectOption("calendar");
  await edit.form
    .getByLabel("Date", { exact: true })
    .fill(await browserCalendarDate(auth.page));
  await edit.form.getByRole("button", { name: "Save changes" }).click();
  await expect(playRow(auth.page, "Move both ways")).toHaveCount(0);

  await auth.page.getByRole("button", { name: "Calendar" }).click();
  await auth.page.getByRole("link", { name: /^Today / }).click();
  await expect(playRow(auth.page, "Move both ways")).toBeVisible();
});

test("full-row drag uses a row preview while controls remain non-draggable", async ({ auth }) => {
  await auth.page.addInitScript(() => {
    const nativeSetDragImage = DataTransfer.prototype.setDragImage;
    DataTransfer.prototype.setDragImage = function setDragImage(image, x, y) {
      sessionStorage.setItem("playhouse-drag-preview", JSON.stringify({
        columns: getComputedStyle(image.querySelector(".playRowLine")!).gridTemplateColumns,
        fontSize: getComputedStyle(image).fontSize,
        fontWeight: getComputedStyle(image).fontWeight,
        height: (image as HTMLElement).offsetHeight,
        lineHeight: getComputedStyle(image).lineHeight,
        opacity: getComputedStyle(image).opacity,
        text: image.textContent,
        width: (image as HTMLElement).offsetWidth,
        x,
        y,
      }));
      nativeSetDragImage.call(this, image, x, y);
    };
  });
  await auth.page.goto("/");
  await auth.page.evaluate(
    (storageKey) => localStorage.setItem(storageKey, "16"),
    GRID_FONT_SIZE_STORAGE_KEY,
  );
  await auth.page.reload();
  await createPlay(auth.page, "First drag target");
  await createPlay(auth.page, "Second draggable Play", { url: "https://example.com" });

  const first = playRow(auth.page, "First drag target");
  const second = playRow(auth.page, "Second draggable Play");
  const source = await second.evaluate((row) => ({
    columns: getComputedStyle(row.querySelector(".playRowLine")!).gridTemplateColumns,
    fontSize: getComputedStyle(row).fontSize,
    fontWeight: getComputedStyle(row).fontWeight,
    height: (row as HTMLElement).offsetHeight,
    lineHeight: getComputedStyle(row).lineHeight,
    width: (row as HTMLElement).offsetWidth,
  }));
  await expect(second).toHaveAttribute("draggable", "true");
  await second.getByTestId("play-title").dragTo(first);

  await expect(auth.page.getByTestId("play-title").first()).toContainText(
    "Second draggable Play",
    { timeout: 500 },
  );
  const preview = await auth.page.evaluate(() =>
    JSON.parse(sessionStorage.getItem("playhouse-drag-preview") ?? "null") as {
      columns: string;
      fontSize: string;
      fontWeight: string;
      height: number;
      lineHeight: string;
      opacity: string;
      text: string;
      width: number;
    } | null
  );
  expect(preview).toMatchObject({ opacity: "0.82" });
  expect(preview?.text).toContain("Second draggable Play");
  expect(preview).toMatchObject({
    columns: source.columns,
    fontSize: source.fontSize,
    fontWeight: source.fontWeight,
    height: source.height,
    lineHeight: source.lineHeight,
    width: source.width,
  });

  for (const control of [
    second.getByRole("button", { name: /Select .* Play/ }),
    second.getByRole("button", { name: "Done" }),
    second.getByRole("button", { name: "Trash" }),
    second.getByRole("link", { name: "Open Play URL" }),
  ]) {
    expect(await control.evaluate((element) => {
      element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      const drag = new DragEvent("dragstart", {
        bubbles: true,
        cancelable: true,
        dataTransfer: new DataTransfer(),
      });
      element.dispatchEvent(drag);
      return drag.defaultPrevented;
    })).toBe(true);
  }

  await auth.page.reload();
  await expect(auth.page.getByTestId("play-title").first()).toContainText(
    "Second draggable Play",
  );
});

test("global search shows standard rows and clearing restores the current view", async ({ auth }) => {
  await auth.page.goto("/?view=today");
  await createPlay(auth.page, "Unique search contract");
  const search = auth.page.getByRole("searchbox", { name: "Search Plays" });
  await search.fill("search contract");

  await expect(auth.page.getByRole("heading", { name: "Search Results" })).toBeVisible();
  const result = playRow(auth.page, "Unique search contract");
  await expect(result).toBeVisible();
  await expect(result.getByTestId("play-destination")).toBeVisible();
  await expect(result.getByRole("button", { name: "Done" })).toBeVisible();
  await expect(result.getByRole("button", { name: "Trash" })).toBeVisible();
  await expect(result.getByRole("button", { name: "Play information" })).toHaveCount(0);
  await expect(result.locator(".playTypeMarker--headline")).toBeVisible();

  await search.fill("no matching play text");
  await expect(auth.page.getByRole("heading", { name: "No Plays found" })).toBeVisible();
  await auth.page.getByRole("button", { name: "Clear Play search" }).click();
  await expect(auth.page.locator(".headerViewTitle")).not.toHaveText("Search Results");
  await expect(playRow(auth.page, "Unique search contract")).toBeVisible();
});

test("Headline to Reminder requires a future date and Cancel makes no change", async ({ auth }) => {
  await auth.page.goto("/");
  await createPlay(auth.page, "Reminder date candidate");
  const today = await browserCalendarDate(auth.page);
  const futureDate = addIsoDays(today, 4);
  const { form } = await openEditPlay(auth.page, "Reminder date candidate");

  await form.getByLabel("Type").selectOption("reminder");
  let prompt = auth.page.getByRole("dialog", { name: "Reminder Date" });
  await expect(prompt).toBeVisible();
  await prompt.getByRole("button", { name: "Cancel" }).click();
  await expect(prompt).toHaveCount(0);
  await expect(form.getByLabel("Type")).toHaveValue("normal");
  const { data: unchanged } = await auth.user
    .from("plays")
    .select("play_type")
    .eq("owner_user_id", auth.userId)
    .eq("title", "Reminder date candidate")
    .single();
  expect(unchanged?.play_type).toBe("normal");

  await form.getByLabel("Type").selectOption("reminder");
  prompt = auth.page.getByRole("dialog", { name: "Reminder Date" });
  await prompt.getByLabel("Reminder Date").fill(today);
  await prompt.getByRole("button", { name: "Set Reminder" }).click();
  await expect(prompt.getByRole("alert")).toContainText("after today");
  await prompt.getByLabel("Reminder Date").fill(futureDate);
  await prompt.getByRole("button", { name: "Set Reminder" }).click();

  await expect(prompt).toHaveCount(0);
  await expect(form.getByLabel("Type")).toHaveValue("reminder");
  await expect(form.getByLabel("Date")).toHaveValue(futureDate);
  await form.getByRole("button", { name: "Save changes" }).click();
  await expect(auth.page.getByTestId("edit-play").filter({
    has: auth.page.getByText("Reminder date candidate", { exact: true }),
  })).toHaveCount(0);

  const { data: saved, error } = await auth.user
    .from("plays")
    .select("duration_minutes, play_type, scheduled_date")
    .eq("owner_user_id", auth.userId)
    .eq("title", "Reminder date candidate")
    .single();
  expect(error).toBeNull();
  expect(saved).toMatchObject({
    duration_minutes: 30,
    play_type: "reminder",
    scheduled_date: futureDate,
  });
  await auth.page.goto(`/?date=${futureDate}`);
  const reminderRow = playRow(auth.page, "Reminder date candidate");
  await expect(reminderRow).toBeVisible();
  await expect(reminderRow.locator(".playTypeMarker--reminder")).toBeVisible();
});

test("grid font setting updates immediately and persists locally", async ({ auth }) => {
  await auth.page.goto("/");
  await auth.page.evaluate(
    (storageKey) => localStorage.setItem(storageKey, "invalid"),
    GRID_FONT_SIZE_STORAGE_KEY,
  );
  await auth.page.reload();
  await createPlay(auth.page, "Resizable grid Play");

  const row = playRow(auth.page, "Resizable grid Play");
  await auth.page.getByRole("button", { name: "User menu" }).click();
  const settingsButton = auth.page.getByRole("button", { name: "Settings" });
  await expect(row).toHaveCSS("font-size", "12px");
  await expect(row.getByTestId("play-title")).toHaveCSS("font-size", "12px");
  await expect(row.locator(".playDataCell").first()).toHaveCSS("font-size", "12px");

  await settingsButton.click();
  const menu = auth.page.getByRole("dialog", { name: "Settings menu" });
  await expect(menu.getByText("Font Size", { exact: true })).toHaveCount(1);
  await expect(menu.locator(".fontSizeSetting").getByRole("button")).toHaveCount(2);
  await menu.getByRole("button", { name: "Increase font size" }).click();
  await expect(row).toHaveCSS("font-size", "13px");
  await expect(row.getByTestId("play-title")).toHaveCSS("font-size", "13px");
  await expect(row.locator(".playDataCell").first()).toHaveCSS("font-size", "13px");
  expect(await auth.page.evaluate(
    (storageKey) => localStorage.getItem(storageKey),
    GRID_FONT_SIZE_STORAGE_KEY,
  )).toBe("13");
  await expect(row.getByRole("button", { exact: true, name: "Done" })).toBeVisible();
  await expect(row.getByRole("button", { name: "Trash" })).toBeVisible();
  await expect(row.getByRole("button", { name: "Play information" })).toHaveCount(0);
  await expect(row.locator(".statusActions > *")).toHaveCount(4);

  await auth.page.reload();
  await expect(playRow(auth.page, "Resizable grid Play")).toHaveCSS("font-size", "13px");
  await auth.page.getByRole("button", { name: "User menu" }).click();
  await auth.page.getByRole("button", { name: "Settings" }).click();
  await auth.page.getByRole("button", { name: "Decrease font size" }).click();
  const restoredRow = playRow(auth.page, "Resizable grid Play");
  const description = restoredRow.getByTestId("play-title");
  await expect(restoredRow).toHaveCSS("font-size", "12px");
  await expect(description).toHaveCSS("font-size", "12px");
  await expect(restoredRow.locator(".playDataCell").first()).toHaveCSS("font-size", "12px");
  await expect(description).toHaveCSS("font-weight", "500");
  await expect(description).toHaveCSS("white-space", "nowrap");
  await expect(description).toHaveCSS("text-overflow", "ellipsis");
  await description.click();
  await expect(restoredRow.getByTestId("edit-play")).toHaveAttribute("open", "");
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

  await auth.page.getByRole("button", { name: "Calendar" }).click();
  await auth.page.getByRole("link", { name: /^Today / }).click();
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
  await expect(row.getByTestId("play-player")).toHaveCount(0);
  persistence = await auth.user
    .from("plays")
    .select("player_contact_id")
    .eq("owner_user_id", auth.userId)
    .eq("title", "Player lifecycle")
    .single();
  expect(persistence.error).toBeNull();
  expect(persistence.data?.player_contact_id).toBeNull();
});
