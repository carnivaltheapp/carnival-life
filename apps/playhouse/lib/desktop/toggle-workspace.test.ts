import { describe, expect, it, vi } from "vitest";
import {
  TOGGLE_RIGHT_SURFACE_MESSAGE_TYPE,
  TOGGLE_RIGHT_SURFACE_RESULT_TYPE,
  toggleWorkspaceSurfaceAndWait,
} from "./toggle-workspace";

describe("toggleWorkspaceSurface", () => {
  it("uses the PlayHouse bridge and resolves after the extension confirms the swap", async () => {
    let listener: ((event: MessageEvent) => void) | undefined;
    const target = {
      addEventListener: vi.fn((_type: string, value: EventListenerOrEventListenerObject) => {
        listener = value as (event: MessageEvent) => void;
      }),
      clearTimeout,
      location: { origin: "https://carnival-playhouse.vercel.app" } as Location,
      postMessage: vi.fn((message: { requestId: string; type: string }) => queueMicrotask(() => listener?.({
        data: {
          ok: true,
          requestId: message.requestId,
          source: "carnival-playhouse-bridge",
          type: TOGGLE_RIGHT_SURFACE_RESULT_TYPE,
        },
        origin: "https://carnival-playhouse.vercel.app",
      } as MessageEvent))),
      removeEventListener: vi.fn(),
      setTimeout,
    };

    await expect(toggleWorkspaceSurfaceAndWait(target as never)).resolves.toBe(true);
    expect(target.postMessage.mock.calls[0][0].type).toBe(TOGGLE_RIGHT_SURFACE_MESSAGE_TYPE);
  });
});
