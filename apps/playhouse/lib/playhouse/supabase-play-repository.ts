import type { SupabaseClient } from "@supabase/supabase-js";

import type { NextPlayOption, PlayListItem } from "../../domain/play";
import type { BulkPlayChange } from "../../domain/play-bulk-change";
import { gmailThreadIdFromMetadata } from "../../domain/play-display";
import { orderUpdatesForInsertion } from "../../domain/play-order";
import { searchableMetadataText } from "../../domain/play-search";
import { promotionOrderUpdates } from "../../domain/reminder";
import { legacyTaskTypeFromMetadata } from "../../domain/play-visual";
import type { Database } from "../supabase/database.types";
import type { SelectedView } from "./data";
import type {
  FlipPlayRankRequest,
  PlayRepository,
  RepositoryPlayList,
  RepositionPlaysRequest,
  SavePlayRequest,
} from "./play-repository";

function playValues(data: SavePlayRequest["input"]) {
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

export class SupabasePlayRepository implements PlayRepository {
  readonly supportsWorkflows = true;

  constructor(
    private readonly supabase: SupabaseClient<Database>,
    private readonly ownerUserId: string,
  ) {}

  async get(playId: string) {
    const { data, error } = await this.supabase
      .from("plays")
      .select(
        "id, title, play_type, source_type, scheduled_date, basket_id, duration_minutes, player_contact_id, branch, note, url, push_rule, place, source_metadata",
      )
      .eq("id", playId)
      .eq("status", "open")
      .maybeSingle();
    if (error || !data) return null;

    let playerDisplayName: string | null = null;
    if (data.player_contact_id) {
      const { data: contact } = await this.supabase
        .from("contact_references")
        .select("display_name")
        .eq("id", data.player_contact_id)
        .maybeSingle();
      playerDisplayName = contact?.display_name ?? null;
    }

    return {
      basketId: data.basket_id,
      branch: data.branch,
      durationMinutes: data.duration_minutes,
      gmailThreadId: gmailThreadIdFromMetadata(data.source_metadata),
      id: data.id,
      nextPlayId: null,
      note: data.note,
      place: data.place,
      playerContactId: data.player_contact_id,
      playerDisplayName,
      playType: data.play_type,
      pushRule: data.push_rule,
      scheduledDate: data.scheduled_date,
      sourceMetadata: data.source_metadata,
      sourceType: data.source_type,
      title: data.title,
      url: data.url,
    } satisfies PlayListItem;
  }

  async getLifecycleIdentity(playId: string) {
    const { data, error } = await this.supabase
      .from("plays")
      .select("source_type, source_metadata")
      .eq("id", playId)
      .eq("owner_user_id", this.ownerUserId)
      .eq("status", "open")
      .maybeSingle();
    return error || !data
      ? null
      : {
          gmailThreadId: gmailThreadIdFromMetadata(data.source_metadata),
          sourceType: data.source_type,
        };
  }

  async list(selectedView?: SelectedView): Promise<RepositoryPlayList> {
    let playQuery = this.supabase
      .from("plays")
      .select(
        "id, title, play_type, source_type, scheduled_date, basket_id, duration_minutes, player_contact_id, branch, note, url, push_rule, place, sort_order, created_at, source_metadata",
      )
      .eq("owner_user_id", this.ownerUserId)
      .eq("status", "open");

    if (selectedView?.kind === "basket") {
      playQuery = playQuery.eq("basket_id", selectedView.basket.id);
    } else if (selectedView?.kind === "calendar") {
      playQuery = playQuery
        .gte("scheduled_date", selectedView.startDate)
        .lte("scheduled_date", selectedView.endDate);
    } else if (selectedView) {
      playQuery = playQuery
        .gte("scheduled_date", selectedView.defaultDate)
        .lt("scheduled_date", "2200-01-01")
        .is("basket_id", null);
    }

    const orderedPlayQuery = !selectedView || selectedView.kind === "all"
      ? playQuery
          .order("scheduled_date", { ascending: true })
          .order("play_type", { ascending: true })
          .order("sort_order", { ascending: true })
          .order("created_at", { ascending: true })
      : playQuery
          .order("sort_order", { ascending: true })
          .order("created_at", { ascending: true });

    const [playResult, optionResult] = await Promise.all([
      orderedPlayQuery,
      this.supabase
        .from("plays")
        .select("id, title, status, play_type, scheduled_date, basket_id")
        .eq("owner_user_id", this.ownerUserId)
        .order("title", { ascending: true })
        .limit(1000),
    ]);
    const playRows = playResult.data ?? [];
    const playerContactIds = Array.from(
      new Set(playRows.flatMap((play) => play.player_contact_id ? [play.player_contact_id] : [])),
    );
    const contactResult = playerContactIds.length
      ? await this.supabase
          .from("contact_references")
          .select("id, display_name, email")
          .in("id", playerContactIds)
      : { data: [], error: null };
    const contactById = new Map(
      (contactResult.data ?? []).map((contact) => [contact.id, contact]),
    );
    const playIds = playRows.map((play) => play.id);
    const relationshipResult = playIds.length
      ? await this.supabase
          .from("play_relationships")
          .select("from_play_id, to_play_id")
          .in("from_play_id", playIds)
          .eq("relationship_type", "next")
      : { data: [], error: null };
    const nextByPlayId = new Map(
      (relationshipResult.data ?? []).map((relationship) => [
        relationship.from_play_id,
        relationship.to_play_id,
      ]),
    );

    const plays: PlayListItem[] = playRows.map((play) => ({
      basketId: play.basket_id,
      branch: play.branch,
      durationMinutes: play.duration_minutes,
      gmailThreadId: gmailThreadIdFromMetadata(play.source_metadata),
      id: play.id,
      nextPlayId: nextByPlayId.get(play.id) ?? null,
      note: play.note,
      place: play.place,
      playerContactId: play.player_contact_id,
      playerDisplayName: play.player_contact_id
        ? (contactById.get(play.player_contact_id)?.display_name ?? null)
        : null,
      playType: play.play_type,
      pushRule: play.push_rule,
      scheduledDate: play.scheduled_date,
      searchableText: [
        ...(play.player_contact_id
          ? [contactById.get(play.player_contact_id)?.email]
          : []),
        ...searchableMetadataText(play.source_metadata),
      ].filter((value): value is string => typeof value === "string"),
      sourceMetadata: play.source_metadata,
      sourceType: play.source_type,
      sortOrder: play.sort_order,
      title: play.title,
      url: play.url,
    }));
    const nextPlayOptions: NextPlayOption[] = (optionResult.data ?? []).map((play) => ({
      basketId: play.basket_id,
      id: play.id,
      playType: play.play_type,
      scheduledDate: play.scheduled_date,
      status: play.status,
      title: play.title,
    }));

    return {
      error: Boolean(
        playResult.error ||
        optionResult.error ||
        contactResult.error ||
        relationshipResult.error
      ),
      nextPlayOptions,
      plays,
    };
  }

  async reconcileDueReminders(todayDate: string) {
    const { data: dueRows, error: dueError } = await this.supabase
      .from("plays")
      .select("id, sort_order")
      .eq("owner_user_id", this.ownerUserId)
      .eq("status", "open")
      .eq("play_type", "reminder")
      .is("basket_id", null)
      .lt("scheduled_date", todayDate)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (dueError) return false;
    if (!dueRows.length) return true;

    const { data: headlineRows, error: headlineError } = await this.supabase
      .from("plays")
      .select("id, sort_order")
      .eq("owner_user_id", this.ownerUserId)
      .eq("status", "open")
      .eq("play_type", "normal")
      .eq("scheduled_date", todayDate)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (headlineError) return false;

    const updates = new Map(promotionOrderUpdates({
      dueReminders: dueRows.map((play) => ({ id: play.id, order: play.sort_order })),
      existingHeadlines: headlineRows.map((play) => ({
        id: play.id,
        order: play.sort_order,
      })),
      step: 1000,
    }).map((update) => [update.id, update.order]));
    const results = await Promise.all([
      ...headlineRows.flatMap((play) => {
        const sortOrder = updates.get(play.id);
        return sortOrder !== undefined && sortOrder !== play.sort_order
          ? [this.supabase
              .from("plays")
              .update({ sort_order: sortOrder })
              .eq("id", play.id)
              .eq("owner_user_id", this.ownerUserId)
              .eq("status", "open")
              .eq("play_type", "normal")
              .select("id")
              .maybeSingle()]
          : [];
      }),
      ...dueRows.map((play) => this.supabase
        .from("plays")
        .update({
          basket_id: null,
          play_type: "normal",
          scheduled_date: todayDate,
          sort_order: updates.get(play.id),
        })
        .eq("id", play.id)
        .eq("owner_user_id", this.ownerUserId)
        .eq("status", "open")
        .eq("play_type", "reminder")
        .select("id")
        .maybeSingle()),
    ]);
    if (results.every(({ data, error }) => !error && Boolean(data))) return true;
    const { count, error } = await this.supabase
      .from("plays")
      .select("id", { count: "exact", head: true })
      .eq("owner_user_id", this.ownerUserId)
      .eq("status", "open")
      .eq("play_type", "reminder")
      .in("id", dueRows.map((play) => play.id));
    return !error && count === 0;
  }

  async save({ input, playId }: SavePlayRequest) {
    const values = playValues(input);
    let reminderSortOrder: number | undefined;
    if (playId) {
      const updateValues: Database["public"]["Tables"]["plays"]["Update"] = { ...values };
      if (input.playType === "reminder") {
        delete updateValues.duration_minutes;
      }
      const { data: existing, error: existingError } = await this.supabase
        .from("plays")
        .select("id, play_type, source_metadata")
        .eq("id", playId)
        .eq("owner_user_id", this.ownerUserId)
        .eq("status", "open")
        .maybeSingle();
      if (existingError || !existing) return false;
      if (
        legacyTaskTypeFromMetadata(existing.source_metadata) === "A" &&
        input.playType === "reminder"
      ) return false;
      if (existing.play_type !== "reminder" && input.playType === "reminder") {
        const { data: latest, error: latestError } = await this.supabase
          .from("plays")
          .select("sort_order")
          .eq("owner_user_id", this.ownerUserId)
          .eq("status", "open")
          .eq("play_type", "reminder")
          .eq("scheduled_date", input.placement.kind === "calendar"
            ? input.placement.scheduledDate
            : "")
          .neq("id", playId)
          .order("sort_order", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (latestError) return false;
        reminderSortOrder = (latest?.sort_order ?? 0) + 1000;
      }
      const orderedUpdate = reminderSortOrder === undefined
        ? updateValues
        : { ...updateValues, sort_order: reminderSortOrder };
      const { data, error } = await this.supabase
        .from("plays")
        .update(orderedUpdate)
        .eq("id", playId)
        .eq("owner_user_id", this.ownerUserId)
        .eq("status", "open")
        .select("id")
        .maybeSingle();
      return !error && Boolean(data);
    }

    if (input.playType === "reminder" && input.placement.kind === "calendar") {
      const { data: latest, error: latestError } = await this.supabase
        .from("plays")
        .select("sort_order")
        .eq("owner_user_id", this.ownerUserId)
        .eq("status", "open")
        .eq("play_type", "reminder")
        .eq("scheduled_date", input.placement.scheduledDate)
        .order("sort_order", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latestError) return false;
      reminderSortOrder = (latest?.sort_order ?? 0) + 1000;
    }

    const { error } = await this.supabase.from("plays").insert({
      ...values,
      owner_user_id: this.ownerUserId,
      ...(reminderSortOrder === undefined ? {} : { sort_order: reminderSortOrder }),
    });
    return !error;
  }

  async flipRank({ playId, playType, reminderDate }: FlipPlayRankRequest) {
    const { data: play, error: playError } = await this.supabase
      .from("plays")
      .select("id, play_type, scheduled_date, basket_id, source_metadata")
      .eq("id", playId)
      .eq("owner_user_id", this.ownerUserId)
      .eq("status", "open")
      .maybeSingle();
    if (
      playError ||
      !play ||
      legacyTaskTypeFromMetadata(play.source_metadata) === "A" ||
      play.play_type === playType
    ) return false;

    const preserveReminderDate = playType === "reminder" && Boolean(
      play.scheduled_date && play.scheduled_date >= reminderDate && !play.basket_id,
    );
    const scheduledDate = playType === "reminder" && !preserveReminderDate
      ? reminderDate
      : play.scheduled_date;
    const basketId = playType === "reminder" && !preserveReminderDate
      ? null
      : play.basket_id;
    let destinationQuery = this.supabase
      .from("plays")
      .select("id, sort_order, source_metadata")
      .eq("owner_user_id", this.ownerUserId)
      .eq("status", "open")
      .eq("play_type", playType);
    destinationQuery = basketId
      ? destinationQuery.eq("basket_id", basketId)
      : scheduledDate
        ? destinationQuery.eq("scheduled_date", scheduledDate)
        : destinationQuery.is("scheduled_date", null);
    const { data: destination, error: destinationError } = await destinationQuery
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (destinationError) return false;

    const firstOrder = destination.find((candidate) =>
      candidate.id !== playId &&
      (playType === "reminder" ||
        legacyTaskTypeFromMetadata(candidate.source_metadata) !== "A")
    )?.sort_order;
    const { data, error } = await this.supabase
      .from("plays")
      .update({
        basket_id: basketId,
        play_type: playType,
        scheduled_date: scheduledDate,
        sort_order: (firstOrder ?? 1000) - 1000,
      })
      .eq("id", playId)
      .eq("owner_user_id", this.ownerUserId)
      .eq("status", "open")
      .eq("play_type", play.play_type)
      .select("id")
      .maybeSingle();
    return !error && Boolean(data);
  }

  async bulkUpdate(playIds: string[], change: BulkPlayChange) {
    const { data: rows, error: rowsError } = await this.supabase
      .from("plays")
      .select("id, scheduled_date, basket_id, source_metadata")
      .eq("owner_user_id", this.ownerUserId)
      .eq("status", "open")
      .in("id", playIds);
    if (
      rowsError ||
      rows.length !== playIds.length ||
      rows.some((play) => legacyTaskTypeFromMetadata(play.source_metadata) === "A")
    ) return false;
    if (change.kind === "move") {
      return this.reposition({ beforePlayId: null, placement: change.placement, playIds });
    }

    const results = await Promise.all(rows.map((play) => {
      let values: Database["public"]["Tables"]["plays"]["Update"];
      if (change.kind === "push") {
        values = { push_rule: change.pushRule };
      } else if (change.kind === "duration") {
        values = { duration_minutes: change.durationMinutes };
      } else if (change.playType === "normal") {
        values = { play_type: "normal" };
      } else {
        const preserveDate = Boolean(
          play.scheduled_date && play.scheduled_date >= change.reminderDate && !play.basket_id,
        );
        values = {
          basket_id: null,
          play_type: "reminder",
          scheduled_date: preserveDate ? play.scheduled_date : change.reminderDate,
        };
      }
      return this.supabase
        .from("plays")
        .update(values)
        .eq("id", play.id)
        .eq("owner_user_id", this.ownerUserId)
        .eq("status", "open")
        .select("id")
        .maybeSingle();
    }));
    return results.every(({ data, error }) => !error && Boolean(data));
  }

  async reposition({
    beforePlayId,
    placement,
    playIds,
  }: RepositionPlaysRequest) {
    const { data: selectedRows, error: selectedError } = await this.supabase
      .from("plays")
      .select("id, play_type, scheduled_date, basket_id, sort_order, source_metadata")
      .eq("owner_user_id", this.ownerUserId)
      .eq("status", "open")
      .in("id", playIds);
    if (
      selectedError ||
      selectedRows.length !== playIds.length ||
      selectedRows.some((play) => legacyTaskTypeFromMetadata(play.source_metadata) === "A")
    ) return false;

    let destinationQuery = this.supabase
      .from("plays")
      .select("id, play_type, scheduled_date, basket_id, sort_order")
      .eq("owner_user_id", this.ownerUserId)
      .eq("status", "open");
    destinationQuery = placement.kind === "calendar"
      ? destinationQuery.eq("scheduled_date", placement.scheduledDate)
      : destinationQuery.eq("basket_id", placement.basketId);
    const { data: destinationRows, error: destinationError } = await destinationQuery
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (destinationError) return false;
    if (beforePlayId && !destinationRows.some((play) => play.id === beforePlayId)) {
      return false;
    }

    const selectedById = new Map(selectedRows.map((play) => [play.id, play]));
    const updates = new Map<string, Database["public"]["Tables"]["plays"]["Update"]>();

    for (const playType of ["normal", "reminder"] as const) {
      const movingPlayIds = playIds.filter(
        (playId) => selectedById.get(playId)?.play_type === playType,
      );
      if (!movingPlayIds.length) continue;
      const typeRows = destinationRows.filter((play) => play.play_type === playType);
      const beforeMatchesType = beforePlayId
        ? destinationRows.find((play) => play.id === beforePlayId)?.play_type === playType
        : false;
      for (const update of orderUpdatesForInsertion({
        beforePlayId: beforeMatchesType ? beforePlayId : null,
        destination: typeRows.map((play) => ({ id: play.id, order: play.sort_order })),
        movingPlayIds,
        step: 1000,
      })) {
        const existing = selectedById.get(update.id) ??
          destinationRows.find((play) => play.id === update.id);
        if (existing?.sort_order !== update.order) {
          updates.set(update.id, { sort_order: update.order });
        }
      }
    }

    for (const playId of playIds) {
      const play = selectedById.get(playId);
      if (!play) return false;
      const moved = placement.kind === "calendar"
        ? play.scheduled_date !== placement.scheduledDate || play.basket_id !== null
        : play.basket_id !== placement.basketId || play.scheduled_date !== null;
      if (moved) {
        updates.set(playId, {
          ...(updates.get(playId) ?? {}),
          basket_id: placement.kind === "basket" ? placement.basketId : null,
          scheduled_date: placement.kind === "calendar" ? placement.scheduledDate : null,
        });
      }
    }

    if (!updates.size) return true;
    const results = await Promise.all([...updates].map(([playId, values]) =>
      this.supabase
        .from("plays")
        .update(values)
        .eq("id", playId)
        .eq("owner_user_id", this.ownerUserId)
        .eq("status", "open")
        .select("id")
        .maybeSingle()
    ));
    return results.every(({ data, error }) => !error && Boolean(data));
  }

  async setStatus(playId: string, status: "done" | "trash") {
    const { data, error } = await this.supabase
      .from("plays")
      .update({
        completed_at: status === "done" ? new Date().toISOString() : null,
        status,
      })
      .eq("id", playId)
      .eq("status", "open")
      .select("id")
      .maybeSingle();
    return !error && Boolean(data);
  }
}
