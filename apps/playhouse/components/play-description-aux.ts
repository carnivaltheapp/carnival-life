import type { PlayListItem } from "../domain/play";
import { gmailThreadUrl, usablePlayUrl } from "../domain/play-display";
import { openInAuxAndWait } from "../lib/desktop/open-in-aux";

export async function openPlayDetailsAndRouteAux(
  play: PlayListItem,
  openDetails: () => void,
  route: (url: string) => Promise<unknown> = openInAuxAndWait,
) {
  openDetails();
  const url = usablePlayUrl(play.url);
  if (url) {
    try {
      await route(url);
    } catch {
      // The detail remains open and Gmail routing still gets its chance.
    }
  }
  if (play.gmailThreadId) {
    try {
      await route(gmailThreadUrl(play.gmailThreadId, play.gmailAccountIndex ?? 0));
    } catch {
      // Aux routing is best-effort and must never close the detail.
    }
  }
}
