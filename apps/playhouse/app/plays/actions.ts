"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

import { isIsoCalendarDate, isUuid, parsePlayInput } from "../../domain/play-input";
import {
  parseNewNextPlayInput,
  validateNextRelationship,
} from "../../domain/next-play";
import {
  capturePlayMutationValues,
  type PlayMutationState,
} from "../../domain/play-mutation";
import type { BasketSummary } from "../../domain/play";
import type { PlayPlacement } from "../../domain/play";
import { isBulkSelectablePlay, type BulkPlayChange } from "../../domain/play-bulk-change";
import {
  parseGmailAttachmentUrl,
  sanitizeGmailParticipants,
} from "../../domain/gmail-attachment";
import { reminderContextDate } from "../../domain/reminder";
import { resolveGmailAssigneeForParticipants } from "../../lib/google/gmail-assignee.server";
import { applyPlayLifecycle } from "../../lib/google/gmail-lifecycle";
import { unstarGmailPlayThread } from "../../lib/google/gmail-lifecycle.server";
import { resolvePlayhouseDataSource } from "../../lib/playhouse/data-source";
import { dateInTimeZone } from "../../lib/playhouse/data";
import { createPlayRepository } from "../../lib/playhouse/play-repository";
import {
  BROWSER_TIME_ZONE_COOKIE,
  resolveTimeZone,
} from "../../lib/playhouse/time-zone";
import { createClient } from "../../lib/supabase/server";

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

  return {
    email: typeof data?.claims?.email === "string" ? data.claims.email : null,
    supabase,
    userId,
  };
}

async function loadBaskets(
  supabase: Awaited<ReturnType<typeof createClient>>,
) {
  const { data, error } = await supabase
    .from("baskets")
    .select("id, name, slug, sort_order")
    .order("sort_order", { ascending: true });
  if (error) return null;
  return (data ?? []).map((basket) => ({
    id: basket.id,
    name: basket.name,
    slug: basket.slug,
    sortOrder: basket.sort_order,
  })) satisfies BasketSummary[];
}

