import { describe, expect, it, vi } from "vitest";

import {
  TOGGLE_RIGHT_SURFACE_RESULT_SOURCE,
  TOGGLE_RIGHT_SURFACE_RESULT_TYPE,
  TOGGLE_RIGHT_SURFACE_SOURCE,
  TOGGLE_RIGHT_SURFACE_TYPE,
  toggleRightSurface,
} from "./toggle-right-surface";

describe("toggleRightSurface", () => {
  it("uses the existing PlayHouse extension bridge and waits for its matching result", async () => {
    let listener: ((event: MessageEvent) => void) | undefined;
    const target = {
      addEventListener: vi.fn((_type: string, value: EventListenerOrEventListenerObject) => {
        listener = value as (event: MessageEvent) => void;
      }),
      location: { origin: "https://carnival-playhouse.vercel.app" } as Location,
      postMessage: vi.fn((message: { requestId: string }) => {
        expect(message).toMatchObject({
          source: TOGGLE_RIGHT_SURFACE_SOURCE,
          type: TOGGLE_RIGHT_SURFACE_TYPE,
        });
        queueMicrotask(() => listener?.({
          data: {
            ok: true,
            requestId: message.requestId,
            source: TOGGLE_RIGHT_SURFACE_RESULT_SOURCE,
            type: TOGGLE_RIGHT_SURFACE_RESULT_TYPE,
          },
          origin: "https://carnival-playhouse.vercel.app",
          source: target,
        } as unknown as MessageEvent));
      }),
      removeEventListener: vi.fn(),
    };

    await expect(toggleRightSurface(target as never)).resolves.toBe(true);
    expect(target.postMessage).toHaveBeenCalledOnce();
    expect(target.removeEventListener).toHaveBeenCalledOnce();
  });
});
