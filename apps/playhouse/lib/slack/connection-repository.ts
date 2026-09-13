import "server-only";

import type { Collection, WithId } from "mongodb";

import { getCarnivalMongoDatabase } from "../playhouse/mongo-client";
import type { EncryptedSlackCredential } from "./credential-crypto";

const COLLECTION_NAME = "carnival_slack_connections";

export type SlackConnectionDocument = {
  owner_user_id: string;
  slack_team_id: string;
  slack_team_name: string;
  slack_user_id: string;
  granted_scopes: string[];
  connection_status: "connected" | "error";
  encrypted_access_token: string;
  token_iv: string;
  token_auth_tag: string;
  encryption_version: 1;
  sync_error: string | null;
  created_at: Date;
  updated_at: Date;
};

type ConnectionCollection = Collection<SlackConnectionDocument>;

declare global {
  var carnivalSlackConnectionIndexPromise: Promise<string> | undefined;
}

async function defaultCollection() {
  const collection = (await getCarnivalMongoDatabase())
    .collection<SlackConnectionDocument>(COLLECTION_NAME);
  globalThis.carnivalSlackConnectionIndexPromise ??= collection.createIndex(
    { owner_user_id: 1, slack_team_id: 1 },
    { name: "owner_slack_team_unique", unique: true },
  );
  await globalThis.carnivalSlackConnectionIndexPromise;
  return collection;
}

export class MongoSlackConnectionRepository {
  constructor(private readonly collection: () => Promise<ConnectionCollection> = defaultCollection) {}

  async listForOwner(ownerUserId: string) {
    return (await this.collection()).find(
      { owner_user_id: ownerUserId },
      { projection: { encrypted_access_token: 0, token_auth_tag: 0, token_iv: 0 } },
    ).sort({ updated_at: -1 }).toArray();
  }

  async findConnected(ownerUserId: string, teamId: string | null) {
    const filter: Record<string, unknown> = {
      connection_status: "connected",
      owner_user_id: ownerUserId,
    };
    if (teamId) filter.slack_team_id = teamId;
    return (await this.collection()).findOne(filter, { sort: { updated_at: -1 } });
  }

  async upsert({
    credential,
    grantedScopes,
    ownerUserId,
    slackUserId,
    teamId,
    teamName,
  }: {
    credential: EncryptedSlackCredential;
    grantedScopes: string[];
    ownerUserId: string;
    slackUserId: string;
    teamId: string;
    teamName: string;
  }): Promise<WithId<SlackConnectionDocument>> {
    const now = new Date();
    const result = await (await this.collection()).findOneAndUpdate(
      { owner_user_id: ownerUserId, slack_team_id: teamId },
      {
        $set: {
          connection_status: "connected",
          encrypted_access_token: credential.encryptedAccessToken,
          encryption_version: credential.encryptionVersion,
          granted_scopes: grantedScopes,
          slack_team_name: teamName,
          slack_user_id: slackUserId,
          sync_error: null,
          token_auth_tag: credential.authenticationTag,
          token_iv: credential.encryptionIv,
          updated_at: now,
        },
        $setOnInsert: { created_at: now, owner_user_id: ownerUserId, slack_team_id: teamId },
      },
      { returnDocument: "after", upsert: true },
    );
    if (!result) throw new Error("Slack connection could not be stored.");
    return result;
  }

  async markReconnectRequired(ownerUserId: string, teamId: string, message: string) {
    await (await this.collection()).updateOne(
      { owner_user_id: ownerUserId, slack_team_id: teamId },
      { $set: { connection_status: "error", sync_error: message, updated_at: new Date() } },
    );
  }
}
