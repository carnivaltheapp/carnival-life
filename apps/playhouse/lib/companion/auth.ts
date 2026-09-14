import "server-only";

import { MongoCompanionRepository } from "./repository";
import { bearerCredential } from "./security";

export async function authenticateCompanionRequest(request: Request) {
  const credential = bearerCredential(request.headers.get("authorization"));
  return credential ? new MongoCompanionRepository().authenticate(credential) : null;
}
