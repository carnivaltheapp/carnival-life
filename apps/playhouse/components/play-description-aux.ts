import type { PlayListItem } from "../domain/play";
import { resolveTreeOfLifeDriveDestination } from "../app/tree-of-life/actions";
import { gmailThreadUrl, usablePlayUrl } from "../domain/play-display";
import { openInAuxAndWait } from "../lib/desktop/open-in-aux";
import { openSlackInAux } from "../lib/desktop/open-slack-in-aux";

export async function routePlayDescriptionAux(
  play: PlayListItem,
  slackUrl: string | null = null,
  route: (url: string) => Promise<unknown> = openInAuxAndWait,
  routeSlack: (url: string) => Promise<unknown> = openSlackInAux,
  resolveDrive: (branch: string) => Promise<string | null> = resolveTreeOfLifeDriveDestination,
) {
  console.info("HOT_TAB_ROUTE_START", { playId: play.id });
  if (play.branch) {
    let driveUrl: string | null = null;
    try {
      driveUrl = await resolveDrive(play.branch);
    } catch {
      // The controlled unresolved diagnostic below covers lookup failures.
    }
    if (driveUrl) {
      try {
        await route(driveUrl);
        console.info("HOT_TAB_NAVIGATED", { hostname: "drive.google.com", role: "drive" });
      } catch {
        // Routing remains best-effort; the other Hot Tabs still get their chance.
      }
    } else {
      console.info("HOT_TAB_DRIVE_UNRESOLVED", { relativePath: play.branch });
    }
  }
  const url = usablePlayUrl(play.url);
  if (url) {
    try {
      await route(url);
    } catch {
      // Routing is best-effort; later destinations still get their chance.
    }
  }
  if (slackUrl) {
    try {
      await routeSlack(slackUrl);
    } catch {
      // Routing is best-effort and Gmail must still get its chance.
    }
  }
  if (play.gmailThreadId) {
    try {
      await route(gmailThreadUrl(play.gmailThreadId, play.gmailAccountIndex ?? 0));
    } catch {
      // Aux routing failures must not affect the Play grid.
    }
  }
}

export function createDescriptionClickController({
  delayMs = 225,
}: {
  delayMs?: number;
} = {}) {
  let pendingClick: ReturnType<typeof setTimeout> | null = null;
  const cancelPendingClick = () => {
    if (pendingClick === null) return;
    clearTimeout(pendingClick);
    pendingClick = null;
  };
  return {
    dispose: cancelPendingClick,
    doubleClick(openDetails: () => void) {
      cancelPendingClick();
      openDetails();
    },
    singleClick(clickCount: number, routeLinks: () => Promise<unknown>) {
      if (clickCount > 1) {
        cancelPendingClick();
        return;
      }
      cancelPendingClick();
      pendingClick = setTimeout(() => {
        pendingClick = null;
        void routeLinks();
      }, delayMs);
    },
  };
}
