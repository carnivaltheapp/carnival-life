import { ObjectId, type Collection } from "mongodb";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  MongoSlackConnectionRepository,
  type SlackConnectionDocument,
} from "./connection-repository";

function repositoryWith(overrides: Record<string, unknown>) {
  const collection = {
    find: vi.fn(),
    findOne: vi.fn(),
    findOneAndUpdate: vi.fn(),
    updateOne: vi.fn(),
    ...overrides,
  } as unknown as Collection<SlackConnectionDocument>;
  return { collection, repository: new MongoSlackConnectionRepository(async () => collection) };
}

const credential = {
  authenticationTag: "auth-tag",
  encryptedAccessToken: "ciphertext-not-a-token",
  encryptionIv: "nonce",
  encryptionVersion: 1 as const,
};

describe("Mongo Slack connection repository", () => {
  it("upserts by owner and workspace and stores encrypted credential fields", async () => {
    const saved = { _id: new ObjectId() } as unknown as SlackConnectionDocument & { _id: ObjectId };
    const { collection, repository } = repositoryWith({ findOneAndUpdate: vi.fn().mockResolvedValue(saved) });
    await repository.upsert({
      credential,
      grantedScopes: ["channels:read", "users:read"],
      ownerUserId: "owner-a",
      slackUserId: "U1",
      teamId: "T1",
      teamName: "Carnival",
    });
    expect(collection.findOneAndUpdate).toHaveBeenCalledOnce();
    expect(collection.findOneAndUpdate).toHaveBeenCalledWith(
      { owner_user_id: "owner-a", slack_team_id: "T1" },
      expect.anything(),
      { returnDocument: "after", upsert: true },
    );
    const update = (collection.findOneAndUpdate as unknown as {
      mock: { calls: Array<[unknown, unknown, unknown]> };
    }).mock.calls[0][1];
    expect(update).toMatchObject({
      $set: {
        encrypted_access_token: "ciphertext-not-a-token",
        token_auth_tag: "auth-tag",
        token_iv: "nonce",
      },
    });
    expect(JSON.stringify(update)).not.toContain("xoxp-");
  });

  it("scopes connected lookups and reconnect updates to the owner", async () => {
    const { collection, repository } = repositoryWith({
      findOne: vi.fn().mockResolvedValue(null),
      updateOne: vi.fn().mockResolvedValue({ acknowledged: true }),
    });
    await repository.findConnected("owner-a", "T1");
    expect(collection.findOne).toHaveBeenCalledWith(
      { connection_status: "connected", owner_user_id: "owner-a", slack_team_id: "T1" },
      { sort: { updated_at: -1 } },
    );
    await repository.markReconnectRequired("owner-a", "T1", "Reconnect");
    expect(collection.updateOne).toHaveBeenCalledWith(
      { owner_user_id: "owner-a", slack_team_id: "T1" },
      expect.anything(),
    );
  });

  it("uses an owner connection without a team ID only when it is unambiguous", async () => {
    const one = { owner_user_id: "owner-a", slack_team_id: "T1" };
    const toArray = vi.fn()
      .mockResolvedValueOnce([one])
      .mockResolvedValueOnce([one, { owner_user_id: "owner-a", slack_team_id: "T2" }]);
    const limit = vi.fn(() => ({ toArray }));
    const sort = vi.fn(() => ({ limit }));
    const { collection, repository } = repositoryWith({ find: vi.fn(() => ({ sort })) });

    await expect(repository.findConnected("owner-a", null)).resolves.toEqual(one);
    await expect(repository.findConnected("owner-a", null)).resolves.toBeNull();
    expect(collection.find).toHaveBeenCalledWith({
      connection_status: "connected",
      owner_user_id: "owner-a",
    });
  });

  it("never returns credential fields in Settings listings", async () => {
    const toArray = vi.fn().mockResolvedValue([]);
    const sort = vi.fn(() => ({ toArray }));
    const { collection, repository } = repositoryWith({ find: vi.fn(() => ({ sort })) });
    await repository.listForOwner("owner-a");
    expect(collection.find).toHaveBeenCalledWith(
      { owner_user_id: "owner-a" },
      { projection: { encrypted_access_token: 0, token_auth_tag: 0, token_iv: 0 } },
    );
  });
});
