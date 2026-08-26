import { expect, test } from "./fixtures";
import { createPlay, playRow } from "./support/playhouse";

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
