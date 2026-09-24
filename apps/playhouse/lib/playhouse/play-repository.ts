import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  BasketSummary,
  NextPlayOption,
  PlayListItem,
  PlayPlacement,
} from "../../domain/play";
import type { PlayInput } from "../../domain/play-input";
import type { PlayLifecycle, SelectedView } from "../../domain/playhouse-view";
import type { BulkPlayChange } from "../../domain/play-bulk-change";
import type { GmailAttachment } from "../../domain/gmail-attachment";
import type { Database } from "../supabase/database.types";
import type { PlayhouseDataSource } from "./data-source";

export type RepositoryPlayList = {
  error: boolean;
  nextPlayOptions: NextPlayOption[];
  plays: PlayListItem[];
};

export type SavePlayRequest = {
  input: PlayInput;
  playId: string | null;
  playerReferences?: Array<{
    contactId?: string;
    displayName: string;
    kind: "contact" | "group";
    memberCount?: number;
    resourceName: string;
  }>;
  playerResourceName: string | null;
};

export type RepositionPlaysRequest = {
  beforePlayId: string | null;
  placement: PlayPlacement;
  playIds: string[];
  sourceLifecycle?: PlayLifecycle;
};

export type FlipPlayRankRequest = {
  playId: string;
  playType: "normal" | "reminder";
};

export type AttachGmailRequest = {
  attachment: GmailAttachment;
  playId: string;
};

export type ManualLinkGmailRequest = AttachGmailRequest & {
  expectedCurrentIdentity: {
    apiThreadId: string | null;
    webThreadRef: string | null;
  };
};

export type GmailRevivedPlay = {
  playId: string;
  priorLifecycle: "done" | "trashed";
};

export type ManualLinkGmailResult = {
  decision: "linked" | "replaced";
  revived: GmailRevivedPlay[];
  targetHadGmailLink: boolean;
  targetPlayId: string;
};

export type CreateGmailPlayRequest = {
  attachment: GmailAttachment;
  input: PlayInput;
  playerResourceName: string | null;
};

export type GmailPlayLifecycle = "active" | "done" | "trashed";
export type CreateGmailPlayResult =
  | { decision: "created"; playId: string }
  | {
      decision: "suppressed";
      existingLifecycle: GmailPlayLifecycle;
      existingPlayId: string;
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
  createGmail(request: CreateGmailPlayRequest): Promise<CreateGmailPlayResult | null>;
  unlinkGmail(request: UnlinkGmailRequest): Promise<boolean>;
  assignPlayer(request: AssignPlayerRequest): Promise<boolean>;
  get(playId: string, lifecycle?: PlayLifecycle): Promise<PlayListItem | null>;
  getLifecycleIdentity(playId: string): Promise<Pick<PlayListItem, "gmailThreadId" | "sourceType"> | null>;
  manualLinkGmail(request: ManualLinkGmailRequest): Promise<ManualLinkGmailResult | null>;
  list(selectedView?: SelectedView, lifecycle?: PlayLifecycle): Promise<RepositoryPlayList>;
  reconcileDueReminders(todayDate: string): Promise<boolean>;
  flipRank(request: FlipPlayRankRequest): Promise<boolean>;
  bulkUpdate(
    playIds: string[],
    change: BulkPlayChange,
    sourceLifecycle?: PlayLifecycle,
  ): Promise<boolean>;
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
