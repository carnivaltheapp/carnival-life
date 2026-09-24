import { describe, expect, it } from "vitest";

import { parseSubmittedPlayerReferences } from "./player-references";

describe("multi-Player reference input", () => {
  it("accepts contact and group references without group member snapshots", () => {
    expect(parseSubmittedPlayerReferences(JSON.stringify([
      {
        displayName: "David",
        id: "33333333-3333-4333-8333-333333333333",
        kind: "contact",
        resourceName: "people/david",
      },
      {
        displayName: "Family",
        kind: "group",
        memberCount: 2,
        members: [{ resourceName: "people/one" }],
        resourceName: "contactGroups/family",
      },
    ]))).toEqual([
      {
        contactId: "33333333-3333-4333-8333-333333333333",
        displayName: "David",
        kind: "contact",
        resourceName: "people/david",
      },
      { displayName: "Family", kind: "group", resourceName: "contactGroups/family" },
    ]);
  });

  it("rejects duplicate or malformed references", () => {
    const group = { displayName: "Family", kind: "group", resourceName: "contactGroups/family" };
    expect(parseSubmittedPlayerReferences(JSON.stringify([group, group]))).toBeNull();
    expect(parseSubmittedPlayerReferences(JSON.stringify([{ ...group, resourceName: "not-a-group" }]))).toBeNull();
  });

  it("preserves the legacy missing-field path", () => {
    expect(parseSubmittedPlayerReferences(null)).toBeUndefined();
  });
});
