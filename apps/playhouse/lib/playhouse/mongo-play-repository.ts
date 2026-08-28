import type { SupabaseClient } from "@supabase/supabase-js";
import {
  type Collection,
  type Filter,
  type WithId,
} from "mongodb";

import type { BasketSummary } from "../../domain/play";
import type { Database } from "../supabase/database.types";
import type { SelectedView } from "./data";
import {
  assertMongoUserMapping,
  legacyTaskDate,
  mapMongoPlay,
  mongoActiveFilter,
  mongoBasketFilter,
  mongoContactFallback,
  mongoContactResourceName,
  mongoCreateDocument,
  mongoDateFilter,
  mongoEditableSet,
  mongoMutationFilter,
  MONGO_LEGACY_USER_ID,
  nextLegacyPriorityIndex,
  type LegacyTaskDocument,
  type MongoContactDisplay,
} from "./mongo-play-mapping";
import type {
  PlayRepository,
  RepositoryPlayList,
  SavePlayRequest,
} from "./play-repository";
import { mongoDiagnostic } from "./mongo-options";

type ContactReferenceRow = {
  display_name: string;
  id: string;
  provider_resource_name: string | null;
};

export class MongoPlayRepository implements PlayRepository {
  readonly supportsWorkflows = false;

  constructor(private readonly dependencies: {
    baskets: BasketSummary[];
    collection: Collection<LegacyTaskDocument>;
    ownerUserId: string;
    supabase: SupabaseClient<Database>;
  }) {
    assertMongoUserMapping(dependencies.ownerUserId);
  }

