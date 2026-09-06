import "server-only";

import { listGoogleCalendars } from "./calendar";
import { getGoogleAccessToken } from "./token-broker.server";

export async function discoverCalendarsForAccount({
  googleAccountId,
  ownerUserId,
}: {
  googleAccountId: string;
  ownerUserId: string;
}) {
  const accessToken = await getGoogleAccessToken({ googleAccountId, ownerUserId });
  return listGoogleCalendars(accessToken);
}
