export const TOGGLE_RIGHT_SURFACE_MESSAGE_TYPE = "toggleRightSurface";
export const TOGGLE_RIGHT_SURFACE_RESULT_TYPE = "toggleRightSurfaceResult";
const SOURCE = "carnival-playhouse";
const RESULT_SOURCE = "carnival-playhouse-bridge";

export function toggleWorkspaceSurface(target: Window = window) {
  target.postMessage({
    requestId: crypto.randomUUID(),
    source: SOURCE,
    type: TOGGLE_RIGHT_SURFACE_MESSAGE_TYPE,
  }, target.location.origin);
}

export function toggleWorkspaceSurfaceAndWait(target: Window = window): Promise<boolean> {
  return new Promise((resolve) => {
    const requestId = crypto.randomUUID();
    const timeout = target.setTimeout(() => finish(false), 4000);
    function finish(value: boolean) {
      target.clearTimeout(timeout);
      target.removeEventListener("message", onMessage);
      resolve(value);
    }
    function onMessage(event: MessageEvent) {
      if (event.origin !== target.location.origin || event.data?.source !== RESULT_SOURCE ||
        event.data?.type !== TOGGLE_RIGHT_SURFACE_RESULT_TYPE ||
        event.data?.requestId !== requestId) return;
      finish(event.data.ok === true);
    }
    target.addEventListener("message", onMessage);
    target.postMessage({ requestId, source: SOURCE, type: TOGGLE_RIGHT_SURFACE_MESSAGE_TYPE },
      target.location.origin);
  });
}
