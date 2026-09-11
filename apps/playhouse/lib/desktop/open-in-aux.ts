export const OPEN_IN_AUX_MESSAGE_SOURCE = "carnival-playhouse";
export const OPEN_IN_AUX_MESSAGE_TYPE = "openInAux";

type AuxMessageTarget = Pick<Window, "location" | "postMessage">;

export function openInAux(url: string, target: AuxMessageTarget = window) {
  console.info("PH AUX ROUTE DISPATCH", routeLogLabel(url));
  target.postMessage({
    source: OPEN_IN_AUX_MESSAGE_SOURCE,
    type: OPEN_IN_AUX_MESSAGE_TYPE,
    url,
  }, target.location.origin);
}

function routeLogLabel(value: string) {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return "invalid-url";
  }
}
