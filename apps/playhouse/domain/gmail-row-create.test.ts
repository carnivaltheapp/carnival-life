import { describe, expect, it } from "vitest";

import type { PlayListItem } from "./play";
import {
  claimGmailRowCreate,
  gmailRowCreateInput,
  mergeCreatedGmailPlay,
  parseGmailRowCreateRequest,
} from "./gmail-row-create";

const base = {
  correlationId: "drop-1",
  subject: "Quarterly planning",
  targetPlayId: "target-1",
  url: "https://mail.google.com/mail/u/2/#inbox/FMfcExact",
};

function target(overrides: Partial<PlayListItem> = {}): PlayListItem {
  return {
    basketId: null,
    branch: null,
    durationMinutes: 30,
    id: "target-1",
    nextPlayId: null,
    note: null,
    place: "Office",
    playerContactId: null,
    playerDisplayName: null,
    playType: "normal",
    pushRule: "weekdays",
    scheduledDate: "2026-09-14",
    sourceType: "user",
    title: "Template",
    url: null,
    ...overrides,
  };
}

describe("Gmail row-create input", () => {
  it("inherits a Headline target's date and rank but always uses Everyday Push", () => {
    const parsed = parseGmailRowCreateRequest(base);
    expect(parsed).not.toBeNull();
    expect(gmailRowCreateInput(parsed!, target())).toMatchObject({
      placement: { kind: "calendar", scheduledDate: "2026-09-14" },
      playType: "normal",
      pushRule: "everyday",
      title: "Quarterly planning",
    });
  });

  it("inherits a Reminder target's Basket and rank", () => {
    const parsed = parseGmailRowCreateRequest({
      ...base,
      gmailParticipants: {
        from: { email: "sender@example.com", name: "Sender" },
        to: [{ email: "owner@example.com", name: "Owner" }],
      },
    });
    expect(parsed).toMatchObject({
      gmailParticipants: { from: { email: "sender@example.com", name: "Sender" } },
    });
    expect(gmailRowCreateInput(parsed!, target({
      basketId: "11111111-1111-4111-8111-111111111111",
      playType: "reminder",
      scheduledDate: null,
    }))).toMatchObject({
      placement: { basketId: "11111111-1111-4111-8111-111111111111", kind: "basket" },
      playType: "reminder",
      pushRule: "everyday",
    });
  });

  it.each([
    [{ ...base, subject: "" }],
    [{ ...base, targetPlayId: "" }],
    [{ ...base, url: "https://example.com/not-gmail" }],
  ])("rejects missing required metadata", (request) => {
    expect(parseGmailRowCreateRequest(request)).toBeNull();
  });

  it("rejects an Appointment or malformed target placement", () => {
    const parsed = parseGmailRowCreateRequest(base)!;
    expect(gmailRowCreateInput(parsed, target({ legacyTaskType: "A" }))).toBeNull();
    expect(gmailRowCreateInput(parsed, target({ scheduledDate: null }))).toBeNull();
  });

  it("claims one correlation ID only once", () => {
    const processed = new Set<string>();
    expect(claimGmailRowCreate(processed, "drop-1")).toBe(true);
    expect(claimGmailRowCreate(processed, "drop-1")).toBe(false);
  });

  it("inserts a created Play immediately in natural rank order without duplicates", () => {
    const targetPlay = target({ id: "target", sortOrder: 20 });
    const reminder = target({ id: "reminder", playType: "reminder", sortOrder: 10 });
    const createdPlay = target({
      id: "created",
      sourceType: "gmail",
      sortOrder: 5,
      title: "Created from Gmail",
    });
    const options = {
      baskets: [],
      createdPlay,
      searchQuery: "",
      selectedView: {
        endDate: "2026-09-14",
        key: "date" as const,
        kind: "calendar" as const,
        startDate: "2026-09-14",
      },
    };

    const inserted = mergeCreatedGmailPlay({
      ...options,
      plays: [targetPlay, reminder],
    });
    expect(inserted.map(({ id }) => id)).toEqual(["created", "target", "reminder"]);
    expect(inserted.find(({ id }) => id === "target")).toEqual(targetPlay);

    const revalidated = mergeCreatedGmailPlay({ ...options, plays: inserted });
    expect(revalidated.filter(({ id }) => id === "created")).toHaveLength(1);
  });

  it("renders a persisted Headline immediately before its exact target", () => {
    const plays = [
      target({ id: "a", sortOrder: 100, title: "A" }),
      target({ id: "b", sortOrder: 300, title: "B" }),
      target({ id: "c", sortOrder: 400, title: "C" }),
    ];
    const result = mergeCreatedGmailPlay({
      baskets: [],
      createdPlay: target({ id: "created", sortOrder: 200, title: "NEW" }),
      plays,
      searchQuery: "",
      selectedView: {
        endDate: "2026-09-14",
        key: "date",
        kind: "calendar",
        startDate: "2026-09-14",
      },
    });

    expect(result.map(({ title }) => title)).toEqual(["A", "NEW", "B", "C"]);
  });

  it("renders a persisted Reminder immediately before its exact target", () => {
    const plays = [
      target({ id: "x", playType: "reminder", sortOrder: 100, title: "X" }),
      target({ id: "y", playType: "reminder", sortOrder: 300, title: "Y" }),
      target({ id: "z", playType: "reminder", sortOrder: 400, title: "Z" }),
    ];
    const result = mergeCreatedGmailPlay({
      baskets: [],
      createdPlay: target({
        id: "created",
        playType: "reminder",
        sortOrder: 200,
        title: "NEW",
      }),
      plays,
      searchQuery: "",
      selectedView: {
        endDate: "2026-09-14",
        key: "date",
        kind: "calendar",
        startDate: "2026-09-14",
      },
    });

    expect(result.map(({ title }) => title)).toEqual(["X", "NEW", "Y", "Z"]);
  });

  it("does not force a returned Play into an unrelated destination or search", () => {
    const createdPlay = target({ id: "created", scheduledDate: "2026-09-15" });
    const selectedView = {
      endDate: "2026-09-14",
      key: "date" as const,
      kind: "calendar" as const,
      startDate: "2026-09-14",
    };

    expect(mergeCreatedGmailPlay({
      baskets: [],
      createdPlay,
      plays: [],
      searchQuery: "",
      selectedView,
    })).toEqual([]);
    expect(mergeCreatedGmailPlay({
      baskets: [],
      createdPlay: { ...createdPlay, scheduledDate: "2026-09-14" },
      plays: [],
      searchQuery: "not the subject",
      selectedView,
    })).toEqual([]);
  });

  it("inserts only into the matching Basket view", () => {
    const createdPlay = target({
      basketId: "11111111-1111-4111-8111-111111111111",
      id: "created",
      scheduledDate: null,
    });
    const result = mergeCreatedGmailPlay({
      baskets: [],
      createdPlay,
      plays: [],
      searchQuery: "",
      selectedView: {
        basket: { id: "11111111-1111-4111-8111-111111111111" },
        kind: "basket",
      },
    });

    expect(result).toEqual([createdPlay]);
    expect(mergeCreatedGmailPlay({
      baskets: [],
      createdPlay,
      plays: [],
      searchQuery: "",
      selectedView: {
        basket: { id: "22222222-2222-4222-8222-222222222222" },
        kind: "basket",
      },
    })).toEqual([]);
  });
});
