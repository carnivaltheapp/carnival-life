import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  BasketSummary,
  NextPlayOption,
  PlayListItem,
  PlayPlacement,
} from "../../domain/play";
import type { PlayInput } from "../../domain/play-input";
import type { BulkPlayChange } from "../../domain/play-bulk-change";
import type { GmailAttachment } from "../../domain/gmail-attachment";
import type { Database } from "../supabase/database.types";
import type { SelectedView } from "./data";
import type { PlayhouseDataSource } from "./data-source";

export type RepositoryPlayList = {
  error: boolean;
  nextPlayOptions: NextPlayOption[];
  plays: PlayListItem[];
};

export type SavePlayRequest = {
  input: PlayInput;
  playId: string | null;
  playerResourceName: string | null;
};

export type RepositionPlaysRequest = {
  beforePlayId: string | null;
  placement: PlayPlacement;
  playIds: string[];
};

export type FlipPlayRankRequest = {
  playId: string;
  playType: "normal" | "reminder";
};

export type AttachGmailRequest = {
  attachment: GmailAttachment;
  playId: string;
};

export type CreateGmailPlayRequest = {
  attachment: GmailAttachment;
  input: PlayInput;
  playerResourceName: string | null;
};

export type UnlinkGmailRequest = {
  playId: string;
};

export type AssignPlayerRequest = {
  playId: string;
  playerContactId: string;
  playerResourceName: string;
};

export interface PlayRepository {
  readonly supportsWorkflows: boolean;
  attachGmail(request: AttachGmailRequest): Promise<boolean>;
  createGmail(request: CreateGmailPlayRequest): Promise<string | null>;
  unlinkGmail(request: UnlinkGmailRequest): Promise<boolean>;
  assignPlayer(request: AssignPlayerRequest): Promise<boolean>;
  get(playId: string): Promise<PlayListItem | null>;
  getLifecycleIdentity(playId: string): Promise<Pick<PlayListItem, "gmailThreadId" | "sourceType"> | null>;
  list(selectedView?: SelectedView): Promise<RepositoryPlayList>;
  reconcileDueReminders(todayDate: string): Promise<boolean>;
  flipRank(request: FlipPlayRankRequest): Promise<boolean>;
  bulkUpdate(playIds: string[], change: BulkPlayChange): Promise<boolean>;
  reposition(request: RepositionPlaysRequest): Promise<boolean>;
  save(request: SavePlayRequest): Promise<boolean>;
  setStatus(playId: string, status: "done" | "trash"): Promise<boolean>;
}

export async function createPlayRepository({
  baskets,
  ownerUserId,
  source,
  supabase,
}: {
  baskets: BasketSummary[];
  ownerUserId: string;
  source: PlayhouseDataSource;
  supabase: SupabaseClient<Database>;
}): Promise<PlayRepository> {
  if (source === "supabase") {
    const { SupabasePlayRepository } = await import("./supabase-play-repository");
    return new SupabasePlayRepository(supabase, ownerUserId);
  }

  const [{ getLegacyTaskCollection }, { MongoPlayRepository }] = await Promise.all([
    import("./mongo-client"),
    import("./mongo-play-repository"),
  ]);
  return new MongoPlayRepository({
    baskets,
    collection: await getLegacyTaskCollection(),
    ownerUserId,
    supabase,
  });
}
