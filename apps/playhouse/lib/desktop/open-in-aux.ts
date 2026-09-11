export const OPEN_IN_AUX_MESSAGE_SOURCE = "carnival-playhouse";

type AuxMessageTarget = Pick<Window, "location" | "postMessage">;

export function openInAux(url: string, target: AuxMessageTarget = window) {
  target.postMessage({
    source: OPEN_IN_AUX_MESSAGE_SOURCE,
    type: "openInAux",
    url,
  }, target.location.origin);
}
