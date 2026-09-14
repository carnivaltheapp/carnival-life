import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  descriptionIsTruncated,
  descriptionTooltipPosition,
} from "./play-description-tooltip";

const playForm = readFileSync(new URL("./play-form.tsx", import.meta.url), "utf8");
const stylesheet = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

describe("Play Description hover bubble", () => {
  it("shows only for a truncated Description", () => {
    expect(descriptionIsTruncated({ clientWidth: 180, scrollWidth: 320 })).toBe(true);
    expect(descriptionIsTruncated({ clientWidth: 180, scrollWidth: 180 })).toBe(false);
  });

  it("places the bubble above when possible and keeps it inside the viewport", () => {
    expect(descriptionTooltipPosition(
      { bottom: 220, left: 700, top: 200 },
      800,
    )).toEqual({ left: 368, placement: "above", top: 194 });
    expect(descriptionTooltipPosition(
      { bottom: 46, left: 4, top: 24 },
      800,
    )).toEqual({ left: 12, placement: "below", top: 52 });
  });

  it("wraps full text without intercepting pointer events", () => {
    expect(stylesheet).toMatch(/\.descriptionHoverBubble\s*\{[\s\S]*?overflow-wrap: anywhere;/);
    expect(stylesheet).toMatch(/\.descriptionHoverBubble\s*\{[\s\S]*?pointer-events: none;/);
    expect(stylesheet).toMatch(/\.descriptionHoverBubble\s*\{[\s\S]*?white-space: normal;/);
    expect(playForm).toContain("onMouseLeave={isEditing ? () => setDescriptionTooltip(null)");
  });

  it("leaves the established single-click and double-click actions in place", () => {
    expect(playForm).toContain("descriptionClick.singleClick(");
    expect(playForm).toContain("routePlayDescriptionAux(play, slackUrl)");
    expect(playForm).toContain("descriptionClick.doubleClick(() =>");
    expect(playForm).toContain("detailsRef.current.open = true");
  });
});