  private async contactMap(tasks: WithId<LegacyTaskDocument>[]) {
    const resourceNames = Array.from(
      new Set(tasks.flatMap((task) => {
        const resourceName = mongoContactResourceName(task);
        return resourceName ? [resourceName] : [];
      })),
    );
    if (!resourceNames.length) return new Map<string, MongoContactDisplay>();

    const { data: existing, error: existingError } = await this.dependencies.supabase
      .from("contact_references")
      .select("id, display_name, provider_resource_name")
      .eq("owner_user_id", this.dependencies.ownerUserId)
      .in("provider_resource_name", resourceNames);
    if (existingError) throw new Error("Player references could not be loaded.");

    const rows: ContactReferenceRow[] = existing ?? [];
    const found = new Set(rows.flatMap((row) => row.provider_resource_name ? [row.provider_resource_name] : []));
    const missing = resourceNames.filter((resourceName) => !found.has(resourceName));

    if (missing.length) {
      const { data: account, error: accountError } = await this.dependencies.supabase
        .from("google_accounts")
        .select("id")
        .eq("owner_user_id", this.dependencies.ownerUserId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (accountError || !account) {
        throw new Error("Player references require a connected Google account.");
      }

      const taskByResourceName = new Map(
        tasks.flatMap((task) => {
          const resourceName = mongoContactResourceName(task);
          return resourceName ? [[resourceName, task] as const] : [];
        }),
      );
      const { data: inserted, error: insertError } = await this.dependencies.supabase
        .from("contact_references")
        .upsert(
          missing.map((resourceName) => ({
            display_name: mongoContactFallback(taskByResourceName.get(resourceName) ?? {}),
            email: typeof taskByResourceName.get(resourceName)?.email === "string"
              ? taskByResourceName.get(resourceName)?.email as string
              : null,
            google_account_id: account.id,
            owner_user_id: this.dependencies.ownerUserId,
            provider_resource_name: resourceName,
          })),
          { onConflict: "google_account_id,provider_resource_name" },
        )
        .select("id, display_name, provider_resource_name");
      if (insertError) throw new Error("Player references could not be cached.");
      rows.push(...(inserted ?? []));
    }

    return new Map(
      rows.flatMap((row) => row.provider_resource_name
        ? [[row.provider_resource_name, { displayName: row.display_name, id: row.id }] as const]
        : []),
    );
  }

  private async mapTasks(tasks: WithId<LegacyTaskDocument>[]) {
    const contacts = await this.contactMap(tasks);
    return tasks.map((task) => {
      const resourceName = mongoContactResourceName(task);
      return mapMongoPlay(
        task,
        this.dependencies.baskets,
        resourceName ? contacts.get(resourceName) : undefined,
      );
    });
  }

  async get(playId: string) {
    let filter: Filter<LegacyTaskDocument>;
    try {
      filter = {
        ...mongoActiveFilter(),
        ...mongoMutationFilter(playId),
      };
    } catch {
      return null;
    }
    const task = await this.dependencies.collection.findOne(filter);
    if (!task) return null;
    return (await this.mapTasks([task]))[0] ?? null;
  }

  async list(selectedView: SelectedView): Promise<RepositoryPlayList> {
    const filter = selectedView.kind === "all"
      ? mongoActiveFilter()
      : selectedView.kind === "basket"
      ? mongoBasketFilter(selectedView.basket.slug)
      : mongoDateFilter(selectedView.startDate, selectedView.endDate);
    const isToday = selectedView.kind === "calendar" && selectedView.key === "today";
    const startedAt = Date.now();
    if (isToday) {
      console.info("[PlayHouse Mongo] Today query start");
    }
    let tasks: WithId<LegacyTaskDocument>[];
    try {
      tasks = await this.dependencies.collection
        .find(filter)
        .sort(selectedView.kind === "all"
          ? { task_date: 1, priority_index: 1, created_date: 1, _id: 1 }
          : { priority_index: 1, created_date: 1, _id: 1 })
        .toArray();
      if (selectedView.kind === "all") {
        tasks.sort((left, right) => {
          const leftDate = left.task_date instanceof Date ? left.task_date.getTime() : 0;
          const rightDate = right.task_date instanceof Date ? right.task_date.getTime() : 0;
          return leftDate - rightDate ||
            Number(left.task_type === "S") - Number(right.task_type === "S");
        });
      }
      if (isToday) {
        console.info("[PlayHouse Mongo] Today query success", {
          count: tasks.length,
          durationMs: Date.now() - startedAt,
        });
      }
    } catch (error) {
      if (isToday) {
        console.error("[PlayHouse Mongo] Today query failure", {
          durationMs: Date.now() - startedAt,
          ...mongoDiagnostic(error),
        });
      }
      throw error;
    }

    return {
      error: false,
      nextPlayOptions: [],
      plays: await this.mapTasks(tasks),
    };
  }

  async save({ input, playId, playerResourceName }: SavePlayRequest) {
    if (playId) {
      let identityFilter: Filter<LegacyTaskDocument>;
      try {
        identityFilter = mongoMutationFilter(playId);
      } catch {
        return false;
      }
      const filter = {
        ...identityFilter,
        is_active: true,
        is_deleted: false,
      };
      const existing = await this.dependencies.collection.findOne(filter, {
        projection: { task_type: 1 },
      });
      if (!existing) return false;
      const result = await this.dependencies.collection.updateOne(filter, {
        $set: mongoEditableSet({
          baskets: this.dependencies.baskets,
          existingTaskType: existing.task_type,
          input,
          playerResourceName,
        }),
      });
      return result.matchedCount === 1;
    }

    const taskDate = legacyTaskDate(input, this.dependencies.baskets);
    const latest = await this.dependencies.collection.findOne(
      {
        ...mongoActiveFilter(),
        task_date: taskDate,
      },
      { projection: { priority_index: 1 }, sort: { priority_index: -1 } },
    );
    const result = await this.dependencies.collection.insertOne(
      mongoCreateDocument({
        baskets: this.dependencies.baskets,
        input,
        playerResourceName,
        priorityIndex: nextLegacyPriorityIndex(latest?.priority_index),
      }),
    );
    return result.acknowledged;
  }

  async setStatus(playId: string, status: "done" | "trash") {
    let identityFilter: Filter<LegacyTaskDocument>;
    try {
      identityFilter = mongoMutationFilter(playId);
    } catch {
      return false;
    }
    const result = await this.dependencies.collection.updateOne(
      {
        ...identityFilter,
        is_active: true,
        is_deleted: false,
      },
      {
        $set: status === "done"
          ? { is_active: false, updated_date: new Date() }
          : { is_active: false, is_deleted: true, updated_date: new Date() },
      },
    );
    return result.matchedCount === 1;
  }
}

export const MONGO_PLAY_USER_SCOPE = { user_id: MONGO_LEGACY_USER_ID } as const;
