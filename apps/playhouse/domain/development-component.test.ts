import { describe, expect, it } from "vitest";

import {
  moveDevelopmentComponent,
  parseDevelopmentComponentInput,
  parseDevelopmentComponentOrder,
} from "./development-component";

const one = "684fa2ea-3077-47a4-b288-0ecf634ddf5f";
const two = "f287f542-f896-42b9-8711-8e221e59a779";

describe("development component input", () => {
  it("normalizes a supported icon, name, and visibility", () => {
    expect(parseDevelopmentComponentInput({ hidden: true, icon: "mail", name: "  Messaging  " }))
      .toEqual({ input: { hidden: true, icon: "mail", name: "Messaging" }, ok: true });
  });

  it("rejects arbitrary icons and invalid visibility", () => {
    expect(parseDevelopmentComponentInput({ hidden: false, icon: "uploaded-image", name: "Area" }).ok)
      .toBe(false);
    expect(parseDevelopmentComponentInput({ hidden: "false", icon: "mail", name: "Area" }).ok)
      .toBe(false);
  });

  it("accepts a unique stable-ID order and rejects duplicates", () => {
    expect(parseDevelopmentComponentOrder({ componentIds: [one, two] })).toEqual([one, two]);
    expect(parseDevelopmentComponentOrder({ componentIds: [one, one] })).toBeNull();
  });

  it("moves components upward and downward without changing their IDs", () => {
    const three = "25f99b47-e68d-43fe-b6e2-0ded706d8f6e";
    expect(moveDevelopmentComponent([one, two, three], three, one, "before"))
      .toEqual([three, one, two]);
    expect(moveDevelopmentComponent([one, two, three], one, three, "after"))
      .toEqual([two, three, one]);
  });

  it("leaves component order unchanged for invalid or self drops", () => {
    expect(moveDevelopmentComponent([one, two], one, one, "before")).toEqual([one, two]);
    expect(moveDevelopmentComponent([one, two], "missing", two, "after")).toEqual([one, two]);
  });
});
