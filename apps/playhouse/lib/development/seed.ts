import type {
  DevelopmentComponentRecord,
  DevelopmentFeatureInput,
} from "../../domain/development-feature";

export const DEVELOPMENT_DEMO_SEED_VERSION = 1;
export const DEVELOPMENT_COMPONENT_SEED_VERSION = 1;

export const DEFAULT_DEVELOPMENT_COMPONENTS: ReadonlyArray<
  Pick<DevelopmentComponentRecord, "icon" | "id" | "name" | "sortOrder">
> = [
  { icon: "house", id: "684fa2ea-3077-47a4-b288-0ecf634ddf5f", name: "PlayHouse", sortOrder: 0 },
  { icon: "roller", id: "f287f542-f896-42b9-8711-8e221e59a779", name: "Roller", sortOrder: 1 },
  { icon: "mail", id: "e6e439d1-b237-407d-86dc-86baa8366592", name: "Gmail", sortOrder: 2 },
  { icon: "calendar", id: "6af2dc4c-3004-4a7f-89e7-5f352926ab23", name: "Calendar", sortOrder: 3 },
  { icon: "slack", id: "b03dcd7d-015a-4c53-b40d-a112f22b870d", name: "Slack", sortOrder: 4 },
  { icon: "people", id: "f46700c1-c083-42c2-a74b-74f30c8f2e7c", name: "Contacts / Players", sortOrder: 5 },
  { icon: "extension", id: "9d288ba2-0388-47f9-888e-9e2529528913", name: "Chrome Extension", sortOrder: 6 },
  { icon: "mobile", id: "bdabfca8-ff95-4d1b-97ce-25b57e46f264", name: "Mobile / PWA", sortOrder: 7 },
  { icon: "incoming", id: "3584780b-2fd3-4aa9-8ae5-3ba4ca246cbe", name: "Incoming / Integrations", sortOrder: 8 },
  { icon: "logger", id: "16522463-67f5-4701-83c5-d6e96eaa8d2a", name: "Logger / Changelog", sortOrder: 9 },
  { icon: "sparkles", id: "28910726-4e1d-4b54-9717-d421cc102de8", name: "Carnival AI", sortOrder: 10 },
  { icon: "settings", id: "81b58e3c-10b1-4d91-bbaa-c6d2f44fb4c1", name: "Settings / Infrastructure", sortOrder: 11 },
];

const componentId = (name: string) => {
  const component = DEFAULT_DEVELOPMENT_COMPONENTS.find((item) => item.name === name);
  if (!component) throw new Error(`Unknown demo component: ${name}`);
  return component.id;
};

export const DEVELOPMENT_DEMO_FEATURES: ReadonlyArray<DevelopmentFeatureInput & { id: string }> = [
  {
    componentId: componentId("Gmail"), dependencies: [],
    description: "Attach Gmail conversations to Plays with a simple physical drag workflow.",
    id: "2eb76847-7998-4a10-8f58-629d3447f1d4",
    notes: "Demo roadmap entry — replace with approved requirements.", priority: "High", sequence: 1,
    status: "Done", title: "Drag Email into PlayHouse",
  },
  {
    componentId: componentId("Calendar"), dependencies: [],
    description: "Show relevant calendar events alongside dated Plays.",
    id: "205d0598-b93c-49e1-aec3-4dac945e6e0a",
    notes: "Demo roadmap entry — replace with approved requirements.", priority: "High", sequence: 2,
    status: "Planned", title: "Calendar Events in Plays",
  },
  {
    componentId: componentId("Roller"), dependencies: [],
    description: "Summarize the day's Roller decisions and explain important schedule changes.",
    id: "59b66238-f021-4bbb-94ee-d7b7fed800a6",
    notes: "Demo roadmap entry — replace with approved requirements.", priority: "Medium", sequence: 3,
    status: "Idea", title: "Roller Daily Summary",
  },
  {
    componentId: componentId("PlayHouse"), dependencies: [],
    description: "Create reusable starting points for recurring kinds of Plays.",
    id: "58e924f8-6655-49a0-acba-e1855d3135ba",
    notes: "Demo roadmap entry — replace with approved requirements.", priority: "Medium", sequence: 4,
    status: "Ready", title: "Play Templates",
  },
  {
    componentId: componentId("Slack"), dependencies: [],
    description: "Connect Slack conversations and people to Carnival context.",
    id: "cf9c7d41-1004-4ef3-b320-250105bd818a",
    notes: "Demo roadmap entry — replace with approved requirements.", priority: "Medium", sequence: 5,
    status: "Building", title: "Slack Integration",
  },
  {
    componentId: componentId("Mobile / PWA"), dependencies: [],
    description: "Deliver the first focused mobile PlayHouse experience.",
    id: "6416e0db-d259-4932-ad1e-3a132261a191",
    notes: "Demo roadmap entry — replace with approved requirements.", priority: "High", sequence: 6,
    status: "Planned", title: "Mobile App (MVP)",
  },
  {
    componentId: componentId("Chrome Extension"), dependencies: [],
    description: "Simplify and harden the browser bridge for Carnival's desktop workspace.",
    id: "af41eaef-225e-4d29-a384-da0931841dc7",
    notes: "Demo roadmap entry — replace with approved requirements.", priority: "Low", sequence: 7,
    status: "Testing", title: "Chrome Extension v2",
  },
  {
    componentId: componentId("Carnival AI"), dependencies: [],
    description: "Explore assistance grounded in Carnival Plays, sequence, and relationships.",
    id: "9dcd617f-011e-40d7-a49c-f0c72603d551",
    notes: "Demo roadmap entry — not an approved AI implementation requirement.", priority: "Low",
    sequence: null, status: "Idea", title: "AI Play Assistant",
  },
];
