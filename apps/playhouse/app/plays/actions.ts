"use server";

import { revalidatePath } from "next/cache";

import {
  isUuid,
  parsePlayInput,
  type PlayInput,
} from "../../domain/play-input";
import type { PlayMutationState } from "../../domain/play-mutation";
import { createClient } from "../../lib/supabase/server";
import type { Database } from "../../lib/supabase/database.types";

function errorState(message: string, fieldErrors?: PlayMutationState["fieldErrors"]): PlayMutationState {
  return { fieldErrors, message, status: "error" };
}

async function authenticatedClient() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = typeof data?.claims?.sub === "string" ? data.claims.sub : null;

  if (error || !userId) {
    return null;
  }

  return { supabase, userId };
}

async function basketExists(
  supabase: Awaited<ReturnType<typeof createClient>>,
  basketId: string,
) {
  const { data, error } = await supabase
    .from("baskets")
    .select("id")
    .eq("id", basketId)
    .maybeSingle();
  return !error && Boolean(data);
}

function playValues(data: PlayInput) {
  return {
    basket_id: data.placement.kind === "basket" ? data.placement.basketId : null,
    branch: data.branch,
    duration_minutes: data.durationMinutes,
    note: data.note,
    place: data.place,
    play_type: data.playType,
    push_rule: data.pushRule,
    scheduled_date:
      data.placement.kind === "calendar" ? data.placement.scheduledDate : null,
    title: data.title,
    url: data.url,
  } satisfies Database["public"]["Tables"]["plays"]["Update"];
}

async function savePlayInternal(
  _previousState: PlayMutationState,
  formData: FormData,
): Promise<PlayMutationState> {
  const parsed = parsePlayInput(formData);
  if (!parsed.success) {
    return errorState("Check the highlighted fields and try again.", parsed.errors);
  }

  const auth = await authenticatedClient();
  if (!auth) {
    return errorState("Your session expired. Refresh the page and sign in again.");
  }

  if (
    parsed.data.placement.kind === "basket" &&
    !(await basketExists(auth.supabase, parsed.data.placement.basketId))
  ) {
    return errorState("That Basket is no longer available.", {
      basketId: "Choose one of your current Baskets.",
    });
  }

  const values = playValues(parsed.data);
  const playIdValue = formData.get("playId");
  const playId = typeof playIdValue === "string" ? playIdValue : "";

  if (playId) {
    if (!isUuid(playId)) {
      return errorState("This Play could not be identified. Refresh and try again.");
    }

    const { data, error } = await auth.supabase
      .from("plays")
      .update(values)
      .eq("id", playId)
      .eq("status", "open")
      .select("id")
      .maybeSingle();

    if (error || !data) {
      return errorState("This Play could not be updated. Refresh and try again.");
    }

    revalidatePath("/");
    return { message: "Play updated.", status: "success" };
  }

  const { error } = await auth.supabase.from("plays").insert({
    ...values,
    owner_user_id: auth.userId,
  });

  if (error) {
    return errorState("This Play could not be created. Please try again.");
  }

  revalidatePath("/");
  return { message: "Play created.", status: "success" };
}

export async function savePlay(
  previousState: PlayMutationState,
  formData: FormData,
): Promise<PlayMutationState> {
  try {
    return await savePlayInternal(previousState, formData);
  } catch {
    return errorState("PlayHouse could not save this Play. Please try again.");
  }
}

async function setPlayStatus(
  formData: FormData,
  status: "done" | "trash",
): Promise<PlayMutationState> {
  const playIdValue = formData.get("playId");
  const playId = typeof playIdValue === "string" ? playIdValue : "";
  if (!isUuid(playId)) {
    return errorState("This Play could not be identified. Refresh and try again.");
  }

  const auth = await authenticatedClient();
  if (!auth) {
    return errorState("Your session expired. Refresh the page and sign in again.");
  }

  const { data, error } = await auth.supabase
    .from("plays")
    .update({
      completed_at: status === "done" ? new Date().toISOString() : null,
      status,
    })
    .eq("id", playId)
    .eq("status", "open")
    .select("id")
    .maybeSingle();

  if (error || !data) {
    return errorState(
      status === "done"
        ? "This Play could not be marked done. Refresh and try again."
        : "This Play could not be moved to Trash. Refresh and try again.",
    );
  }

  revalidatePath("/");
  return {
    message: status === "done" ? "Play marked done." : "Play moved to Trash.",
    status: "success",
  };
}

export async function markPlayDone(
  _previousState: PlayMutationState,
  formData: FormData,
) {
  try {
    return await setPlayStatus(formData, "done");
  } catch {
    return errorState("PlayHouse could not finish this Play. Please try again.");
  }
}

export async function trashPlay(
  _previousState: PlayMutationState,
  formData: FormData,
) {
  try {
    return await setPlayStatus(formData, "trash");
  } catch {
    return errorState("PlayHouse could not move this Play to Trash. Please try again.");
  }
}
