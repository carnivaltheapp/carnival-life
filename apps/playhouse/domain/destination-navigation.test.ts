import { describe, expect, it } from "vitest";

import {
  destinationNavigationModeForView,
  toggleDestinationNavigationMode,
} from "./destination-navigation";

describe("PlayHouse destination navigation", () => {
  it("opens Basket navigation for Basket routes and Calendar navigation otherwise", () => {
    expect(destinationNavigationModeForView("basket")).toBe("baskets");
    expect(destinationNavigationModeForView("calendar")).toBe("calendar");
    expect(destinationNavigationModeForView("all")).toBe("calendar");
  });

  it("alternates Calendar and Baskets without a Play mutation", () => {
    expect(toggleDestinationNavigationMode("calendar")).toBe("baskets");
    expect(toggleDestinationNavigationMode("baskets")).toBe("calendar");
  });
});
