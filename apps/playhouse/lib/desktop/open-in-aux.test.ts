import { describe, expect, it, vi } from "vitest";

import {
  OPEN_IN_AUX_MESSAGE_SOURCE,
  OPEN_IN_AUX_MESSAGE_TYPE,
  OPEN_IN_AUX_RESULT_SOURCE,
  OPEN_IN_AUX_RESULT_TYPE,
  openInAux,
  openInAuxAndWait,
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

  it("waits for the existing bridge to finish one route", async () => {
    let listener: ((event: MessageEvent) => void) | undefined;
    const target = {
      addEventListener: vi.fn((_type: string, value: EventListenerOrEventListenerObject) => {
        listener = value as (event: MessageEvent) => void;
      }),
      location: { origin: "https://carnival-playhouse.vercel.app" } as Location,
      postMessage: vi.fn((message: { requestId: string }) => {
        queueMicrotask(() => listener?.({
          data: {
            ok: true,
            requestId: message.requestId,
            source: OPEN_IN_AUX_RESULT_SOURCE,
            type: OPEN_IN_AUX_RESULT_TYPE,
          },
          origin: "https://carnival-playhouse.vercel.app",
          source: target,
        } as unknown as MessageEvent));
      }),
      removeEventListener: vi.fn(),
    };

    await expect(openInAuxAndWait("https://example.com", target as never)).resolves.toBe(true);
    expect(target.postMessage).toHaveBeenCalledOnce();
    expect(target.removeEventListener).toHaveBeenCalledOnce();
  });
});
