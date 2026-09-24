import "server-only";

import type { Collection } from "mongodb";

import { getCarnivalMongoDatabase } from "../playhouse/mongo-client";

const CLIENT_COLLECTION = "carnival_roadmap_oauth_clients";
const CODE_COLLECTION = "carnival_roadmap_oauth_codes";
const REFRESH_TOKEN_COLLECTION = "carnival_roadmap_oauth_refresh_tokens";
const TOKEN_COLLECTION = "carnival_roadmap_oauth_tokens";

export type RoadmapOAuthClient = {
  clientId: string;
  clientName: string;
  createdAt: Date;
  issuer: string;
  redirectUris: string[];
};

export type RoadmapOAuthCode = {
  clientId: string;
  codeChallenge: string;
  codeHash: string;
  createdAt: Date;
  expiresAt: Date;
  issuer: string;
  ownerUserId: string;
  redirectUri: string;
  resource: string;
  scope: string[];
};

export type RoadmapOAuthToken = {
  audience: string;
  clientId: string;
  createdAt: Date;
  expiresAt: Date;
  issuer: string;
  ownerUserId: string;
  scope: string[];
  tokenHash: string;
};

export type RoadmapOAuthRefreshToken = RoadmapOAuthToken;

type OAuthCollections = {
  clients: Collection<RoadmapOAuthClient>;
  codes: Collection<RoadmapOAuthCode>;
  refreshTokens: Collection<RoadmapOAuthRefreshToken>;
  tokens: Collection<RoadmapOAuthToken>;
};

type OAuthCollectionsFactory = () => Promise<OAuthCollections>;

async function mongoCollections(): Promise<OAuthCollections> {
  const database = await getCarnivalMongoDatabase();
  return {
    clients: database.collection<RoadmapOAuthClient>(CLIENT_COLLECTION),
    codes: database.collection<RoadmapOAuthCode>(CODE_COLLECTION),
    refreshTokens: database.collection<RoadmapOAuthRefreshToken>(REFRESH_TOKEN_COLLECTION),
    tokens: database.collection<RoadmapOAuthToken>(TOKEN_COLLECTION),
  };
}

export class MongoRoadmapOAuthRepository {
  constructor(private readonly collectionsFactory: OAuthCollectionsFactory = mongoCollections) {}

  private async ensureIndexes() {
    const collections = await this.collectionsFactory();
    await Promise.all([
      collections.clients.createIndex({ issuer: 1, clientId: 1 }, { unique: true }),
      collections.codes.createIndex({ codeHash: 1 }, { unique: true }),
      collections.codes.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      collections.refreshTokens.createIndex({ tokenHash: 1 }, { unique: true }),
      collections.refreshTokens.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      collections.tokens.createIndex({ tokenHash: 1 }, { unique: true }),
      collections.tokens.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    ]);
    return collections;
  }

  async insertClient(client: RoadmapOAuthClient) {
    const { clients } = await this.ensureIndexes();
    await clients.insertOne(client);
  }

  async findClient(issuer: string, clientId: string) {
    const { clients } = await this.collectionsFactory();
    return clients.findOne({ clientId, issuer });
  }

  async insertCode(code: RoadmapOAuthCode) {
    const { codes } = await this.ensureIndexes();
    await codes.insertOne(code);
  }

  async findCode(codeHash: string) {
    const { codes } = await this.collectionsFactory();
    return codes.findOne({ codeHash });
  }

  async consumeCode(codeHash: string) {
    const { codes } = await this.collectionsFactory();
    return (await codes.deleteOne({ codeHash })).deletedCount === 1;
  }

  async insertToken(token: RoadmapOAuthToken) {
    const { tokens } = await this.ensureIndexes();
    await tokens.insertOne(token);
  }

  async findToken(tokenHash: string, now: Date) {
    const { tokens } = await this.collectionsFactory();
    return tokens.findOne({ expiresAt: { $gt: now }, tokenHash });
  }

  async insertRefreshToken(token: RoadmapOAuthRefreshToken) {
    const { refreshTokens } = await this.ensureIndexes();
    await refreshTokens.insertOne(token);
  }

  async findRefreshToken(tokenHash: string, now: Date) {
    const { refreshTokens } = await this.collectionsFactory();
    return refreshTokens.findOne({ expiresAt: { $gt: now }, tokenHash });
  }

  async consumeRefreshToken(tokenHash: string, now: Date) {
    const { refreshTokens } = await this.collectionsFactory();
    return refreshTokens.findOneAndDelete({ expiresAt: { $gt: now }, tokenHash });
  }
}

export const ROADMAP_OAUTH_COLLECTIONS = {
  clients: CLIENT_COLLECTION,
  codes: CODE_COLLECTION,
  refreshTokens: REFRESH_TOKEN_COLLECTION,
  tokens: TOKEN_COLLECTION,
} as const;
