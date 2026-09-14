export const OPEN_IN_AUX_MESSAGE_SOURCE = "carnival-playhouse";
export const OPEN_IN_AUX_MESSAGE_TYPE = "openInAux";
export const OPEN_IN_AUX_RESULT_SOURCE = "carnival-playhouse-bridge";
export const OPEN_IN_AUX_RESULT_TYPE = "openInAuxResult";

type AuxMessageTarget = Pick<Window, "location" | "postMessage">;
type AwaitableAuxMessageTarget = AuxMessageTarget &
  Pick<Window, "addEventListener" | "removeEventListener">;

let auxRequestSequence = 0;

export function openInAux(url: string, target: AuxMessageTarget = window) {
  console.info("PH AUX ROUTE DISPATCH", routeLogLabel(url));
  target.postMessage({
    source: OPEN_IN_AUX_MESSAGE_SOURCE,
    type: OPEN_IN_AUX_MESSAGE_TYPE,
    url,
  }, target.location.origin);
}

export function openInAuxAndWait(
  url: string,
  target: AwaitableAuxMessageTarget = window,
) {
  const requestId = `aux-${Date.now()}-${++auxRequestSequence}`;
  return new Promise<boolean>((resolve) => {
    const timeout = globalThis.setTimeout(() => finish(false), 5000);
    function finish(success: boolean) {
      globalThis.clearTimeout(timeout);
      target.removeEventListener("message", onMessage);
      resolve(success);
    }
    function onMessage(event: MessageEvent) {
      if (
        event.source !== target ||
        event.origin !== target.location.origin ||
        event.data?.source !== OPEN_IN_AUX_RESULT_SOURCE ||
        event.data?.type !== OPEN_IN_AUX_RESULT_TYPE ||
        event.data?.requestId !== requestId
      ) return;
      finish(Boolean(event.data.ok));
    }
    target.addEventListener("message", onMessage);
    console.info("PH AUX ROUTE DISPATCH", routeLogLabel(url));
    target.postMessage({
      requestId,
      source: OPEN_IN_AUX_MESSAGE_SOURCE,
      type: OPEN_IN_AUX_MESSAGE_TYPE,
      url,
    }, target.location.origin);
  });
}

function routeLogLabel(value: string) {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return "invalid-url";
  }
}
