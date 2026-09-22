import { ObjectId } from "mongodb";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { selectGmailMatchCandidates } from "./mongo-incoming-event-store";

describe("Mongo incoming Gmail candidate selection", () => {
  it("keeps every active Play intentionally linked to the same API thread", () => {
    const first = {
      _id: new ObjectId(),
      carnival_google: { gmail_api_thread_id: "api-thread-x" },
    };
    const second = {
      _id: new ObjectId(),
      carnival_google: { gmail_attachment: { api_thread_id: "api-thread-x" } },
    };

    expect(selectGmailMatchCandidates(
      [first, second],
      "api-thread-x",
      [],
    )).toEqual([first, second]);
  });

  it("does not include a legacy-only candidate when exact API-thread matches exist", () => {
    const exact = {
      _id: new ObjectId(),
      carnival_google: { gmail_api_thread_id: "api-thread-x" },
    };
    const legacy = { _id: new ObjectId(), thread_id: "api-thread-x" };

    expect(selectGmailMatchCandidates(
      [legacy, exact],
      "api-thread-x",
      [],
    )).toEqual([exact]);
  });
});
