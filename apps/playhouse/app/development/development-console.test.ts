import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const page = await readFile(new URL("./page.tsx", import.meta.url), "utf8");
const consoleSource = await readFile(new URL("./development-console.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("./development.module.css", import.meta.url), "utf8");
const collectionRoute = await readFile(
  new URL("../api/development/features/route.ts", import.meta.url),
  "utf8",
);
const itemRoute = await readFile(
  new URL("../api/development/features/[featureId]/route.ts", import.meta.url),
  "utf8",
);
const componentCollectionRoute = await readFile(
  new URL("../api/development/components/route.ts", import.meta.url),
  "utf8",
);
const componentItemRoute = await readFile(
  new URL("../api/development/components/[componentId]/route.ts", import.meta.url),
  "utf8",
);
const componentReorderRoute = await readFile(
  new URL("../api/development/components/reorder/route.ts", import.meta.url),
  "utf8",
);
const featureReorderRoute = await readFile(
  new URL("../api/development/features/reorder/route.ts", import.meta.url),
  "utf8",
);
const featureComponentRoute = await readFile(
  new URL("../api/development/features/[featureId]/component/route.ts", import.meta.url),
  "utf8",
);
const roadmapRoute = await readFile(
  new URL("../api/development/roadmap/route.ts", import.meta.url),
  "utf8",
);

describe("Carnival Development Console contract", () => {
  it("is a direct dynamic /development route within the existing PlayHouse deployment", () => {
    expect(page).toContain('export const dynamic = "force-dynamic"');
    expect(page).toContain("<DevelopmentConsole");
    expect(page).toContain("MongoDevelopmentFeatureRepository");
  });

  it("contains the approved heading, subtitle, sidebar, filters, table, and feature editor", () => {
    expect(consoleSource).toContain("Carnival Development");
    expect(consoleSource).toContain("Features, priorities &amp; development sequence");
    expect(consoleSource).toContain("All Features");
    expect(consoleSource).toContain("Search features...");
    expect(consoleSource).toContain("All Statuses");
    expect(consoleSource).toContain("All Priorities");
    expect(consoleSource).toContain("New Feature");
    expect(consoleSource).toContain("Save Changes");
    expect(consoleSource).toContain("Confirm Delete");
    expect(consoleSource).toContain("Edit Components");
    expect(consoleSource).toContain("All Features is a permanent system view and is not editable.");
    expect(consoleSource).toContain("Move Features & Delete");
    expect(consoleSource).toContain("filterDevelopmentFeatures");
  });

  it("renders navigation and the feature component selector from persisted component records", () => {
    expect(page).toContain("initialComponents={state.components}");
    expect(consoleSource).toContain("visibleComponents.map");
    expect(consoleSource).toContain("!item.hidden || item.id === draft.componentId");
    expect(consoleSource).toContain("value={item.id}");
    expect(consoleSource).not.toContain("const DEVELOPMENT_COMPONENTS");
  });

  it("shows searchable human feature references with an isolated public-link copy control", () => {
    expect(consoleSource).toContain("feature.featureId");
    expect(consoleSource).toContain("new URL(`/development/${featureId}`, window.location.origin)");
    expect(consoleSource).toContain("navigator.clipboard.writeText(featureUrl)");
    expect(consoleSource).toContain('aria-label={`Copy link to ${feature.featureId}`}');
    expect(consoleSource).toContain('href={`/development/${feature.featureId}`}');
    expect(consoleSource).toContain('target="_blank"');
    expect(consoleSource).toContain("draggable={false}");
    expect(consoleSource).toContain("onMouseDown={(event) => event.stopPropagation()}");
    expect(consoleSource).toContain("event.stopPropagation()");
    expect(consoleSource).toContain('<em role="status">Link copied</em>');
    expect(css).toContain(".featureReference");
  });

  it("updates component URLs and copies isolated public component links", () => {
    expect(consoleSource).toContain("developmentComponentSlug(component.name)");
    expect(consoleSource).toContain("window.history.pushState");
    expect(consoleSource).toContain("window.history.replaceState");
    expect(consoleSource).toContain("window.addEventListener(\"popstate\"");
    expect(consoleSource).toContain("navigator.clipboard.writeText(componentUrl)");
    expect(consoleSource).toContain('aria-label={`Copy link to ${item.name} component`}');
    expect(consoleSource).toContain("copyComponentLink(event, item)");
    expect(consoleSource).toContain('<span className={styles.componentCopyStatus} role="status">Link copied</span>');
    expect(css).toContain(".componentCopyButton");
  });

  it("uses an unrestricted auto-growing Notes editor without expanding roadmap rows", () => {
    expect(consoleSource).toContain("sizeNotesTextarea");
    expect(consoleSource).toContain("className={styles.notesTextarea}");
    expect(consoleSource).toContain("ref={sizeNotesTextarea}");
    expect(consoleSource).not.toContain("maxLength={4000}");
    expect(css).toContain(".formGrid .notesTextarea");
    expect(css).toContain("max-height: 55vh");
    expect(consoleSource.match(/feature\.notes/g)).toHaveLength(1);
  });

  it("supports optimistic feature reorder and component drops with filter-safe rollback", () => {
    expect(consoleSource).toContain("moveDevelopmentFeature");
    expect(consoleSource).toContain("reorderVisibleDevelopmentFeatures");
    expect(consoleSource).toContain("Clear search, status, and priority filters to reorder");
    expect(consoleSource).toContain('fetch("/api/development/features/reorder"');
    expect(consoleSource).toContain("setFeatures(previous)");
    expect(consoleSource).toContain("moveFeatureToComponent(item.id)");
    expect(css).toContain('[data-drop-edge="before"]');
    expect(css).toContain(".navDropTarget");
  });

  it("uses a responsive table layout and restrained status/priority pill colors", () => {
    expect(css).toContain("grid-template-columns: 254px minmax(0, 1fr)");
    expect(css).toContain(".tableCard table");
    expect(css).toContain(".priorityHigh");
    expect(css).toContain(".priorityMedium");
    expect(css).toContain(".priorityLow");
    expect(css).toContain("@media (max-width: 720px)");
  });

  it("exposes authenticated clean-JSON list/get/create/update/delete endpoints", () => {
    expect(collectionRoute).toContain("authenticatedDevelopmentOwner()");
    expect(collectionRoute).toContain("export async function GET");
    expect(collectionRoute).toContain("export async function POST");
    expect(itemRoute).toContain("export async function GET");
    expect(itemRoute).toContain("export async function PATCH");
    expect(itemRoute).toContain("export async function DELETE");
    expect(itemRoute).toContain("ownerUserId");
    expect(itemRoute).toContain('"Cache-Control": "private, no-store"');
  });

  it("exposes owner-scoped component CRUD and exact-set reordering endpoints", () => {
    expect(componentCollectionRoute).toContain("authenticatedDevelopmentOwner()");
    expect(componentCollectionRoute).toContain("export async function GET");
    expect(componentCollectionRoute).toContain("export async function POST");
    expect(componentItemRoute).toContain("export async function GET");
    expect(componentItemRoute).toContain("export async function PATCH");
    expect(componentItemRoute).toContain("export async function DELETE");
    expect(componentItemRoute).toContain('result.reason === "component_in_use"');
    expect(componentReorderRoute).toContain("reorderComponents(ownerUserId, componentIds)");
  });

  it("supports optimistic drag ordering for visible and hidden components", () => {
    expect(consoleSource).toContain("moveDevelopmentComponent");
    expect(consoleSource).toContain('aria-label={`Reorder ${item.name}`}');
    expect(consoleSource).toContain("draggable={!componentSavingId}");
    expect(consoleSource).toContain("components.map((item, index)");
    expect(consoleSource).toContain('fetch("/api/development/components/reorder"');
    expect(consoleSource).toContain("setComponents(previous)");
    expect(consoleSource).toContain("componentRowDropTarget");
    expect(css).toContain('.componentEditorRow[data-drop-edge="before"]');
    expect(css).toContain('.componentEditorRow[data-drop-edge="after"]');
    expect(consoleSource).not.toContain("Reorder All Features");
  });

  it("exposes owner-scoped global feature reorder and component reassignment endpoints", () => {
    expect(featureReorderRoute).toContain("authenticatedDevelopmentOwner()");
    expect(featureReorderRoute).toContain("reorderFeatures(ownerUserId, featureIds)");
    expect(featureComponentRoute).toContain("authenticatedDevelopmentOwner()");
    expect(featureComponentRoute).toContain("moveFeatureToComponent(ownerUserId, featureId, componentId)");
  });

  it("keeps machine roadmap access GET-only and separate from browser CRUD", () => {
    expect(roadmapRoute).toContain("CARNIVAL_ROADMAP_READ_TOKEN");
    expect(roadmapRoute).toContain("export async function GET");
    expect(roadmapRoute).not.toMatch(/export async function (POST|PUT|PATCH|DELETE)/);
    expect(collectionRoute).toContain("authenticatedDevelopmentOwner()");
  });
});
