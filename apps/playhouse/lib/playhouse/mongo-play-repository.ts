import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ObjectId,
  type Collection,
  type Filter,
  type WithId,
} from "mongodb";

import type { BasketSummary } from "../../domain/play";
import { orderUpdatesForInsertion } from "../../domain/play-order";
import { promotionOrderUpdates } from "../../domain/reminder";
import type { Database } from "../supabase/database.types";
import type { SelectedView } from "./data";
import {
  assertMongoUserMapping,
  isRealScheduledDateOnOrAfter,
  legacyPlacementDate,
  legacyPriorityNumber,
  legacyPriorityValue,
  legacyTaskDate,
  mapMongoPlay,
  mongoActiveFilter,
  mongoAllScheduledFilter,
  mongoBasketFilter,
  mongoContactFallback,
  mongoContactResourceName,
  mongoCreateDocument,
  mongoDateFilter,
  mongoEditableSet,
  mongoMutationFilter,
  mongoPlacementDateFilter,
  mongoPlayType,
  MONGO_LEGACY_USER_ID,
  nextLegacyPriorityIndex,
  type LegacyTaskDocument,
  type MongoContactDisplay,
} from "./mongo-play-mapping";
import type {
  PlayRepository,
  RepositoryPlayList,
  RepositionPlaysRequest,
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
      ? mongoAllScheduledFilter(selectedView.defaultDate)
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
        tasks = tasks
          .filter((task) => isRealScheduledDateOnOrAfter(
            task.task_date,
            selectedView.defaultDate,
          ));
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

  async reconcileDueReminders(todayDate: string) {
    const today = new Date(`${todayDate}T00:00:00.000Z`);
    const tomorrow = new Date(today);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const dueReminders = await this.dependencies.collection
      .find({
        ...mongoActiveFilter(),
        task_date: { $lt: tomorrow, $type: "date" },
        task_type: "S",
      })
      .sort({ priority_index: 1, created_date: 1, _id: 1 })
      .toArray();
    if (!dueReminders.length) return true;

    const existingHeadlines = await this.dependencies.collection
      .find({
        ...mongoActiveFilter(),
        task_date: { $gte: today, $lt: tomorrow },
        task_type: { $ne: "S" },
      })
      .sort({ priority_index: 1, created_date: 1, _id: 1 })
      .toArray();
    const dueOrders = dueReminders.map((task, index) => ({
      id: task._id.toHexString(),
      order: legacyPriorityNumber(task.priority_index, (index + 1) * 0x100),
    }));
    const headlineOrders = existingHeadlines.map((task, index) => ({
      id: task._id.toHexString(),
      order: legacyPriorityNumber(task.priority_index, (index + 1) * 0x100),
    }));
    const lowerBound = headlineOrders.length
      ? Math.floor(headlineOrders[0].order / 0x100000000) * 0x100000000
      : dueOrders.length
        ? Math.floor(dueOrders[0].order / 0x100000000) * 0x100000000
        : 10 * 0x100000000;
    const orderById = new Map(promotionOrderUpdates({
      dueReminders: dueOrders,
      existingHeadlines: headlineOrders,
      lowerBound,
      step: 0x100,
    }).map((update) => [update.id, legacyPriorityValue(update.order)]));
    const updatedAt = new Date();
    const operations = [
      ...existingHeadlines.flatMap((task) => {
        const priorityIndex = orderById.get(task._id.toHexString());
        return priorityIndex && priorityIndex !== task.priority_index
          ? [{
              updateOne: {
                filter: {
                  _id: task._id,
                  is_active: true,
                  is_deleted: false,
                  task_type: { $ne: "S" },
                  user_id: MONGO_LEGACY_USER_ID,
                },
                update: { $set: { priority_index: priorityIndex, updated_date: updatedAt } },
              },
            }]
          : [];
      }),
      ...dueReminders.map((task) => ({
        updateOne: {
          filter: {
            _id: task._id,
            is_active: true,
            is_deleted: false,
            task_type: "S",
            user_id: MONGO_LEGACY_USER_ID,
          },
          update: {
            $set: {
              priority_index: orderById.get(task._id.toHexString()),
              task_date: today,
              task_type: "H",
              updated_date: updatedAt,
            },
          },
        },
      })),
    ];
    const result = await this.dependencies.collection.bulkWrite(operations);
    if (result.matchedCount === operations.length) return true;
    return await this.dependencies.collection.countDocuments({
      ...mongoActiveFilter(),
      _id: { $in: dueReminders.map((task) => task._id) },
      task_type: "S",
    }) === 0;
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
      if (existing.task_type === "A" && input.playType === "reminder") return false;
      const values = mongoEditableSet({
        baskets: this.dependencies.baskets,
        existingTaskType: existing.task_type,
        input,
        playerResourceName,
      });
      if (existing.task_type !== "S" && input.playType === "reminder") {
        const latestReminder = await this.dependencies.collection.findOne(
          {
            ...mongoActiveFilter(),
            _id: { $ne: existing._id },
            task_date: legacyTaskDate(input, this.dependencies.baskets),
            task_type: "S",
          },
          { projection: { priority_index: 1 }, sort: { priority_index: -1 } },
        );
        values.priority_index = nextLegacyPriorityIndex(latestReminder?.priority_index);
      }
      const result = await this.dependencies.collection.updateOne(filter, {
        $set: values,
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

  async reposition({
    beforePlayId,
    placement,
    playIds,
  }: RepositionPlaysRequest) {
    let objectIds: ObjectId[];
    try {
      objectIds = playIds.map((playId) => {
        if (!ObjectId.isValid(playId)) throw new Error("Invalid Play identifier.");
        return new ObjectId(playId);
      });
    } catch {
      return false;
    }

    const selectedTasks = await this.dependencies.collection
      .find({
        ...mongoActiveFilter(),
        _id: { $in: objectIds },
      })
      .toArray();
    if (selectedTasks.length !== playIds.length) return false;

    const destinationDate = legacyPlacementDate(placement, this.dependencies.baskets);
    const destinationTasks = await this.dependencies.collection
      .find({
        ...mongoActiveFilter(),
        task_date: mongoPlacementDateFilter(placement, this.dependencies.baskets),
      })
      .sort({ priority_index: 1, created_date: 1, _id: 1 })
      .toArray();
    if (
      beforePlayId &&
      !destinationTasks.some((task) => task._id.toHexString() === beforePlayId)
    ) {
      return false;
    }
    const selectedById = new Map(
      selectedTasks.map((task) => [task._id.toHexString(), task]),
    );
    const updates = new Map<string, Record<string, unknown>>();

    for (const playType of ["normal", "reminder"] as const) {
      const movingPlayIds = playIds.filter(
        (playId) => mongoPlayType(selectedById.get(playId)?.task_type) === playType,
      );
      if (!movingPlayIds.length) continue;
      const typeTasks = destinationTasks.filter(
        (task) => mongoPlayType(task.task_type) === playType,
      );
      const orderedTypeTasks = typeTasks.map((task, index) => ({
        id: task._id.toHexString(),
        order: legacyPriorityNumber(task.priority_index, (index + 1) * 0x100),
      }));
      const lowerBound = orderedTypeTasks.length
        ? Math.floor(orderedTypeTasks[0].order / 0x100000000) * 0x100000000
        : 10 * 0x100000000;
      const orderUpdates = orderUpdatesForInsertion({
        beforePlayId: beforePlayId && mongoPlayType(
          destinationTasks.find((task) => task._id.toHexString() === beforePlayId)?.task_type,
        ) === playType
          ? beforePlayId
          : null,
        destination: orderedTypeTasks,
        lowerBound,
        movingPlayIds,
        step: 0x100,
      });

      for (const update of orderUpdates) {
        const task = selectedById.get(update.id) ??
          destinationTasks.find((candidate) => candidate._id.toHexString() === update.id);
        const priorityIndex = legacyPriorityValue(update.order);
        if (task?.priority_index !== priorityIndex) {
          updates.set(update.id, { priority_index: priorityIndex });
        }
      }
    }

    for (const playId of playIds) {
      const task = selectedById.get(playId);
      if (!task) return false;
      const sourceDate = task.task_date instanceof Date ? task.task_date.getTime() : NaN;
      if (sourceDate !== destinationDate.getTime()) {
        updates.set(playId, {
          ...(updates.get(playId) ?? {}),
          task_date: destinationDate,
        });
      }
    }

    if (!updates.size) return true;
    const updatedAt = new Date();
    const result = await this.dependencies.collection.bulkWrite(
      [...updates].map(([playId, values]) => ({
        updateOne: {
          filter: {
            _id: new ObjectId(playId),
            is_active: true,
            is_deleted: false,
            user_id: MONGO_LEGACY_USER_ID,
          },
          update: { $set: { ...values, updated_date: updatedAt } },
        },
      })),
    );
    return result.matchedCount === updates.size;
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
