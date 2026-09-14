import { openInAuxAndWait } from "./open-in-aux";

export function openSlackInAux(
  url: string,
  route: (value: string) => Promise<unknown> = openInAuxAndWait,
) {
  return route(url);
}
