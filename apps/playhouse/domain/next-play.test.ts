import { describe, expect, it } from "vitest";

import { parseNewNextPlayInput, validateNextRelationship } from "./next-play";

function nextForm(overrides: Record<string, string> = {}) {
  const formData = new FormData();
  const values = {
    nextBasketId: "",
    nextPlacementKind: "calendar",
    nextPlayType: "normal",
    nextScheduledDate: "2026-08-27",
    nextTitle: "Follow up",
    ...overrides,
  };
  Object.entries(values).forEach(([key, value]) => formData.set(key, value));
  return formData;
}

describe("next relationship validation", () => {
  const edges = [
    { fromPlayId: "a", toPlayId: "b" },
    { fromPlayId: "b", toPlayId: "c" },
  ];

  it("rejects self-reference", () => {
    expect(validateNextRelationship({ edges, fromPlayId: "a", toPlayId: "a" })).toEqual({
      message: "A Play cannot point to itself.",
      valid: false,
    });
  });

  it("rejects an obvious cycle", () => {
    expect(validateNextRelationship({ edges, fromPlayId: "c", toPlayId: "a" })).toEqual({
      message: "That relationship would create a cycle.",
      valid: false,
    });
  });

  it("allows changing an outgoing relationship without following its old edge", () => {
    expect(validateNextRelationship({ edges, fromPlayId: "a", toPlayId: "c" })).toEqual({
      status: "changed",
      valid: true,
    });
  });

  it("recognizes unchanged and removed relationships", () => {
    expect(validateNextRelationship({ edges, fromPlayId: "a", toPlayId: "b" })).toEqual({
      status: "unchanged",
      valid: true,
    });
    expect(validateNextRelationship({ edges, fromPlayId: "a", toPlayId: null })).toEqual({
      status: "removed",
      valid: true,
    });
  });
});

describe("new next Play validation", () => {
  it("accepts a dated next Play", () => {
    expect(parseNewNextPlayInput(nextForm())).toEqual({
      data: {
        placement: { kind: "calendar", scheduledDate: "2026-08-27" },
        playType: "normal",
        title: "Follow up",
      },
      success: true,
    });
  });

  it("accepts a Basket next Play", () => {
    expect(
      parseNewNextPlayInput(
        nextForm({
          nextBasketId: "11111111-1111-4111-8111-111111111111",
          nextPlacementKind: "basket",
          nextPlayType: "reminder",
          nextScheduledDate: "",
        }),
      ),
    ).toMatchObject({
      data: {
        placement: {
          basketId: "11111111-1111-4111-8111-111111111111",
          kind: "basket",
        },
        playType: "reminder",
      },
      success: true,
    });
  });

  it("requires a title and exactly one valid placement", () => {
    expect(parseNewNextPlayInput(nextForm({ nextTitle: "" }))).toMatchObject({
      errors: { title: expect.any(String) },
      success: false,
    });
    expect(
      parseNewNextPlayInput(
        nextForm({
          nextBasketId: "11111111-1111-4111-8111-111111111111",
        }),
      ),
    ).toMatchObject({
      errors: { placement: expect.any(String) },
      success: false,
    });
  });
});
