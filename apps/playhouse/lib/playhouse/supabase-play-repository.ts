import type { SupabaseClient } from "@supabase/supabase-js";

import type { NextPlayOption, PlayListItem } from "../../domain/play";
import { gmailThreadIdFromMetadata } from "../../domain/play-display";
import type { Database } from "../supabase/database.types";
import type { SelectedView } from "./data";
import type {
  PlayRepository,
  RepositoryPlayList,
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

  async list(selectedView: SelectedView): Promise<RepositoryPlayList> {
    let playQuery = this.supabase
      .from("plays")
      .select(
        "id, title, play_type, source_type, scheduled_date, basket_id, duration_minutes, player_contact_id, branch, note, url, push_rule, place, sort_order, created_at, source_metadata",
      )
      .eq("status", "open");

    if (selectedView.kind === "basket") {
      playQuery = playQuery.eq("basket_id", selectedView.basket.id);
    } else {
      playQuery = playQuery
        .gte("scheduled_date", selectedView.startDate)
        .lte("scheduled_date", selectedView.endDate);
    }

    const [playResult, optionResult] = await Promise.all([
      playQuery
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true }),
      this.supabase
        .from("plays")
        .select("id, title, status, play_type, scheduled_date, basket_id")
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
          .select("id, display_name")
          .in("id", playerContactIds)
      : { data: [], error: null };
    const contactNameById = new Map(
      (contactResult.data ?? []).map((contact) => [contact.id, contact.display_name]),
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
        ? (contactNameById.get(play.player_contact_id) ?? null)
        : null,
      playType: play.play_type,
      pushRule: play.push_rule,
      scheduledDate: play.scheduled_date,
      sourceMetadata: play.source_metadata,
      sourceType: play.source_type,
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

  async save({ input, playId }: SavePlayRequest) {
    const values = playValues(input);
    if (playId) {
      const { data, error } = await this.supabase
        .from("plays")
        .update(values)
        .eq("id", playId)
        .eq("status", "open")
        .select("id")
        .maybeSingle();
      return !error && Boolean(data);
    }

    const { error } = await this.supabase.from("plays").insert({
      ...values,
      owner_user_id: this.ownerUserId,
    });
    return !error;
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
