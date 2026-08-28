import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  BasketSummary,
  NextPlayOption,
  PlayListItem,
} from "../../domain/play";
import type { PlayInput } from "../../domain/play-input";
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

export interface PlayRepository {
  readonly supportsWorkflows: boolean;
  get(playId: string): Promise<PlayListItem | null>;
  list(selectedView: SelectedView): Promise<RepositoryPlayList>;
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
