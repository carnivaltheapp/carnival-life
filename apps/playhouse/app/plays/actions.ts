"use server";

import { revalidatePath } from "next/cache";

import {
  isUuid,
  parsePlayInput,
  type PlayInput,
} from "../../domain/play-input";
import {
  parseNewNextPlayInput,
  validateNextRelationship,
} from "../../domain/next-play";
import {
  capturePlayMutationValues,
  type PlayMutationState,
} from "../../domain/play-mutation";
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
    player_contact_id: data.playerContactId,
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

  if (parsed.data.playerContactId) {
    const { data: contact, error: contactError } = await auth.supabase
      .from("contact_references")
      .select("id")
      .eq("id", parsed.data.playerContactId)
      .eq("owner_user_id", auth.userId)
      .maybeSingle();

    if (contactError || !contact) {
      return errorState("That Player is no longer available.", {
        playerContactId: "Choose one of your current Players.",
      });
    }
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
  const values = capturePlayMutationValues(formData);

  try {
    const result = await savePlayInternal(previousState, formData);
    return result.status === "error" ? { ...result, values } : result;
  } catch {
    return {
      ...errorState("PlayHouse could not save this Play. Please try again."),
      values,
    };
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

export async function setNextPlay(
  _previousState: PlayMutationState,
  formData: FormData,
): Promise<PlayMutationState> {
  try {
    const fromPlayValue = formData.get("fromPlayId");
    const toPlayValue = formData.get("nextPlayId");
    const fromPlayId = typeof fromPlayValue === "string" ? fromPlayValue : "";
    const toPlayId = typeof toPlayValue === "string" && toPlayValue ? toPlayValue : null;

    if (!isUuid(fromPlayId) || (toPlayId !== null && !isUuid(toPlayId))) {
      return errorState("The next Play selection is invalid. Refresh and try again.");
    }

    const auth = await authenticatedClient();
    if (!auth) {
      return errorState("Your session expired. Refresh the page and sign in again.");
    }

    const { data: relationshipRows, error: relationshipError } = await auth.supabase
      .from("play_relationships")
      .select("from_play_id, to_play_id")
      .eq("relationship_type", "next");

    if (relationshipError) {
      return errorState("PlayHouse could not validate this relationship. Please try again.");
    }

    const validation = validateNextRelationship({
      edges: (relationshipRows ?? []).map((relationship) => ({
        fromPlayId: relationship.from_play_id,
        toPlayId: relationship.to_play_id,
      })),
      fromPlayId,
      toPlayId,
    });

    if (!validation.valid) {
      return errorState(validation.message);
    }
    if (validation.status === "unchanged") {
      return { message: "Next Play is unchanged.", status: "success" };
    }

    const { error } = await auth.supabase.rpc("set_next_play", {
      p_from_play_id: fromPlayId,
      p_to_play_id: toPlayId,
    });

    if (error) {
      return errorState(
        error.message.toLowerCase().includes("cycle")
          ? "That relationship would create a cycle."
          : "This next Play relationship could not be saved. Please try again.",
      );
    }

    revalidatePath("/");
    return {
      message: validation.status === "removed" ? "Next Play removed." : "Next Play saved.",
      status: "success",
    };
  } catch {
    return errorState("PlayHouse could not save this relationship. Please try again.");
  }
}

async function destinationForNextPlay(
  supabase: Awaited<ReturnType<typeof createClient>>,
  result: {
    next_basket_id: string | null;
    next_scheduled_date: string | null;
  },
) {
  if (result.next_basket_id) {
    const { data } = await supabase
      .from("baskets")
      .select("slug")
      .eq("id", result.next_basket_id)
      .maybeSingle();
    if (data?.slug) {
      return `/?basket=${encodeURIComponent(data.slug)}`;
    }
  }

  return result.next_scheduled_date
    ? `/?date=${encodeURIComponent(result.next_scheduled_date)}`
    : "/";
}

export async function doneCreate(
  _previousState: PlayMutationState,
  formData: FormData,
): Promise<PlayMutationState> {
  try {
    const playIdValue = formData.get("playId");
    const playId = typeof playIdValue === "string" ? playIdValue : "";
    const modeValue = formData.get("doneCreateMode");
    const mode = typeof modeValue === "string" ? modeValue : "";

    if (!isUuid(playId) || (mode !== "existing" && mode !== "new")) {
      return errorState("This Done/Create request is invalid. Refresh and try again.");
    }

    const auth = await authenticatedClient();
    if (!auth) {
      return errorState("Your session expired. Refresh the page and sign in again.");
    }

    let workflowResult:
      | {
          next_basket_id: string | null;
          next_play_id: string;
          next_scheduled_date: string | null;
        }
      | undefined;

    if (mode === "existing") {
      const { data, error } = await auth.supabase.rpc("done_create_existing", {
        p_play_id: playId,
      });
      if (error || !data?.[0]) {
        return errorState("The linked next Play could not be activated. Refresh and try again.");
      }
      workflowResult = data[0];
    } else {
      const parsed = parseNewNextPlayInput(formData);
      if (!parsed.success) {
        return errorState("Check the next Play details and try again.", parsed.errors);
      }

      if (
        parsed.data.placement.kind === "basket" &&
        !(await basketExists(auth.supabase, parsed.data.placement.basketId))
      ) {
        return errorState("That Basket is no longer available.", {
          basketId: "Choose one of your current Baskets.",
        });
      }

      const { data, error } = await auth.supabase.rpc("done_create_new", {
        p_basket_id:
          parsed.data.placement.kind === "basket" ? parsed.data.placement.basketId : null,
        p_play_id: playId,
        p_play_type: parsed.data.playType,
        p_scheduled_date:
          parsed.data.placement.kind === "calendar"
            ? parsed.data.placement.scheduledDate
            : null,
        p_title: parsed.data.title,
      });
      if (error || !data?.[0]) {
        return errorState("The next Play could not be created. Refresh and try again.");
      }
      workflowResult = data[0];
    }

    return {
      message: mode === "new" ? "Next Play created." : "Next Play activated.",
      redirectTo: await destinationForNextPlay(auth.supabase, workflowResult),
      status: "success",
    };
  } catch {
    return errorState("PlayHouse could not complete Done/Create. Please try again.");
  }
}