async function savePlayInternal(
  _previousState: PlayMutationState,
  formData: FormData,
): Promise<PlayMutationState> {
  const initialParse = parsePlayInput(formData);
  if (!initialParse.success) {
    return errorState("Check the highlighted fields and try again.", initialParse.errors);
  }

  const auth = await authenticatedClient();
  if (!auth) {
    return errorState("Your session expired. Refresh the page and sign in again.");
  }

  const [{ data: profile }, cookieStore] = await Promise.all([
    auth.supabase.from("users").select("timezone").maybeSingle(),
    cookies(),
  ]);
  const todayDate = dateInTimeZone(
    new Date(),
    resolveTimeZone(
      cookieStore.get(BROWSER_TIME_ZONE_COOKIE)?.value,
      profile?.timezone,
    ),
  );
  const submittedReminderContext = formData.get("reminderContextDate");
  const minimumReminderDate = reminderContextDate({
    displayedDate: typeof submittedReminderContext === "string"
      ? submittedReminderContext
      : null,
    todayDate,
  });
  const parsed = parsePlayInput(formData, { minimumReminderDate });
  if (!parsed.success) {
    return errorState("Check the highlighted fields and try again.", parsed.errors);
  }

  const baskets = await loadBaskets(auth.supabase);
  if (!baskets) {
    return errorState("Your Baskets could not be loaded. Refresh and try again.");
  }

  if (
    parsed.data.placement.kind === "basket" &&
    !baskets.some((basket) => basket.id === (
      parsed.data.placement.kind === "basket" ? parsed.data.placement.basketId : ""
    ))
  ) {
    return errorState("That Basket is no longer available.", {
      basketId: "Choose one of your current Baskets.",
    });
  }

  let playerResourceName: string | null = null;
  if (parsed.data.playerContactId) {
    const { data: contact, error: contactError } = await auth.supabase
      .from("contact_references")
      .select("id, provider_resource_name")
      .eq("id", parsed.data.playerContactId)
      .eq("owner_user_id", auth.userId)
      .maybeSingle();

    if (contactError || !contact) {
      return errorState("That Player is no longer available.", {
        playerContactId: "Choose one of your current Players.",
      });
    }
    playerResourceName = contact.provider_resource_name;
  }

  const playIdValue = formData.get("playId");
  const playId = typeof playIdValue === "string" ? playIdValue : "";
  const source = resolvePlayhouseDataSource();
  if (source === "mongo" && parsed.data.playerContactId && !playerResourceName) {
    return errorState("That Player is missing its Google contact identifier.", {
      playerContactId: "Choose a Google Player.",
    });
  }
  const repository = await createPlayRepository({
    baskets,
    ownerUserId: auth.userId,
    source,
    supabase: auth.supabase,
  });
  const saved = await repository.save({
    input: parsed.data,
    playId: playId || null,
    playerResourceName,
  });
  if (!saved) {
    return errorState(
      playId
        ? "This Play could not be updated. Refresh and try again."
        : "This Play could not be created. Please try again.",
    );
  }

  revalidatePath("/");
  return {
    message: playId ? "Play updated." : "Play created.",
    status: "success",
  };
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
  if (!playId) {
    return errorState("This Play could not be identified. Refresh and try again.");
  }

  const auth = await authenticatedClient();
  if (!auth) {
    return errorState("Your session expired. Refresh the page and sign in again.");
  }

  const repository = await createPlayRepository({
    baskets: [],
    ownerUserId: auth.userId,
    source: resolvePlayhouseDataSource(),
    supabase: auth.supabase,
  });
  const play = await repository.getLifecycleIdentity(playId);
  if (!play) {
    return errorState("This Play is no longer active. Refresh and try again.");
  }
  const lifecycle = await applyPlayLifecycle({
    gmailThreadId: play.gmailThreadId,
    setLocalStatus: (nextStatus) => repository.setStatus(playId, nextStatus),
    sourceType: play.sourceType,
    status,
    unstarThread: (threadId) => unstarGmailPlayThread({
      ownerUserId: auth.userId,
      supabase: auth.supabase,
      threadId,
    }),
  });

  if (!lifecycle.success) {
    return errorState(
      lifecycle.message === "The Play could not be updated. Refresh and try again."
        ? status === "done"
          ? "This Play could not be marked done. Refresh and try again."
          : "This Play could not be moved to Trash. Refresh and try again."
        : lifecycle.message,
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

export async function repositionPlays(request: {
  beforePlayId: string | null;
  placement: PlayPlacement;
  playIds: string[];
}): Promise<PlayMutationState> {
  try {
    const playIds = Array.from(new Set(request.playIds));
    if (
      playIds.length === 0 ||
      playIds.length > 200 ||
      playIds.some((playId) => !playId || playId.length > 100) ||
      (request.beforePlayId !== null && (
        !request.beforePlayId ||
        request.beforePlayId.length > 100 ||
        playIds.includes(request.beforePlayId)
      )) ||
      (request.placement.kind === "calendar" &&
        !isIsoCalendarDate(request.placement.scheduledDate))
    ) {
      return errorState("This move request is invalid. Refresh and try again.");
    }

    const auth = await authenticatedClient();
    if (!auth) {
      return errorState("Your session expired. Refresh the page and sign in again.");
    }
    const baskets = await loadBaskets(auth.supabase);
    if (!baskets) {
      return errorState("Your Baskets could not be loaded. Refresh and try again.");
    }
    const basketId = request.placement.kind === "basket"
      ? request.placement.basketId
      : null;
    if (
      basketId &&
      !baskets.some((basket) => basket.id === basketId)
    ) {
      return errorState("That Basket is no longer available.");
    }

    const source = resolvePlayhouseDataSource();
    if (
      source === "supabase" &&
      (playIds.some((playId) => !isUuid(playId)) ||
        (request.beforePlayId !== null && !isUuid(request.beforePlayId)))
    ) {
      return errorState("This move request is invalid. Refresh and try again.");
    }
    const repository = await createPlayRepository({
      baskets,
      ownerUserId: auth.userId,
      source,
      supabase: auth.supabase,
    });
    const moved = await repository.reposition({
      beforePlayId: request.beforePlayId,
      placement: request.placement,
      playIds,
    });
    if (!moved) {
      return errorState("These Plays could not be moved. The previous order was restored.");
    }

    return {
      message: playIds.length === 1 ? "Play moved." : `${playIds.length} Plays moved.`,
      status: "success",
    };
  } catch {
    return errorState("PlayHouse could not move these Plays. The previous order was restored.");
  }
}

export async function attachGmailToPlay(request: {
  correlationId: string;
  gmailParticipants?: unknown;
  playId: string;
  url: string;
}): Promise<PlayMutationState> {
  const rawParticipants = request.gmailParticipants &&
      typeof request.gmailParticipants === "object" &&
      !Array.isArray(request.gmailParticipants)
    ? request.gmailParticipants as Record<string, unknown>
    : null;
  console.info("GMAIL_ATTACH_SERVER_INPUT", {
    ...request,
    fromExists: Boolean(rawParticipants?.from),
    toCount: Array.isArray(rawParticipants?.to) ? rawParticipants.to.length : 0,
  });
  const gmailParticipants = sanitizeGmailParticipants(request.gmailParticipants);
  const attachment = parseGmailAttachmentUrl(request.url);
  const diagnostic = {
    correlationId: request.correlationId.slice(0, 100),
    gmailAccountIndex: attachment?.accountIndex,
    gmailHost: attachment ? "mail.google.com" : undefined,
    gmailThreadRef: attachment?.threadRef,
    playId: request.playId.slice(0, 100),
  };
  console.info("GMAIL_ATTACHMENT_SAVE_STARTED", diagnostic);
  try {
    if (
      !attachment ||
      !request.playId ||
      request.playId.length > 100 ||
      !request.correlationId ||
      request.correlationId.length > 100
    ) {
      console.warn("GMAIL_ATTACHMENT_SAVE_FAILED", diagnostic);
      return errorState("That Gmail item could not be attached.");
    }
    const auth = await authenticatedClient();
    if (!auth) {
      console.warn("GMAIL_ATTACHMENT_SAVE_FAILED", diagnostic);
      return errorState("Your session expired. Refresh the page and sign in again.");
    }
    const source = resolvePlayhouseDataSource();
    if (source === "supabase" && !isUuid(request.playId)) {
      console.warn("GMAIL_ATTACHMENT_SAVE_FAILED", diagnostic);
      return errorState("That Play could not be identified. Refresh and try again.");
    }
    const repository = await createPlayRepository({
      baskets: [],
      ownerUserId: auth.userId,
      source,
      supabase: auth.supabase,
    });
    const saved = await repository.attachGmail({ attachment, playId: request.playId });
    if (!saved) {
      console.warn("GMAIL_ATTACHMENT_SAVE_FAILED", diagnostic);
      return errorState("Gmail could not be attached to this Play.");
    }
    revalidatePath("/");
    console.info("GMAIL_ATTACHMENT_SAVE_COMPLETE", diagnostic);
    console.info("GMAIL_ASSIGNEE_RESOLUTION_STARTED", diagnostic);
    try {
      if (!gmailParticipants) {
        console.warn("GMAIL_ASSIGNEE_UPDATE_FAILED", {
          ...diagnostic,
          reason: "participant_metadata_missing",
        });
        return { message: "Gmail attached.", status: "success" };
      }
      console.info("GMAIL_PARTICIPANTS_CAPTURED", {
        ...diagnostic,
        fromExists: true,
        toCount: gmailParticipants.to.length,
      });
      const resolution = await resolveGmailAssigneeForParticipants({
        accountIndex: attachment.accountIndex,
        authenticatedEmail: auth.email,
        gmailParticipants,
        ownerUserId: auth.userId,
        supabase: auth.supabase,
      });
      if (resolution.status === "contact_not_found") {
        console.info("GMAIL_COUNTERPARTY_RESOLVED", {
          ...diagnostic,
          counterpartyEmail: resolution.counterparty.email,
          counterpartyName: resolution.counterparty.name,
        });
        console.warn("GMAIL_ASSIGNEE_CONTACT_NOT_FOUND", {
          ...diagnostic,
          counterpartyEmail: resolution.counterparty.email,
          counterpartyName: resolution.counterparty.name,
        });
        return { message: "Gmail attached.", status: "success" };
      }
      if (resolution.status === "failed") {
        console.warn("GMAIL_ASSIGNEE_UPDATE_FAILED", {
          ...diagnostic,
          reason: resolution.reason,
        });
        return { message: "Gmail attached.", status: "success" };
      }

      const assigneeDiagnostic = {
        ...diagnostic,
        contactReferenceId: resolution.contact.id,
        counterpartyEmail: resolution.counterparty.email,
        counterpartyName: resolution.counterparty.name,
      };
      console.info("GMAIL_COUNTERPARTY_RESOLVED", assigneeDiagnostic);
      console.info("GMAIL_ASSIGNEE_MATCHED", {
        ...assigneeDiagnostic,
        source: resolution.source,
      });
      const assigned = await repository.assignPlayer({
        playId: request.playId,
        playerContactId: resolution.contact.id,
        playerResourceName: resolution.contact.providerResourceName,
      });
      if (!assigned) {
        console.warn("GMAIL_ASSIGNEE_UPDATE_FAILED", {
          ...assigneeDiagnostic,
          reason: "player_update_failed",
        });
        return { message: "Gmail attached.", status: "success" };
      }
      revalidatePath("/");
      console.info("GMAIL_ASSIGNEE_UPDATE_COMPLETE", assigneeDiagnostic);
      return {
        message: "Gmail attached.",
        status: "success",
        values: {
          playerContactId: resolution.contact.id,
          playerDisplayName: resolution.contact.displayName,
        },
      };
    } catch {
      console.warn("GMAIL_ASSIGNEE_UPDATE_FAILED", {
        ...diagnostic,
        reason: "assignee_resolution_failed",
      });
      return { message: "Gmail attached.", status: "success" };
    }
  } catch {
    console.warn("GMAIL_ATTACHMENT_SAVE_FAILED", diagnostic);
    return errorState("Gmail could not be attached to this Play.");
  }
}

export async function bulkUpdatePlays(request: {
  change: BulkPlayChange;
  playIds: string[];
}): Promise<PlayMutationState> {
  try {
    const playIds = Array.from(new Set(request.playIds));
    const change = request.change;
    const validChange = change.kind === "push"
        ? ["everyday", "weekdays", "weekends"].includes(change.pushRule)
        : change.kind === "rank"
          ? ["normal", "reminder"].includes(change.playType)
          : change.placement.kind === "basket" ||
            isIsoCalendarDate(change.placement.scheduledDate);
    if (
      !validChange ||
      playIds.length === 0 ||
      playIds.length > 200 ||
      playIds.some((playId) => !playId || playId.length > 100)
    ) return errorState("This bulk change is invalid. Please try again.");

    const auth = await authenticatedClient();
    if (!auth) return errorState("Your session expired. Refresh and sign in again.");
    const baskets = await loadBaskets(auth.supabase);
    if (!baskets) return errorState("Your Baskets could not be loaded. Refresh and try again.");
    const destinationBasketId = change.kind === "move" && change.placement.kind === "basket"
      ? change.placement.basketId
      : null;
    if (
      destinationBasketId &&
      !baskets.some((basket) => basket.id === destinationBasketId)
    ) return errorState("That Basket is no longer available.");

    const source = resolvePlayhouseDataSource();
    if (source === "supabase" && playIds.some((playId) => !isUuid(playId))) {
      return errorState("This bulk change is invalid. Please try again.");
    }
    const repository = await createPlayRepository({
      baskets,
      ownerUserId: auth.userId,
      source,
      supabase: auth.supabase,
    });
    if (!(await repository.bulkUpdate(playIds, change))) {
      return errorState("These Plays could not be changed. The previous values were restored.");
    }
    return {
      message: `${playIds.length} ${playIds.length === 1 ? "Play" : "Plays"} changed.`,
      status: "success",
    };
  } catch {
    return errorState("PlayHouse could not change these Plays. The previous values were restored.");
  }
}

export async function bulkSetPlayStatus(request: {
  playIds: string[];
  status: "done" | "trash";
}): Promise<PlayMutationState> {
  try {
    const playIds = Array.from(new Set(request.playIds));
    if (
      !["done", "trash"].includes(request.status) ||
      playIds.length === 0 ||
      playIds.length > 200 ||
      playIds.some((playId) => !playId || playId.length > 100)
    ) return errorState("This bulk status change is invalid. Please try again.");

    const auth = await authenticatedClient();
    if (!auth) return errorState("Your session expired. Refresh and sign in again.");
    const source = resolvePlayhouseDataSource();
    if (source === "supabase" && playIds.some((playId) => !isUuid(playId))) {
      return errorState("This bulk status change is invalid. Please try again.");
    }
    const repository = await createPlayRepository({
      baskets: [],
      ownerUserId: auth.userId,
      source,
      supabase: auth.supabase,
    });
    const plays = await Promise.all(
      playIds.map((playId) => repository.get(playId)),
    );
    if (plays.some((play) => !play || !isBulkSelectablePlay(play))) {
      return errorState("One or more Plays are no longer active. Refresh and try again.");
    }
    const eligiblePlays = plays.filter((play) => play !== null);
    const results = await Promise.all(eligiblePlays.map((play, index) => applyPlayLifecycle({
      gmailThreadId: play.gmailThreadId,
      setLocalStatus: (nextStatus) => repository.setStatus(playIds[index], nextStatus),
      sourceType: play.sourceType,
      status: request.status,
      unstarThread: (threadId) => unstarGmailPlayThread({
        ownerUserId: auth.userId,
        supabase: auth.supabase,
        threadId,
      }),
    })));
    const failed = results.find((result) => !result.success);
    if (failed) return errorState(failed.message);
    revalidatePath("/");
    return {
      message: `${playIds.length} ${playIds.length === 1 ? "Play" : "Plays"} ${
        request.status === "done" ? "completed" : "trashed"
      }.`,
      status: "success",
    };
  } catch {
    return errorState("PlayHouse could not update these Plays. Please try again.");
  }
}

export async function flipPlayRank(request: {
  playId: string;
  playType: "normal" | "reminder";
}): Promise<PlayMutationState> {
  try {
    if (
      !request.playId ||
      request.playId.length > 100 ||
      !["normal", "reminder"].includes(request.playType)
    ) return errorState("This rank change is invalid. Please try again.");

    const auth = await authenticatedClient();
    if (!auth) return errorState("Your session expired. Refresh and sign in again.");
    const baskets = await loadBaskets(auth.supabase);
    if (!baskets) return errorState("Your Baskets could not be loaded. Refresh and try again.");
    const source = resolvePlayhouseDataSource();
    if (source === "supabase" && !isUuid(request.playId)) {
      return errorState("This rank change is invalid. Please try again.");
    }
    const repository = await createPlayRepository({
      baskets,
      ownerUserId: auth.userId,
      source,
      supabase: auth.supabase,
    });
    if (!(await repository.flipRank(request))) {
      return errorState("This Play's rank could not be changed. The previous rank was restored.");
    }
    return { message: "Play rank changed.", status: "success" };
  } catch {
    return errorState("This Play's rank could not be changed. The previous rank was restored.");
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
    if (resolvePlayhouseDataSource() === "mongo") {
      return errorState("Next Play relationships are unavailable while Mongo is the Play store.");
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
    if (resolvePlayhouseDataSource() === "mongo") {
      return errorState("Done/Create is unavailable while Mongo is the Play store.");
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
        !(await loadBaskets(auth.supabase))?.some(
          (basket) => basket.id === (
            parsed.data.placement.kind === "basket"
              ? parsed.data.placement.basketId
              : ""
          ),
        )
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
