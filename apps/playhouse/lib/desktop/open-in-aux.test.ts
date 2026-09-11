import { describe, expect, it, vi } from "vitest";

import {
  OPEN_IN_AUX_MESSAGE_SOURCE,
  OPEN_IN_AUX_MESSAGE_TYPE,
  openInAux,
} from "./open-in-aux";

describe("openInAux", () => {
  it("hands the exact destination to the Carnival desktop bridge", () => {
    const postMessage = vi.fn();

    openInAux("https://mail.google.com/mail/u/0/#all/thread%2F123", {
      location: { origin: "https://carnival-playhouse.vercel.app" } as Location,
      postMessage,
    });

    expect(postMessage).toHaveBeenCalledWith({
      source: OPEN_IN_AUX_MESSAGE_SOURCE,
      type: OPEN_IN_AUX_MESSAGE_TYPE,
      url: "https://mail.google.com/mail/u/0/#all/thread%2F123",
    }, "https://carnival-playhouse.vercel.app");
  });
});
