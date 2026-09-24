export const DEVELOPMENT_STATUSES = [
  "Idea",
  "Planned",
  "Ready",
  "Building",
  "Testing",
  "Done",
] as const;

export const DEVELOPMENT_PRIORITIES = ["High", "Medium", "Low"] as const;

export const DEVELOPMENT_ICON_IDS = [
  "grid",
  "house",
  "roller",
  "mail",
  "calendar",
  "slack",
  "people",
  "extension",
  "mobile",
  "incoming",
  "logger",
  "sparkles",
  "settings",
] as const;

export type DevelopmentComponent = string;
export type DevelopmentIconId = (typeof DEVELOPMENT_ICON_IDS)[number];
export type DevelopmentStatus = (typeof DEVELOPMENT_STATUSES)[number];
export type DevelopmentPriority = (typeof DEVELOPMENT_PRIORITIES)[number];

export type DevelopmentComponentRecord = {
  createdAt: string;
  hidden: boolean;
  icon: DevelopmentIconId;
  id: string;
  name: string;
  sortOrder: number;
  updatedAt: string;
};

export type DevelopmentFeature = {
  component: DevelopmentComponent;
  componentId: string;
  createdAt: string;
  dependencies: string[];
  description: string;
  id: string;
  notes: string;
  priority: DevelopmentPriority;
  sequence: number | null;
  status: DevelopmentStatus;
  title: string;
  updatedAt: string;
};

export type DevelopmentFeatureInput = Pick<
  DevelopmentFeature,
  | "componentId"
  | "dependencies"
  | "description"
  | "notes"
  | "priority"
  | "sequence"
  | "status"
  | "title"
>;

export type DevelopmentFeatureFilters = {
  componentId: string | "all";
  priority: DevelopmentPriority | "All Priorities";
  query: string;
  status: DevelopmentStatus | "All Statuses";
};

const FEATURE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isDevelopmentFeatureId(value: string) {
  return FEATURE_ID_PATTERN.test(value);
}

function normalizedString(value: unknown, maximum: number) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function isOneOf<T extends readonly string[]>(values: T, value: unknown): value is T[number] {
  return typeof value === "string" && values.includes(value);
}

export function parseDevelopmentFeatureInput(
  value: unknown,
): { input: DevelopmentFeatureInput; ok: true } | { error: string; ok: false } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { error: "Feature details are required.", ok: false };
  }
  const candidate = value as Record<string, unknown>;
  const title = normalizedString(candidate.title, 160);
  const description = normalizedString(candidate.description, 2_000);
  const notes = normalizedString(candidate.notes, 4_000);
  if (!title || !description) {
    return { error: "Title and description are required.", ok: false };
  }
  if (typeof candidate.componentId !== "string" || !isDevelopmentFeatureId(candidate.componentId)) {
    return { error: "Choose a valid component.", ok: false };
  }
  if (!isOneOf(DEVELOPMENT_STATUSES, candidate.status)) {
    return { error: "Choose a valid status.", ok: false };
  }
  if (!isOneOf(DEVELOPMENT_PRIORITIES, candidate.priority)) {
    return { error: "Choose a valid priority.", ok: false };
  }
  const sequence = candidate.sequence === "" || candidate.sequence === null ||
      candidate.sequence === undefined
    ? null
    : Number(candidate.sequence);
  if (sequence !== null && (!Number.isSafeInteger(sequence) || sequence < 0 || sequence > 999_999)) {
    return { error: "Sequence must be a whole number between 0 and 999999.", ok: false };
  }
  if (!Array.isArray(candidate.dependencies)) {
    return { error: "Dependencies must be a list of feature IDs.", ok: false };
  }
  const dependencies = Array.from(new Set(candidate.dependencies));
  if (dependencies.length > 100 || dependencies.some(
    (dependency) => typeof dependency !== "string" || !isDevelopmentFeatureId(dependency),
  )) {
    return { error: "One or more dependencies are invalid.", ok: false };
  }
  return {
    input: {
      componentId: candidate.componentId,
      dependencies: dependencies as string[],
      description,
      notes,
      priority: candidate.priority,
      sequence,
      status: candidate.status,
      title,
    },
    ok: true,
  };
}

export function sortDevelopmentFeatures(features: DevelopmentFeature[]) {
  return [...features].sort((left, right) => {
    if (left.sequence === null && right.sequence !== null) return 1;
    if (left.sequence !== null && right.sequence === null) return -1;
    if (left.sequence !== null && right.sequence !== null && left.sequence !== right.sequence) {
      return left.sequence - right.sequence;
    }
    return left.createdAt.localeCompare(right.createdAt) || left.title.localeCompare(right.title);
  });
}

export function filterDevelopmentFeatures(
  features: DevelopmentFeature[],
  filters: DevelopmentFeatureFilters,
) {
  const query = filters.query.trim().toLocaleLowerCase();
  return sortDevelopmentFeatures(features.filter((feature) => {
    if (filters.componentId !== "all" && feature.componentId !== filters.componentId) return false;
    if (filters.status !== "All Statuses" && feature.status !== filters.status) return false;
    if (filters.priority !== "All Priorities" && feature.priority !== filters.priority) return false;
    if (!query) return true;
    return [feature.title, feature.description, feature.notes]
      .some((field) => field.toLocaleLowerCase().includes(query));
  }));
}
