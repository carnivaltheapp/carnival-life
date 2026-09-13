import { expect, test } from "./fixtures";
import { createPlay, playRow } from "./support/playhouse";

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

test("Done and Trash remove Plays from open view without deleting rows", async ({ auth }) => {
  await auth.page.goto("/");
  await createPlay(auth.page, "Finish me");
  await createPlay(auth.page, "Trash me");

  await playRow(auth.page, "Finish me")
    .getByRole("button", { exact: true, name: "Done" })
    .click();
  await expect(playRow(auth.page, "Finish me")).toHaveCount(0);
  await playRow(auth.page, "Trash me").getByRole("button", { name: "Trash" }).click();
  await expect(playRow(auth.page, "Trash me")).toHaveCount(0);
  await expect(auth.page.getByTestId("play-count")).toHaveText("0 Plays");

  const { data, error } = await auth.user
    .from("plays")
    .select("status, title")
    .eq("owner_user_id", auth.userId)
    .in("title", ["Finish me", "Trash me"]);
  expect(error).toBeNull();
  expect(Object.fromEntries((data ?? []).map((play) => [play.title, play.status]))).toEqual({
    "Finish me": "done",
    "Trash me": "trash",
  });
});

test("Gmail-linked Done and Trash persist before exact-thread unstar sync", async ({ auth }) => {
  const today = await browserCalendarDate(auth.page);
  const { error } = await auth.user.from("plays").insert([
    {
      owner_user_id: auth.userId,
      scheduled_date: today,
      source_metadata: {
        external_ids: { thread_id: "FMdone" },
        gmail_attachment: { account_index: 2, thread_ref: "FMdone" },
      },
      source_type: "gmail",
      title: "Gmail Done",
    },
    {
      owner_user_id: auth.userId,
      scheduled_date: today,
      source_metadata: {
        external_ids: { thread_id: "FMtrash" },
        gmail_attachment: { account_index: 2, thread_ref: "FMtrash" },
      },
      source_type: "gmail",
      title: "Gmail Trash",
    },
  ]);
  expect(error).toBeNull();
  await auth.page.goto("/");
  await auth.page.evaluate(() => {
    window.addEventListener("carnival:gmail-unstar-thread", (event) => {
      const requests = JSON.parse(sessionStorage.getItem("gmail-unstar-requests") ?? "[]");
      requests.push(JSON.parse((event as CustomEvent<string>).detail));
      sessionStorage.setItem("gmail-unstar-requests", JSON.stringify(requests));
    });
  });

  await playRow(auth.page, "Gmail Done").getByRole("button", { name: "Done" }).click();
  await expect(playRow(auth.page, "Gmail Done")).toHaveCount(0);
  await playRow(auth.page, "Gmail Trash").getByRole("button", { name: "Trash" }).click();
  await expect(playRow(auth.page, "Gmail Trash")).toHaveCount(0);

  await expect.poll(() => auth.page.evaluate(
    () => JSON.parse(sessionStorage.getItem("gmail-unstar-requests") ?? "[]")
      .map(({ action, threadRef }: { action: string; threadRef: string }) => ({ action, threadRef })),
  )).toEqual([
    { action: "done", threadRef: "FMdone" },
    { action: "trash", threadRef: "FMtrash" },
  ]);
  const { data } = await auth.user
    .from("plays")
    .select("status, title")
    .eq("owner_user_id", auth.userId)
    .in("title", ["Gmail Done", "Gmail Trash"]);
  expect(Object.fromEntries((data ?? []).map((play) => [play.title, play.status]))).toEqual({
    "Gmail Done": "done",
    "Gmail Trash": "trash",
  });

  await auth.page.evaluate(() => window.dispatchEvent(new CustomEvent(
    "carnival:gmail-unstar-result",
    { detail: JSON.stringify({ action: "trash", ok: false, playId: "test" }) },
  )));
  await expect(auth.page.getByText("Play trashed. Gmail sync could not be completed."))
    .toBeVisible();
});
