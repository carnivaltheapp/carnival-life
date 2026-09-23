export const TOGGLE_RIGHT_SURFACE_SOURCE = "carnival-playhouse";
export const TOGGLE_RIGHT_SURFACE_TYPE = "toggleRightSurface";
export const TOGGLE_RIGHT_SURFACE_RESULT_SOURCE = "carnival-playhouse-bridge";
export const TOGGLE_RIGHT_SURFACE_RESULT_TYPE = "toggleRightSurfaceResult";

type SurfaceTarget = Pick<Window, "addEventListener" | "location" | "postMessage" | "removeEventListener">;

export function toggleRightSurface(target: SurfaceTarget = window): Promise<boolean> {
  const requestId = `surface-${Date.now()}`;
  return new Promise((resolve) => {
    const timeout = globalThis.setTimeout(() => finish(false), 3000);
    function finish(result: boolean) {
      globalThis.clearTimeout(timeout);
      target.removeEventListener("message", onMessage);
      resolve(result);
    }
    function onMessage(event: MessageEvent) {
      if (event.origin !== target.location.origin || event.source !== target) return;
      if (event.data?.source !== TOGGLE_RIGHT_SURFACE_RESULT_SOURCE ||
        event.data?.type !== TOGGLE_RIGHT_SURFACE_RESULT_TYPE ||
        event.data?.requestId !== requestId) return;
      finish(event.data.ok === true);
    }
    target.addEventListener("message", onMessage);
    target.postMessage({
      requestId,
      source: TOGGLE_RIGHT_SURFACE_SOURCE,
      type: TOGGLE_RIGHT_SURFACE_TYPE,
    }, target.location.origin);
  });
}
