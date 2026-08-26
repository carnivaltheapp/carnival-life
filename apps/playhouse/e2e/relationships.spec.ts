import { expect, test } from "./fixtures";
import { createPlay, openEditPlay, playRow } from "./support/playhouse";

async function setNextPlay(
  page: Parameters<typeof openEditPlay>[0],
  fromTitle: string,
  toTitle: string,
) {
  const edit = await openEditPlay(page, fromTitle);
  const relationship = edit.disclosure.locator("form.relationshipForm");
  await relationship.getByLabel("Next Play").selectOption({ label: toTitle });
  await relationship.getByRole("button", { name: "Save next Play" }).click();
  return { edit, relationship };
}

test("A to B relationship supports Done / Continue navigation", async ({ auth }) => {
  await auth.page.goto("/");
  await createPlay(auth.page, "Relationship A");
  await createPlay(auth.page, "Relationship B");
  const { relationship } = await setNextPlay(
    auth.page,
    "Relationship A",
    "Relationship B",
  );
  await expect(relationship.getByRole("status")).toContainText("Next Play saved");
  await auth.page.reload();

  const rowA = playRow(auth.page, "Relationship A");
  await expect(rowA.getByRole("button", { name: "Done / Continue" })).toBeVisible();
  await rowA.getByRole("button", { name: "Done / Continue" }).click();
  await expect(auth.page).toHaveURL(/\?date=\d{4}-\d{2}-\d{2}/);
  await expect(playRow(auth.page, "Relationship A")).toHaveCount(0);
  await expect(playRow(auth.page, "Relationship B")).toBeVisible();
});

test("Done / Create next creates and links a new Play", async ({ auth }) => {
  await auth.page.goto("/");
  await createPlay(auth.page, "Create a next Play");
  const row = playRow(auth.page, "Create a next Play");
  const disclosure = row.locator("details.doneCreateDisclosure");
  await disclosure.getByText("Done / Create next", { exact: true }).click();
  const form = disclosure.locator("form.doneCreateForm");
  await form.getByLabel("Next Play title").fill("Created next Play");
  await form.getByRole("button", { name: "Complete and create next" }).click();

  await expect(playRow(auth.page, "Create a next Play")).toHaveCount(0);
  await expect(playRow(auth.page, "Created next Play")).toBeVisible();
  const { data: plays } = await auth.user
    .from("plays")
    .select("id, title")
    .eq("owner_user_id", auth.userId)
    .in("title", ["Create a next Play", "Created next Play"]);
  const ids = Object.fromEntries((plays ?? []).map((play) => [play.title, play.id]));
  const { data: relationship, error } = await auth.user
    .from("play_relationships")
    .select("from_play_id, to_play_id")
    .eq("owner_user_id", auth.userId)
    .single();
  expect(error).toBeNull();
  expect(relationship).toEqual({
    from_play_id: ids["Create a next Play"],
    to_play_id: ids["Created next Play"],
  });
});

test("obvious next-Play cycle is rejected", async ({ auth }) => {
  await auth.page.goto("/");
  await createPlay(auth.page, "Cycle A");
  await createPlay(auth.page, "Cycle B");
  const first = await setNextPlay(auth.page, "Cycle A", "Cycle B");
  await expect(first.relationship.getByRole("status")).toContainText("Next Play saved");
  await auth.page.reload();

  const second = await setNextPlay(auth.page, "Cycle B", "Cycle A");
  await expect(second.relationship.getByRole("alert")).toContainText("cycle");
});
