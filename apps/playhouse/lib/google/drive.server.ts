import "server-only";

import { GoogleDriveHierarchyResolver } from "./drive";
import { getGoogleAccessToken } from "./token-broker.server";

export async function createDriveHierarchyResolver({
  googleAccountId,
  ownerUserId,
}: {
  googleAccountId: string;
  ownerUserId: string;
}) {
  const accessToken = await getGoogleAccessToken({ googleAccountId, ownerUserId });
  return new GoogleDriveHierarchyResolver(accessToken);
}
