"use server";

import { revalidatePath } from "next/cache";

import { MongoIncomingEventService } from "../../lib/incoming-events/mongo-incoming-event-store";
import { resolvePlayhouseDataSource } from "../../lib/playhouse/data-source";
import { createClient } from "../../lib/supabase/server";

export async function handleIncomingGmailEvents(playId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const ownerUserId = typeof data?.claims?.sub === "string" ? data.claims.sub : null;
  if (error || !ownerUserId || resolvePlayhouseDataSource() !== "mongo") {
    return { success: false };
  }
  try {
    const handled = await new MongoIncomingEventService()
      .handleAllForPlay(ownerUserId, playId);
    if (handled) revalidatePath("/");
    return { success: handled };
  } catch (actionError) {
    console.warn("CARNIVAL_INCOMING_EVENT EVENT_HANDLE_FAILED", {
      playId,
      reason: actionError instanceof Error ? actionError.name : "unknown_error",
    });
    return { success: false };
  }
}
