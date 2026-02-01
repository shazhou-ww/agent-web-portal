/**
 * CAS Stack - Local Development Server (Bun)
 *
 * Uses in-memory storage for local development without AWS dependencies.
 * Supports Cognito JWT authentication for cas-webui integration.
 */

import { createHash, createHash as cryptoCreateHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type {
  AuthorizedPubkey,
  PendingAuth,
  PendingAuthStore,
  PubkeyStore,
} from "@agent-web-portal/auth";
import {
  AWP_AUTH_HEADERS,
  generateVerificationCode,
  validateTimestamp,
  verifySignature,
} from "@agent-web-portal/auth";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { getCognitoUserMap } from "./src/auth/cognito-users.ts";
import {
  AwpPendingAuthStore,
  AwpPubkeyStore,
  CommitsDb,
  DagDb,
  DepotDb,
  MAIN_DEPOT_NAME,
  OwnershipDb,
  TokensDb,
  UserRolesDb,
} from "./src/db/index.ts";
import type { DepotRecord, DepotHistoryRecord } from "./src/db/index.ts";
import type { CasDagNode, CasOwnership, Ticket, Token, UserToken } from "./src/types.ts";
import { loadConfig, loadServerConfig } from "./src/types.ts";

function tokenIdFromPk(pk: string): string {
  return pk.replace("token#", "");
}

// ============================================================================
// In-Memory Storage
// ============================================================================

class MemoryTokensDb {
  private tokens = new Map<string, Token>();

  async getToken(tokenId: string): Promise<Token | null> {
    const token = this.tokens.get(`token#${tokenId}`);
    if (!token) return null;
    if (token.expiresAt < Date.now()) {
      this.tokens.delete(`token#${tokenId}`);
      return null;
    }
    return token;
  }

  async createUserToken(
    userId: string,
    refreshToken: string,
    expiresIn: number = 3600
  ): Promise<UserToken> {
    const tokenId = `usr_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const token: UserToken = {
      pk: `token#${tokenId}`,
      type: "user",
      userId,
      refreshToken,
      createdAt: Date.now(),
      expiresAt: Date.now() + expiresIn * 1000,
    };
    this.tokens.set(token.pk, token);
    return token;
  }

  async createTicket(
    realm: string,
    issuerId: string,
    scope?: string | string[],
    commit?: boolean | { quota?: number; accept?: string[] },
    expiresIn?: number
  ): Promise<Ticket> {
    const ticketId = `tkt_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const defaultExpiry = commit ? 300 : 3600;
    const serverConfig = loadServerConfig();

    // Convert scope to array or undefined
    const scopeArr = scope === undefined ? undefined : Array.isArray(scope) ? scope : [scope];

    // Convert commit to CommitConfig or undefined
    const commitConfig =
      commit === false || commit === undefined
        ? undefined
        : commit === true
          ? {}
          : { quota: commit.quota, accept: commit.accept };

    const ticket: Ticket = {
      pk: `token#${ticketId}`,
      type: "ticket",
      realm,
      issuerId,
      scope: scopeArr,
      commit: commitConfig,
      config: {
        nodeLimit: serverConfig.nodeLimit,
        maxNameBytes: serverConfig.maxNameBytes,
      },
      createdAt: Date.now(),
      expiresAt: Date.now() + (expiresIn ?? defaultExpiry) * 1000,
    };
    this.tokens.set(ticket.pk, ticket);
    return ticket;
  }

  async deleteToken(tokenId: string): Promise<void> {
    this.tokens.delete(`token#${tokenId}`);
  }

  async verifyTokenOwnership(tokenId: string, userId: string): Promise<boolean> {
    const token = await this.getToken(tokenId);
    if (!token) return false;
    if (token.type === "user") {
      return token.userId === userId;
    }
    if (token.type === "ticket") {
      const issuer = await this.getToken(token.issuerId);
      if (!issuer) return false;
      if (issuer.type === "user") {
        return issuer.userId === userId;
      }
    }
    return false;
  }

  static extractTokenId(pk: string): string {
    return pk.replace("token#", "");
  }
}

class MemoryOwnershipDb {
  private ownership = new Map<string, CasOwnership>();

  private key(realm: string, casKey: string): string {
    return `${realm}#${casKey}`;
  }

  async hasOwnership(realm: string, casKey: string): Promise<boolean> {
    return this.ownership.has(this.key(realm, casKey));
  }

  async getOwnership(realm: string, casKey: string): Promise<CasOwnership | null> {
    return this.ownership.get(this.key(realm, casKey)) ?? null;
  }

  async checkOwnership(
    realm: string,
    keys: string[]
  ): Promise<{ found: string[]; missing: string[] }> {
    const found: string[] = [];
    const missing: string[] = [];
    for (const k of keys) {
      if (this.ownership.has(this.key(realm, k))) {
        found.push(k);
      } else {
        missing.push(k);
      }
    }
    return { found, missing };
  }

  async addOwnership(
    realm: string,
    casKey: string,
    createdBy: string,
    contentType: string,
    size: number
  ): Promise<CasOwnership> {
    const record: CasOwnership = {
      realm,
      key: casKey,
      createdAt: Date.now(),
      createdBy,
      contentType,
      size,
    };
    this.ownership.set(this.key(realm, casKey), record);
    return record;
  }

  async listNodes(
    realm: string,
    limit: number = 10,
    startKey?: string
  ): Promise<{ nodes: CasOwnership[]; nextKey?: string; total: number }> {
    // Get all nodes for this realm
    const allNodes: CasOwnership[] = [];
    for (const record of this.ownership.values()) {
      if (record.realm === realm) {
        allNodes.push(record);
      }
    }

    // Sort by createdAt descending (newest first)
    allNodes.sort((a, b) => b.createdAt - a.createdAt);

    // Find start position
    let startIndex = 0;
    if (startKey) {
      const idx = allNodes.findIndex((n) => n.key === startKey);
      if (idx !== -1) {
        startIndex = idx + 1;
      }
    }

    // Paginate
    const nodes = allNodes.slice(startIndex, startIndex + limit);
    const nextKey =
      nodes.length === limit && startIndex + limit < allNodes.length
        ? nodes[nodes.length - 1]?.key
        : undefined;

    return { nodes, nextKey, total: allNodes.length };
  }

  async deleteOwnership(realm: string, casKey: string): Promise<boolean> {
    return this.ownership.delete(this.key(realm, casKey));
  }
}

class MemoryDagDb {
  private nodes = new Map<string, CasDagNode>();

  async getNode(key: string): Promise<CasDagNode | null> {
    return this.nodes.get(key) ?? null;
  }

  async putNode(
    key: string,
    children: string[],
    contentType: string,
    size: number
  ): Promise<CasDagNode> {
    const node: CasDagNode = {
      key,
      children,
      contentType,
      size,
      createdAt: Date.now(),
    };
    this.nodes.set(key, node);
    return node;
  }

  async collectDagKeys(rootKey: string): Promise<string[]> {
    const visited = new Set<string>();
    const queue = [rootKey];
    while (queue.length > 0) {
      const key = queue.shift()!;
      if (visited.has(key)) continue;
      visited.add(key);
      const node = this.nodes.get(key);
      if (node?.children) {
        for (const child of node.children) {
          if (!visited.has(child)) queue.push(child);
        }
      }
    }
    return Array.from(visited);
  }
}

interface CasMetadata {
  casContentType?: string;
  casSize?: number;
}

interface CasStorageEntry {
  content: Buffer;
  contentType: string;
  metadata: CasMetadata;
}

interface CasStorageInterface {
  exists(casKey: string): Promise<boolean>;
  get(casKey: string): Promise<{ content: Buffer; contentType: string; metadata: CasMetadata } | null>;
  put(content: Buffer, contentType?: string, metadata?: CasMetadata): Promise<{ key: string; size: number; isNew: boolean }>;
  putWithKey(expectedKey: string, content: Buffer, contentType?: string, metadata?: CasMetadata): Promise<
    | { key: string; size: number; isNew: boolean }
    | { error: "hash_mismatch"; expected: string; actual: string }
  >;
}

function computeCasHash(content: Buffer): string {
  const hash = createHash("sha256").update(content).digest("hex");
  return `sha256:${hash}`;
}

class MemoryCasStorage implements CasStorageInterface {
  private blobs = new Map<string, CasStorageEntry>();

  async exists(casKey: string): Promise<boolean> {
    return this.blobs.has(casKey);
  }

  async get(casKey: string): Promise<{ content: Buffer; contentType: string; metadata: CasMetadata } | null> {
    const entry = this.blobs.get(casKey);
    if (!entry) return null;
    return { content: entry.content, contentType: entry.contentType, metadata: entry.metadata };
  }

  async put(
    content: Buffer,
    contentType: string = "application/octet-stream",
    metadata?: CasMetadata
  ): Promise<{ key: string; size: number; isNew: boolean }> {
    const key = computeCasHash(content);
    const isNew = !this.blobs.has(key);
    if (isNew) {
      this.blobs.set(key, { content, contentType, metadata: metadata ?? {} });
    }
    return { key, size: content.length, isNew };
  }

  async putWithKey(
    expectedKey: string,
    content: Buffer,
    contentType: string = "application/octet-stream",
    metadata?: CasMetadata
  ): Promise<
    | { key: string; size: number; isNew: boolean }
    | { error: "hash_mismatch"; expected: string; actual: string }
  > {
    const actualKey = computeCasHash(content);
    if (actualKey !== expectedKey) {
      return { error: "hash_mismatch", expected: expectedKey, actual: actualKey };
    }
    return this.put(content, contentType, metadata);
  }
}

// File-based CAS storage for local development with persistence
class FileCasStorage implements CasStorageInterface {
  private baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
    // Ensure base directory exists
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  private getFilePath(casKey: string): string {
    // casKey format: "sha256:abcd1234..."
    // Store in subdirectories based on first 2 chars of hash for better file system performance
    const hashPart = casKey.replace("sha256:", "");
    const subDir = hashPart.substring(0, 2);
    return path.join(this.baseDir, subDir, hashPart);
  }

  private getMetaPath(casKey: string): string {
    return this.getFilePath(casKey) + ".meta.json";
  }

  async exists(casKey: string): Promise<boolean> {
    return fs.existsSync(this.getFilePath(casKey));
  }

  async get(casKey: string): Promise<{ content: Buffer; contentType: string; metadata: CasMetadata } | null> {
    const filePath = this.getFilePath(casKey);
    const metaPath = this.getMetaPath(casKey);

    if (!fs.existsSync(filePath)) {
      return null;
    }

    const content = fs.readFileSync(filePath);
    let contentType = "application/octet-stream";
    let metadata: CasMetadata = {};

    if (fs.existsSync(metaPath)) {
      try {
        const metaData = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
        contentType = metaData.contentType || contentType;
        metadata = metaData.metadata || metadata;
      } catch {
        // Ignore meta read errors, use defaults
      }
    }

    return { content, contentType, metadata };
  }

  async put(
    content: Buffer,
    contentType: string = "application/octet-stream",
    metadata?: CasMetadata
  ): Promise<{ key: string; size: number; isNew: boolean }> {
    const key = computeCasHash(content);
    const filePath = this.getFilePath(key);
    const metaPath = this.getMetaPath(key);
    const isNew = !fs.existsSync(filePath);

    if (isNew) {
      // Ensure subdirectory exists
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Write content file
      fs.writeFileSync(filePath, content);

      // Write metadata file
      fs.writeFileSync(metaPath, JSON.stringify({
        contentType,
        metadata: metadata ?? {},
        createdAt: new Date().toISOString()
      }, null, 2));
    }

    return { key, size: content.length, isNew };
  }

  async putWithKey(
    expectedKey: string,
    content: Buffer,
    contentType: string = "application/octet-stream",
    metadata?: CasMetadata
  ): Promise<
    | { key: string; size: number; isNew: boolean }
    | { error: "hash_mismatch"; expected: string; actual: string }
  > {
    const actualKey = computeCasHash(content);
    if (actualKey !== expectedKey) {
      return { error: "hash_mismatch", expected: expectedKey, actual: actualKey };
    }
    return this.put(content, contentType, metadata);
  }
}

// ============================================================================
// AWP Auth Stores (In-Memory for development)
// ============================================================================

class MemoryAwpPendingAuthStore implements PendingAuthStore {
  private pending = new Map<string, PendingAuth>();

  async create(auth: PendingAuth): Promise<void> {
    this.pending.set(auth.pubkey, auth);
  }

  async get(pubkey: string): Promise<PendingAuth | null> {
    const auth = this.pending.get(pubkey);
    if (!auth) return null;
    if (auth.expiresAt < Date.now()) {
      this.pending.delete(pubkey);
      return null;
    }
    return auth;
  }

  async delete(pubkey: string): Promise<void> {
    this.pending.delete(pubkey);
  }

  async validateCode(pubkey: string, code: string): Promise<boolean> {
    const auth = await this.get(pubkey);
    if (!auth) return false;
    return auth.verificationCode === code;
  }
}

class MemoryAwpPubkeyStore implements PubkeyStore {
  private pubkeys = new Map<string, AuthorizedPubkey>();

  async lookup(pubkey: string): Promise<AuthorizedPubkey | null> {
    const auth = this.pubkeys.get(pubkey);
    if (!auth) return null;
    if (auth.expiresAt && auth.expiresAt < Date.now()) {
      this.pubkeys.delete(pubkey);
      return null;
    }
    return auth;
  }

  async store(auth: AuthorizedPubkey): Promise<void> {
    this.pubkeys.set(auth.pubkey, auth);
  }

  async revoke(pubkey: string): Promise<void> {
    this.pubkeys.delete(pubkey);
  }

  async listByUser(userId: string): Promise<AuthorizedPubkey[]> {
    const now = Date.now();
    return Array.from(this.pubkeys.values()).filter(
      (a) => a.userId === userId && (!a.expiresAt || a.expiresAt > now)
    );
  }
}

// ============================================================================
// In-Memory Agent Token Storage (for WebUI token management)
// ============================================================================

interface AgentTokenRecord {
  id: string;
  userId: string;
  name: string;
  description?: string;
  createdAt: number;
  expiresAt: number;
}

class MemoryAgentTokensDb {
  private tokens = new Map<string, AgentTokenRecord>();

  async create(
    userId: string,
    name: string,
    options?: { description?: string; expiresIn?: number }
  ): Promise<AgentTokenRecord> {
    const id = `agt_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const expiresIn = options?.expiresIn ?? 30 * 24 * 60 * 60; // 30 days default
    const token: AgentTokenRecord = {
      id,
      userId,
      name,
      description: options?.description,
      createdAt: Date.now(),
      expiresAt: Date.now() + expiresIn * 1000,
    };
    this.tokens.set(id, token);
    return token;
  }

  async listByUser(userId: string): Promise<AgentTokenRecord[]> {
    const now = Date.now();
    return Array.from(this.tokens.values()).filter((t) => t.userId === userId && t.expiresAt > now);
  }

  async revoke(userId: string, tokenId: string): Promise<boolean> {
    const token = this.tokens.get(tokenId);
    if (!token || token.userId !== userId) {
      return false;
    }
    this.tokens.delete(tokenId);
    return true;
  }
}

// Commit record for memory storage
interface MemoryCommitRecord {
  realm: string;
  root: string;
  title?: string;
  createdAt: number;
  createdBy: string;
}

class MemoryCommitsDb {
  private commits = new Map<string, MemoryCommitRecord>();

  private buildKey(realm: string, root: string): string {
    return `${realm}#${root}`;
  }

  async create(
    realm: string,
    root: string,
    createdBy: string,
    title?: string
  ): Promise<MemoryCommitRecord> {
    const commit: MemoryCommitRecord = {
      realm,
      root,
      title,
      createdAt: Date.now(),
      createdBy,
    };
    this.commits.set(this.buildKey(realm, root), commit);
    return commit;
  }

  async get(realm: string, root: string): Promise<MemoryCommitRecord | null> {
    return this.commits.get(this.buildKey(realm, root)) ?? null;
  }

  async list(
    realm: string,
    options?: { limit?: number }
  ): Promise<{ commits: MemoryCommitRecord[]; nextKey?: string }> {
    const limit = options?.limit ?? 100;
    const realmCommits = Array.from(this.commits.values())
      .filter((c) => c.realm === realm)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
    return { commits: realmCommits };
  }

  // Alias for compatibility with CommitsDb
  async listByScan(
    realm: string,
    options?: { limit?: number; startKey?: string }
  ): Promise<{ commits: MemoryCommitRecord[]; nextKey?: string }> {
    return this.list(realm, options);
  }

  async updateTitle(realm: string, root: string, title?: string): Promise<boolean> {
    const commit = this.commits.get(this.buildKey(realm, root));
    if (!commit) return false;
    commit.title = title;
    return true;
  }

  async delete(realm: string, root: string): Promise<boolean> {
    return this.commits.delete(this.buildKey(realm, root));
  }
}

// ============================================================================
// In-Memory Depot Storage
// ============================================================================

const EMPTY_COLLECTION_KEY = "sha256:a78577c5cfc47ab3e4b116f01902a69e2e015b40cdef52f9b552cfb5104e769a";
const EMPTY_COLLECTION_DATA = Buffer.from(JSON.stringify({ children: {} }), "utf-8");

/**
 * Ensure empty collection exists in storage and ownership
 */
async function ensureEmptyCollection(realm: string, tokenId: string): Promise<void> {
  // Check if already exists
  const exists = await casStorage.get(EMPTY_COLLECTION_KEY);
  if (!exists) {
    await casStorage.putWithKey(
      EMPTY_COLLECTION_KEY,
      EMPTY_COLLECTION_DATA,
      "application/vnd.cas.collection"
    );
  }
  // Ensure ownership
  const hasOwnership = await ownershipDb.hasOwnership(realm, EMPTY_COLLECTION_KEY);
  if (!hasOwnership) {
    await ownershipDb.addOwnership(
      realm,
      EMPTY_COLLECTION_KEY,
      tokenId,
      "application/vnd.cas.collection",
      EMPTY_COLLECTION_DATA.length
    );
  }
}

interface MemoryDepotRecord {
  realm: string;
  depotId: string;
  name: string;
  root: string;
  version: number;
  createdAt: number;
  updatedAt: number;
  description?: string;
}

interface MemoryDepotHistory {
  realm: string;
  depotId: string;
  version: number;
  root: string;
  createdAt: number;
  message?: string;
}

class MemoryDepotDb {
  private depots = new Map<string, MemoryDepotRecord>();
  private history = new Map<string, MemoryDepotHistory[]>();

  private buildKey(realm: string, depotId: string): string {
    return `${realm}#${depotId}`;
  }

  async create(
    realm: string,
    options: { name: string; root?: string; description?: string }
  ): Promise<MemoryDepotRecord> {
    const depotId = `dpt_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();
    const depot: MemoryDepotRecord = {
      realm,
      depotId,
      name: options.name,
      root: options.root || EMPTY_COLLECTION_KEY,
      version: 1,
      createdAt: now,
      updatedAt: now,
      description: options.description,
    };
    this.depots.set(this.buildKey(realm, depotId), depot);

    // Add initial history
    const historyKey = this.buildKey(realm, depotId);
    this.history.set(historyKey, [
      {
        realm,
        depotId,
        version: 1,
        root: depot.root,
        createdAt: now,
        message: "Initial version",
      },
    ]);

    return depot;
  }

  async get(realm: string, depotId: string): Promise<MemoryDepotRecord | null> {
    return this.depots.get(this.buildKey(realm, depotId)) ?? null;
  }

  async getByName(realm: string, name: string): Promise<MemoryDepotRecord | null> {
    for (const depot of this.depots.values()) {
      if (depot.realm === realm && depot.name === name) {
        return depot;
      }
    }
    return null;
  }

  async list(
    realm: string,
    options?: { limit?: number; startKey?: string }
  ): Promise<{ depots: MemoryDepotRecord[]; nextKey?: string }> {
    const limit = options?.limit ?? 100;
    const realmDepots = Array.from(this.depots.values())
      .filter((d) => d.realm === realm)
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, limit);
    return { depots: realmDepots };
  }

  async updateRoot(
    realm: string,
    depotId: string,
    newRoot: string,
    message?: string
  ): Promise<{ depot: MemoryDepotRecord; history: MemoryDepotHistory }> {
    const depot = this.depots.get(this.buildKey(realm, depotId));
    if (!depot) {
      throw new Error("Depot not found");
    }

    const now = Date.now();
    depot.root = newRoot;
    depot.version += 1;
    depot.updatedAt = now;

    const historyRecord: MemoryDepotHistory = {
      realm,
      depotId,
      version: depot.version,
      root: newRoot,
      createdAt: now,
      message,
    };

    const historyKey = this.buildKey(realm, depotId);
    const historyList = this.history.get(historyKey) ?? [];
    historyList.push(historyRecord);
    this.history.set(historyKey, historyList);

    return { depot, history: historyRecord };
  }

  async delete(realm: string, depotId: string): Promise<boolean> {
    const key = this.buildKey(realm, depotId);
    this.history.delete(key);
    return this.depots.delete(key);
  }

  async listHistory(
    realm: string,
    depotId: string,
    options?: { limit?: number; startKey?: string }
  ): Promise<{ history: MemoryDepotHistory[]; nextKey?: string }> {
    const limit = options?.limit ?? 50;
    const historyKey = this.buildKey(realm, depotId);
    const historyList = this.history.get(historyKey) ?? [];
    const sorted = [...historyList].sort((a, b) => b.version - a.version).slice(0, limit);
    return { history: sorted };
  }

  async getHistory(realm: string, depotId: string, version: number): Promise<MemoryDepotHistory | null> {
    const historyKey = this.buildKey(realm, depotId);
    const historyList = this.history.get(historyKey) ?? [];
    return historyList.find((h) => h.version === version) ?? null;
  }

  async ensureMainDepot(realm: string, emptyCollectionKey: string): Promise<MemoryDepotRecord> {
    const existing = await this.getByName(realm, MAIN_DEPOT_NAME);
    if (existing) {
      return existing;
    }
    return await this.create(realm, {
      name: MAIN_DEPOT_NAME,
      root: emptyCollectionKey,
      description: "Default depot",
    });
  }
}

/** Adapter: TokensDb agent-token API → same shape as MemoryAgentTokensDb for server routes */
interface AgentTokenRecord {
  id: string;
  userId: string;
  name: string;
  description?: string;
  createdAt: number;
  expiresAt: number;
}

function createAgentTokensDbAdapter(
  tokensDb: TokensDb,
  serverConfig: ReturnType<typeof loadServerConfig>
): {
  listByUser(userId: string): Promise<AgentTokenRecord[]>;
  create(
    userId: string,
    name: string,
    options?: { description?: string; expiresIn?: number }
  ): Promise<AgentTokenRecord>;
  revoke(userId: string, tokenId: string): Promise<boolean>;
} {
  return {
    async listByUser(userId: string) {
      const list = await tokensDb.listAgentTokensByUser(userId);
      return list.map((t) => ({
        id: tokenIdFromPk(t.pk),
        userId: t.userId,
        name: t.name,
        description: t.description,
        createdAt: t.createdAt,
        expiresAt: t.expiresAt,
      }));
    },
    async create(
      userId: string,
      name: string,
      options?: { description?: string; expiresIn?: number }
    ) {
      const t = await tokensDb.createAgentToken(userId, name, serverConfig, options);
      return {
        id: tokenIdFromPk(t.pk),
        userId: t.userId,
        name: t.name,
        description: t.description,
        createdAt: t.createdAt,
        expiresAt: t.expiresAt,
      };
    },
    async revoke(userId: string, tokenId: string) {
      try {
        await tokensDb.revokeAgentToken(userId, tokenId);
        return true;
      } catch {
        return false;
      }
    },
  };
}

// ============================================================================
// Cognito JWT Verifier (for cas-webui integration)
// ============================================================================

// Cognito configuration from env (COGNITO_* only)
const COGNITO_USER_POOL_ID = process.env.COGNITO_USER_POOL_ID ?? "";
const COGNITO_REGION =
  process.env.COGNITO_REGION ?? (COGNITO_USER_POOL_ID.split("_")[0] || "us-east-1");
const COGNITO_ISSUER = COGNITO_USER_POOL_ID
  ? `https://cognito-idp.${COGNITO_REGION}.amazonaws.com/${COGNITO_USER_POOL_ID}`
  : "";

// JWKS for Cognito JWT verification
const cognitoJwks = COGNITO_USER_POOL_ID
  ? createRemoteJWKSet(new URL(`${COGNITO_ISSUER}/.well-known/jwks.json`), {
      timeoutDuration: 10000, // 10 seconds timeout
    })
  : null;

interface CognitoTokenPayload {
  sub: string;
  email?: string;
  name?: string;
  token_use: "access" | "id";
  exp: number;
}

async function verifyCognitoToken(token: string): Promise<CognitoTokenPayload | null> {
  if (!cognitoJwks || !COGNITO_ISSUER) {
    return null;
  }

  try {
    const { payload } = await jwtVerify(token, cognitoJwks, {
      issuer: COGNITO_ISSUER,
    });
    return payload as unknown as CognitoTokenPayload;
  } catch (error) {
    console.error("[Cognito] JWT verification failed:", error);
    return null;
  }
}

// ============================================================================
// Local Router - use DynamoDB when DYNAMODB_ENDPOINT is set (e.g. local Docker)
// ============================================================================

const useDynamo = !!process.env.DYNAMODB_ENDPOINT;

const tokensDb = useDynamo ? new TokensDb(loadConfig()) : new MemoryTokensDb();
const ownershipDb = useDynamo ? new OwnershipDb(loadConfig()) : new MemoryOwnershipDb();
const dagDb = useDynamo ? new DagDb(loadConfig()) : new MemoryDagDb();
const commitsDb = useDynamo ? new CommitsDb(loadConfig()) : new MemoryCommitsDb();
const depotDb = useDynamo ? new DepotDb(loadConfig()) : new MemoryDepotDb();
// Use FileCasStorage when CAS_STORAGE_DIR is set, otherwise MemoryCasStorage
const casStorageDir = process.env.CAS_STORAGE_DIR;
const casStorage: CasStorageInterface = casStorageDir
  ? new FileCasStorage(casStorageDir)
  : new MemoryCasStorage();
const pendingAuthStore = useDynamo
  ? new AwpPendingAuthStore(loadConfig())
  : new MemoryAwpPendingAuthStore();
const pubkeyStore = useDynamo ? new AwpPubkeyStore(loadConfig()) : new MemoryAwpPubkeyStore();
const agentTokensDb = useDynamo
  ? createAgentTokensDbAdapter(tokensDb as TokensDb, loadServerConfig())
  : new MemoryAgentTokensDb();
const userRolesDb = useDynamo ? new UserRolesDb(loadConfig()) : null;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "Content-Type,Authorization,X-AWP-Pubkey,X-AWP-Timestamp,X-AWP-Signature",
  "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function binaryResponse(content: Buffer, contentType: string): Response {
  return new Response(new Uint8Array(content), {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Length": content.length.toString(),
      ...CORS_HEADERS,
    },
  });
}

function errorResponse(status: number, error: string, details?: unknown): Response {
  return jsonResponse(status, { error, details });
}

interface AuthContext {
  userId: string;
  scope: string;
  canRead: boolean;
  canWrite: boolean;
  canIssueTicket: boolean;
  tokenId: string;
  allowedKey?: string;
}

async function authenticate(req: Request): Promise<AuthContext | null> {
  // First check for AWP signed request
  const awpPubkey = req.headers.get(AWP_AUTH_HEADERS.pubkey);
  if (awpPubkey) {
    return authenticateAwp(req);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return null;

  const [_scheme, tokenValue] = authHeader.split(" ");
  if (!tokenValue) return null;

  // Check if it's a JWT (Cognito token) - JWTs have 3 parts separated by dots
  if (tokenValue.split(".").length === 3) {
    const cognitoPayload = await verifyCognitoToken(tokenValue);
    if (cognitoPayload) {
      // Create or get user token for this Cognito user
      const userId = cognitoPayload.sub;

      // Check if we already have a user token for this session
      // For simplicity, create a new one each time (or reuse existing)
      const userToken = await tokensDb.createUserToken(userId, "cognito-session", 3600);
      const tokenId = tokenIdFromPk(userToken.pk);

      console.log(`[Cognito] Authenticated user: ${cognitoPayload.email ?? userId}`);

      return {
        userId,
        scope: `usr_${userId}`,
        canRead: true,
        canWrite: true,
        canIssueTicket: true,
        tokenId,
      };
    }
    // If JWT verification failed, fall through to try as internal token
  }

  // Try as internal token (user token or ticket)
  const token = await tokensDb.getToken(tokenValue);
  if (!token) return null;

  const id = tokenIdFromPk(token.pk);

  if (token.type === "user") {
    return {
      userId: token.userId,
      scope: `usr_${token.userId}`,
      canRead: true,
      canWrite: true,
      canIssueTicket: true,
      tokenId: id,
    };
  }

  if (token.type === "ticket") {
    return {
      userId: "",
      scope: token.realm,
      canRead: true,
      canWrite: !!token.commit && !token.commit.root,
      canIssueTicket: false,
      tokenId: id,
      allowedKey: token.scope?.[0],
    };
  }

  return null;
}

async function authenticateByTicketId(ticketId: string): Promise<AuthContext | null> {
  const token = await tokensDb.getToken(ticketId);
  if (!token || token.type !== "ticket") return null;

  const id = tokenIdFromPk(token.pk);
  return {
    userId: "",
    scope: token.realm,
    canRead: true,
    canWrite: !!token.commit && !token.commit.root,
    canIssueTicket: false,
    tokenId: id,
    allowedKey: token.scope?.[0],
  };
}

async function authenticateAwp(req: Request): Promise<AuthContext | null> {
  const pubkey = req.headers.get(AWP_AUTH_HEADERS.pubkey);
  const timestamp = req.headers.get(AWP_AUTH_HEADERS.timestamp);
  const signature = req.headers.get(AWP_AUTH_HEADERS.signature);

  if (!pubkey || !timestamp || !signature) {
    return null;
  }

  // Look up the pubkey
  const authorizedPubkey = await pubkeyStore.lookup(pubkey);
  if (!authorizedPubkey) {
    return null;
  }

  // Verify timestamp
  if (!validateTimestamp(timestamp, 300)) {
    // 5 minute max clock skew
    console.log(`[AWP] Timestamp validation failed for pubkey: ${pubkey.slice(0, 20)}...`);
    return null;
  }

  // Verify the signature
  const url = new URL(req.url);
  const body = req.method === "GET" || req.method === "HEAD" ? "" : await req.clone().text();

  // Build signature payload: timestamp.METHOD.path.bodyHash
  const bodyHash = cryptoCreateHash("sha256").update(body).digest("hex");
  const signaturePayload = `${timestamp}.${req.method.toUpperCase()}.${url.pathname + url.search}.${bodyHash}`;

  const isValid = await verifySignature(pubkey, signaturePayload, signature);

  if (!isValid) {
    console.log(`[AWP] Signature verification failed for pubkey: ${pubkey.slice(0, 20)}...`);
    return null;
  }

  console.log(`[AWP] Authenticated client: ${authorizedPubkey.clientName}`);

  return {
    userId: authorizedPubkey.userId,
    scope: `usr_${authorizedPubkey.userId}`,
    canRead: true,
    canWrite: true,
    canIssueTicket: true,
    tokenId: `awp_${pubkey.slice(0, 16)}`,
  };
}

// ============================================================================
// Request Handlers
// ============================================================================

const COGNITO_HOSTED_UI_URL = process.env.COGNITO_HOSTED_UI_URL ?? "";
const COGNITO_CLIENT_ID = process.env.CASFA_COGNITO_CLIENT_ID ?? process.env.COGNITO_CLIENT_ID ?? "";

async function handleOAuth(req: Request, path: string): Promise<Response> {
  // GET /oauth/config - Public Cognito config for frontend (no auth)
  if (req.method === "GET" && path === "/config") {
    return jsonResponse(200, {
      cognitoUserPoolId: COGNITO_USER_POOL_ID,
      cognitoClientId: COGNITO_CLIENT_ID,
      cognitoHostedUiUrl: COGNITO_HOSTED_UI_URL,
    });
  }

  // POST /oauth/token - Exchange authorization code for tokens
  if (req.method === "POST" && path === "/token") {
    if (!COGNITO_HOSTED_UI_URL || !COGNITO_CLIENT_ID) {
      return errorResponse(
        503,
        "OAuth / Google sign-in not configured (missing Hosted UI URL or Client ID)"
      );
    }
    const body = (await req.json()) as { code?: string; redirect_uri?: string };
    if (!body.code || !body.redirect_uri) {
      return errorResponse(400, "Missing code or redirect_uri");
    }
    const tokenBody = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: COGNITO_CLIENT_ID,
      code: body.code,
      redirect_uri: body.redirect_uri,
    });
    const tokenRes = await fetch(`${COGNITO_HOSTED_UI_URL}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenBody.toString(),
    });
    const text = await tokenRes.text();
    if (!tokenRes.ok) {
      console.error("[OAuth] Token exchange failed:", tokenRes.status, text);
      return jsonResponse(tokenRes.status, { error: "Token exchange failed", details: text });
    }
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      return errorResponse(502, "Invalid token response from Cognito");
    }
    return jsonResponse(200, data);
  }

  // GET /oauth/me - Current user info and role (requires auth)
  if (req.method === "GET" && path === "/me") {
    const auth = await authenticate(req);
    if (!auth) {
      return errorResponse(401, "Unauthorized");
    }
    // Ensure user record exists so admins can see and authorize them
    if (userRolesDb && auth.userId) {
      await userRolesDb.ensureUser(auth.userId);
    }
    const role = userRolesDb ? await userRolesDb.getRole(auth.userId) : "authorized";
    return jsonResponse(200, {
      userId: auth.userId,
      realm: auth.scope,
      role,
    });
  }

  return errorResponse(404, "OAuth endpoint not found");
}

async function handleAuth(req: Request, path: string): Promise<Response> {
  // ========================================================================
  // AWP Client Routes (no auth required for init/status)
  // ========================================================================

  // POST /auth/clients/init - Start AWP auth flow
  if (req.method === "POST" && path === "/clients/init") {
    const body = (await req.json()) as { pubkey?: string; client_name?: string };
    if (!body.pubkey || !body.client_name) {
      return errorResponse(400, "Missing pubkey or client_name");
    }

    const verificationCode = generateVerificationCode();
    const now = Date.now();
    const expiresIn = 600; // 10 minutes

    await pendingAuthStore.create({
      pubkey: body.pubkey,
      clientName: body.client_name,
      verificationCode,
      createdAt: now,
      expiresAt: now + expiresIn * 1000,
    });

    // Build auth URL
    const url = new URL(req.url);
    const authUrl = `${url.origin}/auth/awp?pubkey=${encodeURIComponent(body.pubkey)}`;

    console.log(`[AWP] Auth initiated for client: ${body.client_name}`);
    console.log(`[AWP] Verification code: ${verificationCode}`);

    return jsonResponse(200, {
      auth_url: authUrl,
      verification_code: verificationCode,
      expires_in: expiresIn,
      poll_interval: 5,
    });
  }

  // GET /auth/clients/status - Poll for auth completion
  if (req.method === "GET" && path === "/clients/status") {
    const url = new URL(req.url);
    const pubkey = url.searchParams.get("pubkey");
    if (!pubkey) {
      return errorResponse(400, "Missing pubkey parameter");
    }

    const authorized = await pubkeyStore.lookup(pubkey);
    if (authorized) {
      return jsonResponse(200, {
        authorized: true,
        expires_at: authorized.expiresAt,
      });
    }

    // Check if pending auth exists
    const pending = await pendingAuthStore.get(pubkey);
    if (!pending) {
      return jsonResponse(200, {
        authorized: false,
        error: "No pending authorization found",
      });
    }

    return jsonResponse(200, {
      authorized: false,
    });
  }

  // POST /auth/clients/complete - Complete authorization (requires user auth)
  if (req.method === "POST" && path === "/clients/complete") {
    const auth = await authenticate(req);
    if (!auth) {
      return errorResponse(401, "User authentication required");
    }

    const body = (await req.json()) as { pubkey?: string; verification_code?: string };
    if (!body.pubkey || !body.verification_code) {
      return errorResponse(400, "Missing pubkey or verification_code");
    }

    // Validate verification code
    const isValid = await pendingAuthStore.validateCode(body.pubkey, body.verification_code);
    if (!isValid) {
      return errorResponse(400, "Invalid or expired verification code");
    }

    // Get pending auth to retrieve client name
    const pending = await pendingAuthStore.get(body.pubkey);
    if (!pending) {
      return errorResponse(400, "Pending authorization not found");
    }

    // Store authorized pubkey
    const now = Date.now();
    const expiresAt = now + 30 * 24 * 60 * 60 * 1000; // 30 days

    await pubkeyStore.store({
      pubkey: body.pubkey,
      userId: auth.userId,
      clientName: pending.clientName,
      createdAt: now,
      expiresAt,
    });

    // Clean up pending auth
    await pendingAuthStore.delete(body.pubkey);

    console.log(`[AWP] Client authorized: ${pending.clientName} for user: ${auth.userId}`);

    return jsonResponse(200, {
      success: true,
      expires_at: expiresAt,
    });
  }

  // Routes requiring auth
  const auth = await authenticate(req);
  if (!auth) {
    return errorResponse(401, "Unauthorized - use Cognito via cas-webui to login");
  }

  // Ensure user record exists so admins can see and authorize them
  if (userRolesDb && auth.userId) {
    await userRolesDb.ensureUser(auth.userId);
  }

  // GET /auth/clients - List authorized AWP clients
  if (req.method === "GET" && path === "/clients") {
    const clients = await pubkeyStore.listByUser(auth.userId);
    return jsonResponse(200, {
      clients: clients.map((c) => ({
        pubkey: c.pubkey,
        clientName: c.clientName,
        createdAt: new Date(c.createdAt).toISOString(),
        expiresAt: c.expiresAt ? new Date(c.expiresAt).toISOString() : null,
      })),
    });
  }

  // DELETE /auth/clients/:pubkey - Revoke AWP client
  const clientRevokeMatch = path.match(/^\/clients\/(.+)$/);
  if (req.method === "DELETE" && clientRevokeMatch) {
    const pubkey = decodeURIComponent(clientRevokeMatch[1]!);

    // Verify ownership
    const client = await pubkeyStore.lookup(pubkey);
    if (!client || client.userId !== auth.userId) {
      return errorResponse(404, "Client not found or access denied");
    }

    await pubkeyStore.revoke(pubkey);
    console.log(`[AWP] Client revoked: ${client.clientName}`);
    return jsonResponse(200, { success: true });
  }

  // POST /auth/ticket
  if (req.method === "POST" && path === "/ticket") {
    if (!auth.canIssueTicket) {
      return errorResponse(403, "Not authorized to issue tickets");
    }
    const body = (await req.json()) as {
      scope?: string | string[];
      commit?: boolean | { quota?: number; accept?: string[] };
      expiresIn?: number;
    };
    // Normalize scope to string[] | undefined
    const normalizedScope = body.scope === undefined
      ? undefined
      : Array.isArray(body.scope) ? body.scope : [body.scope];
    // Normalize commit: true -> {}, false/undefined -> undefined
    const normalizedCommit = body.commit === true
      ? {}
      : body.commit === false || body.commit === undefined
        ? undefined
        : body.commit;
    const ticket = await tokensDb.createTicket(
      auth.scope,
      auth.tokenId,
      normalizedScope,
      normalizedCommit,
      body.expiresIn
    );
    const ticketId = tokenIdFromPk(ticket.pk);
    const serverConfig = loadServerConfig();
    return jsonResponse(201, {
      id: ticketId,
      endpoint: `${serverConfig.baseUrl}/api/ticket/${ticketId}`,
      expiresAt: new Date(ticket.expiresAt).toISOString(),
      realm: ticket.realm,
      scope: ticket.scope,
      commit: ticket.commit ?? false,
      config: ticket.config,
    });
  }

  // DELETE /auth/ticket/:id
  const ticketMatch = path.match(/^\/ticket\/([^/]+)$/);
  if (req.method === "DELETE" && ticketMatch) {
    const ticketId = ticketMatch[1]!;
    const isOwner = await tokensDb.verifyTokenOwnership(ticketId, auth.userId);
    if (!isOwner) {
      return errorResponse(404, "Ticket not found");
    }
    await tokensDb.deleteToken(ticketId);
    return jsonResponse(200, { success: true });
  }

  // ========================================================================
  // Agent Token Management Routes (for WebUI)
  // ========================================================================

  // GET /auth/tokens - List agent tokens
  if (req.method === "GET" && path === "/tokens") {
    const tokens = await agentTokensDb.listByUser(auth.userId);
    return jsonResponse(200, {
      tokens: tokens.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        expiresAt: new Date(t.expiresAt).toISOString(),
        createdAt: new Date(t.createdAt).toISOString(),
      })),
    });
  }

  // POST /auth/tokens - Create agent token
  if (req.method === "POST" && path === "/tokens") {
    const body = (await req.json()) as {
      name?: string;
      description?: string;
      expiresIn?: number;
    };
    if (!body.name) {
      return errorResponse(400, "Missing name");
    }
    const token = await agentTokensDb.create(auth.userId, body.name, {
      description: body.description,
      expiresIn: body.expiresIn,
    });
    return jsonResponse(201, {
      id: token.id,
      name: token.name,
      description: token.description,
      expiresAt: new Date(token.expiresAt).toISOString(),
      createdAt: new Date(token.createdAt).toISOString(),
    });
  }

  // DELETE /auth/tokens/:id - Revoke agent token
  const agentTokenMatch = path.match(/^\/tokens\/([^/]+)$/);
  if (req.method === "DELETE" && agentTokenMatch) {
    const tokenId = agentTokenMatch[1]!;
    const success = await agentTokensDb.revoke(auth.userId, tokenId);
    if (!success) {
      return errorResponse(404, "Agent token not found");
    }
    return jsonResponse(200, { success: true });
  }

  return errorResponse(404, "Auth endpoint not found");
}

async function handleAdmin(req: Request, path: string): Promise<Response> {
  const auth = await authenticate(req);
  if (!auth) {
    return errorResponse(401, "Unauthorized");
  }

  // Helper: current user is admin (when userRolesDb: check role; when in-memory: allow for dev)
  const isAdmin = userRolesDb ? (await userRolesDb.getRole(auth.userId)) === "admin" : true;
  if (!isAdmin) {
    return errorResponse(403, "Admin access required");
  }

  // GET /admin/users - List users with roles, enriched with email/name from Cognito
  if (req.method === "GET" && path === "/users") {
    if (!userRolesDb) return jsonResponse(200, { users: [] });
    const list = await userRolesDb.listRoles();
    const cognitoMap = await getCognitoUserMap(COGNITO_USER_POOL_ID, COGNITO_REGION);
    const users = list.map((u) => {
      const attrs = cognitoMap.get(u.userId);
      return {
        userId: u.userId,
        role: u.role,
        email: attrs?.email ?? "",
        name: attrs?.name ?? undefined,
      };
    });
    return jsonResponse(200, { users });
  }

  // POST /admin/users/:userId/authorize - Set user role
  const authorizePostMatch = path.match(/^\/users\/([^/]+)\/authorize$/);
  if (req.method === "POST" && authorizePostMatch) {
    if (!userRolesDb)
      return errorResponse(503, "User role management requires DynamoDB (set DYNAMODB_ENDPOINT)");
    const targetUserId = decodeURIComponent(authorizePostMatch[1]!);
    const body = (await req.json()) as { role?: string };
    const role = body.role === "admin" ? "admin" : "authorized";
    await userRolesDb.setRole(targetUserId, role);
    return jsonResponse(200, { userId: targetUserId, role });
  }

  // DELETE /admin/users/:userId/authorize - Revoke user
  const authorizeDeleteMatch = path.match(/^\/users\/([^/]+)\/authorize$/);
  if (req.method === "DELETE" && authorizeDeleteMatch) {
    if (!userRolesDb)
      return errorResponse(503, "User role management requires DynamoDB (set DYNAMODB_ENDPOINT)");
    const targetUserId = decodeURIComponent(authorizeDeleteMatch[1]!);
    await userRolesDb.revoke(targetUserId);
    return jsonResponse(200, { userId: targetUserId, revoked: true });
  }

  return errorResponse(404, "Admin endpoint not found");
}

/**
 * Handle /api/realm/{realmId}/... routes
 * These are the standard CAS API endpoints matching router.ts
 */
async function handleRealm(req: Request, realmId: string, subPath: string): Promise<Response> {
  const serverConfig = loadServerConfig();

  // Authenticate - requires Authorization header
  const auth = await authenticate(req);
  if (!auth) {
    return errorResponse(401, "Authorization required");
  }

  // Check realm access - user can only access their own realm
  if (realmId !== auth.scope) {
    return errorResponse(403, "Access denied to this realm");
  }

  const realm = realmId;

  // GET /realm/{realmId} - Return endpoint info
  if (req.method === "GET" && subPath === "") {
    return jsonResponse(200, {
      realm,
      commit: auth.canWrite ? {} : undefined,
      nodeLimit: serverConfig.nodeLimit,
      maxNameBytes: serverConfig.maxNameBytes,
    });
  }

  // GET /commits - List commits for realm
  if (req.method === "GET" && subPath === "/commits") {
    const url = new URL(req.url);
    const limit = Math.min(Number.parseInt(url.searchParams.get("limit") ?? "100", 10), 1000);
    const result = await commitsDb.listByScan(realm, { limit });
    return jsonResponse(200, {
      commits: result.commits.map((c) => ({
        root: c.root,
        title: c.title,
        createdAt: new Date(c.createdAt).toISOString(),
      })),
      nextKey: result.nextKey,
    });
  }

  // GET /commits/:root - Get commit details
  const getCommitMatch = subPath.match(/^\/commits\/(.+)$/);
  if (req.method === "GET" && getCommitMatch) {
    const root = decodeURIComponent(getCommitMatch[1]!);
    const commit = await commitsDb.get(realm, root);
    if (!commit) {
      return errorResponse(404, "Commit not found");
    }
    return jsonResponse(200, {
      root: commit.root,
      title: commit.title,
      createdAt: new Date(commit.createdAt).toISOString(),
    });
  }

  // PATCH /commits/:root - Update commit metadata
  const patchCommitMatch = subPath.match(/^\/commits\/(.+)$/);
  if (req.method === "PATCH" && patchCommitMatch) {
    const root = decodeURIComponent(patchCommitMatch[1]!);
    const body = (await req.json()) as { title?: string };
    const updated = await commitsDb.updateTitle(realm, root, body.title);
    if (!updated) {
      return errorResponse(404, "Commit not found");
    }
    return jsonResponse(200, { success: true });
  }

  // DELETE /commits/:root - Delete commit
  const deleteCommitMatch = subPath.match(/^\/commits\/(.+)$/);
  if (req.method === "DELETE" && deleteCommitMatch) {
    const root = decodeURIComponent(deleteCommitMatch[1]!);
    const deleted = await commitsDb.delete(realm, root);
    if (!deleted) {
      return errorResponse(404, "Commit not found");
    }
    return jsonResponse(200, { success: true });
  }

  // POST /commit - Create a new commit
  if (req.method === "POST" && subPath === "/commit") {
    if (!auth.canWrite) {
      return errorResponse(403, "Write access denied");
    }
    const body = (await req.json()) as {
      title?: string;
      tree?: Record<string, unknown>;
      root?: string;
    };

    // Build collection from tree structure
    if (body.tree && Object.keys(body.tree).length > 0) {
      // Recursively build CAS collection structure
      const buildCollection = async (
        tree: Record<string, unknown>
      ): Promise<{ key: string; size: number }> => {
        const children: Record<string, string> = {};
        let totalSize = 0;

        for (const [name, value] of Object.entries(tree)) {
          if (typeof value === "object" && value !== null) {
            const v = value as Record<string, unknown>;
            if ("chunks" in v && Array.isArray(v.chunks)) {
              // It's a file reference - use the first chunk as the file key
              const chunkKey = v.chunks[0] as string;
              children[name] = chunkKey;
              totalSize += (v.size as number) || 0;
            } else {
              // It's a nested folder
              const subCollection = await buildCollection(v);
              children[name] = subCollection.key;
              totalSize += subCollection.size;
            }
          }
        }

        // Create collection
        const collectionData = JSON.stringify({ children });
        const content = Buffer.from(collectionData, "utf-8");
        const hash = cryptoCreateHash("sha256").update(content).digest("hex");
        const collectionKey = `sha256:${hash}`;

        await casStorage.putWithKey(collectionKey, content, "application/vnd.cas.collection");
        await ownershipDb.addOwnership(realm, collectionKey, auth.tokenId, "application/vnd.cas.collection", content.length);

        return { key: collectionKey, size: totalSize };
      };

      const rootCollection = await buildCollection(body.tree);
      
      // Create commit record
      await commitsDb.create(realm, rootCollection.key, auth.tokenId, body.title);

      return jsonResponse(200, {
        success: true,
        root: rootCollection.key,
      });
    }

    // If root is provided directly
    if (body.root) {
      await commitsDb.create(realm, body.root, auth.tokenId, body.title);
      return jsonResponse(200, {
        success: true,
        root: body.root,
      });
    }

    return errorResponse(400, "Either tree or root is required");
  }

  // PUT /chunks/:key - Upload chunk
  const putChunkMatch = subPath.match(/^\/chunks\/(.+)$/);
  if (req.method === "PUT" && putChunkMatch) {
    if (!auth.canWrite) {
      return errorResponse(403, "Write access denied");
    }
    const key = decodeURIComponent(putChunkMatch[1]!);
    const content = Buffer.from(await req.arrayBuffer());
    if (content.length === 0) {
      return errorResponse(400, "Empty body");
    }
    const contentType = req.headers.get("Content-Type") ?? "application/octet-stream";

    const result = await casStorage.putWithKey(key, content, contentType);
    if ("error" in result) {
      return errorResponse(400, "Hash mismatch", {
        expected: result.expected,
        actual: result.actual,
      });
    }

    await ownershipDb.addOwnership(realm, result.key, auth.tokenId, contentType, result.size);

    return jsonResponse(200, {
      key: result.key,
      size: result.size,
    });
  }

  // GET /chunks/:key - Get chunk
  const getChunkMatch = subPath.match(/^\/chunks\/(.+)$/);
  if (req.method === "GET" && getChunkMatch) {
    if (!auth.canRead) {
      return errorResponse(403, "Read access denied");
    }
    const key = decodeURIComponent(getChunkMatch[1]!);

    const hasAccess = await ownershipDb.hasOwnership(realm, key);
    if (!hasAccess) {
      return errorResponse(404, "Not found");
    }

    const blob = await casStorage.get(key);
    if (!blob) {
      return errorResponse(404, "Content not found");
    }

    return binaryResponse(blob.content, blob.contentType);
  }

  // GET /tree/:key - Get tree structure
  const getTreeMatch = subPath.match(/^\/tree\/(.+)$/);
  if (req.method === "GET" && getTreeMatch) {
    if (!auth.canRead) {
      return errorResponse(403, "Read access denied");
    }
    const rootKey = decodeURIComponent(getTreeMatch[1]!);

    const hasAccess = await ownershipDb.hasOwnership(realm, rootKey);
    if (!hasAccess) {
      return errorResponse(404, "Not found");
    }

    // Build tree recursively
    const buildTree = async (key: string): Promise<Record<string, unknown> | null> => {
      const blob = await casStorage.get(key);
      if (!blob) return null;

      const { content, contentType, metadata } = blob;

      if (contentType === "application/vnd.cas.collection") {
        try {
          const data = JSON.parse(content.toString("utf-8"));
          const children = data.children as Record<string, string>;
          const result: Record<string, unknown> = {
            kind: "collection",
            key,
            size: metadata.casSize ?? content.length,
            children: {} as Record<string, unknown>,
          };

          for (const [name, childKey] of Object.entries(children)) {
            const childTree = await buildTree(childKey);
            if (childTree) {
              (result.children as Record<string, unknown>)[name] = childTree;
            }
          }
          return result;
        } catch {
          return null;
        }
      } else {
        // It's a file/chunk
        return {
          kind: "file",
          key,
          size: metadata.casSize ?? content.length,
          contentType: metadata.casContentType ?? contentType,
        };
      }
    };

    const tree = await buildTree(rootKey);
    if (!tree) {
      return errorResponse(404, "Failed to build tree");
    }

    return jsonResponse(200, tree);
  }

  // ========================================================================
  // Depot Routes
  // ========================================================================

  // GET /depots - List all depots
  if (req.method === "GET" && subPath === "/depots") {
    if (!auth.canRead) {
      return errorResponse(403, "Read access required");
    }
    // Ensure empty collection and main depot exist
    await ensureEmptyCollection(realm, auth.tokenId);
    await depotDb.ensureMainDepot(realm, EMPTY_COLLECTION_KEY);
    const result = await depotDb.list(realm);
    return jsonResponse(200, {
      depots: result.depots.map((d) => ({
        depotId: d.depotId,
        name: d.name,
        root: d.root,
        version: d.version,
        createdAt: new Date(d.createdAt).toISOString(),
        updatedAt: new Date(d.updatedAt).toISOString(),
        description: d.description,
      })),
      cursor: result.nextKey,
    });
  }

  // POST /depots - Create a new depot
  if (req.method === "POST" && subPath === "/depots") {
    if (!auth.canWrite) {
      return errorResponse(403, "Write access required");
    }
    const body = (await req.json()) as { name: string; description?: string };
    if (!body.name) {
      return errorResponse(400, "Name is required");
    }

    // Check if depot with this name already exists
    const existing = await depotDb.getByName(realm, body.name);
    if (existing) {
      return errorResponse(409, `Depot with name '${body.name}' already exists`);
    }

    // Ensure empty collection exists
    await ensureEmptyCollection(realm, auth.tokenId);

    const depot = await depotDb.create(realm, {
      name: body.name,
      root: EMPTY_COLLECTION_KEY,
      description: body.description,
    });

    return jsonResponse(201, {
      depotId: depot.depotId,
      name: depot.name,
      root: depot.root,
      version: depot.version,
      createdAt: new Date(depot.createdAt).toISOString(),
      updatedAt: new Date(depot.updatedAt).toISOString(),
      description: depot.description,
    });
  }

  // GET /depots/:depotId - Get depot by ID
  const getDepotMatch = subPath.match(/^\/depots\/([^/]+)$/);
  if (req.method === "GET" && getDepotMatch) {
    if (!auth.canRead) {
      return errorResponse(403, "Read access required");
    }
    const depotId = decodeURIComponent(getDepotMatch[1]!);
    const depot = await depotDb.get(realm, depotId);
    if (!depot) {
      return errorResponse(404, "Depot not found");
    }
    return jsonResponse(200, {
      depotId: depot.depotId,
      name: depot.name,
      root: depot.root,
      version: depot.version,
      createdAt: new Date(depot.createdAt).toISOString(),
      updatedAt: new Date(depot.updatedAt).toISOString(),
      description: depot.description,
    });
  }

  // PUT /depots/:depotId - Update depot root
  const putDepotMatch = subPath.match(/^\/depots\/([^/]+)$/);
  if (req.method === "PUT" && putDepotMatch) {
    if (!auth.canWrite) {
      return errorResponse(403, "Write access required");
    }
    const depotId = decodeURIComponent(putDepotMatch[1]!);
    const body = (await req.json()) as { root: string; message?: string };
    if (!body.root) {
      return errorResponse(400, "Root is required");
    }

    const depot = await depotDb.get(realm, depotId);
    if (!depot) {
      return errorResponse(404, "Depot not found");
    }

    const { depot: updatedDepot } = await depotDb.updateRoot(realm, depotId, body.root, body.message);
    return jsonResponse(200, {
      depotId: updatedDepot.depotId,
      name: updatedDepot.name,
      root: updatedDepot.root,
      version: updatedDepot.version,
      createdAt: new Date(updatedDepot.createdAt).toISOString(),
      updatedAt: new Date(updatedDepot.updatedAt).toISOString(),
      description: updatedDepot.description,
    });
  }

  // DELETE /depots/:depotId - Delete depot
  const deleteDepotMatch = subPath.match(/^\/depots\/([^/]+)$/);
  if (req.method === "DELETE" && deleteDepotMatch) {
    if (!auth.canWrite) {
      return errorResponse(403, "Write access required");
    }
    const depotId = decodeURIComponent(deleteDepotMatch[1]!);
    const depot = await depotDb.get(realm, depotId);
    if (!depot) {
      return errorResponse(404, "Depot not found");
    }
    if (depot.name === MAIN_DEPOT_NAME) {
      return errorResponse(403, "Cannot delete the main depot");
    }
    await depotDb.delete(realm, depotId);
    return jsonResponse(200, { deleted: true });
  }

  // GET /depots/:depotId/history - List depot history
  const getHistoryMatch = subPath.match(/^\/depots\/([^/]+)\/history$/);
  if (req.method === "GET" && getHistoryMatch) {
    if (!auth.canRead) {
      return errorResponse(403, "Read access required");
    }
    const depotId = decodeURIComponent(getHistoryMatch[1]!);
    const depot = await depotDb.get(realm, depotId);
    if (!depot) {
      return errorResponse(404, "Depot not found");
    }
    const result = await depotDb.listHistory(realm, depotId);
    return jsonResponse(200, {
      history: result.history.map((h) => ({
        version: h.version,
        root: h.root,
        createdAt: new Date(h.createdAt).toISOString(),
        message: h.message,
      })),
      cursor: result.nextKey,
    });
  }

  // POST /depots/:depotId/rollback - Rollback to a previous version
  const rollbackMatch = subPath.match(/^\/depots\/([^/]+)\/rollback$/);
  if (req.method === "POST" && rollbackMatch) {
    if (!auth.canWrite) {
      return errorResponse(403, "Write access required");
    }
    const depotId = decodeURIComponent(rollbackMatch[1]!);
    const body = (await req.json()) as { version: number };
    if (!body.version) {
      return errorResponse(400, "Version is required");
    }

    const depot = await depotDb.get(realm, depotId);
    if (!depot) {
      return errorResponse(404, "Depot not found");
    }

    const historyRecord = await depotDb.getHistory(realm, depotId, body.version);
    if (!historyRecord) {
      return errorResponse(404, `Version ${body.version} not found`);
    }

    const { depot: updatedDepot } = await depotDb.updateRoot(
      realm,
      depotId,
      historyRecord.root,
      `Rollback to version ${body.version}`
    );

    return jsonResponse(200, {
      depotId: updatedDepot.depotId,
      name: updatedDepot.name,
      root: updatedDepot.root,
      version: updatedDepot.version,
      createdAt: new Date(updatedDepot.createdAt).toISOString(),
      updatedAt: new Date(updatedDepot.updatedAt).toISOString(),
      description: updatedDepot.description,
    });
  }

  return errorResponse(404, "Realm endpoint not found");
}

async function handleCas(req: Request, requestedRealm: string, subPath: string): Promise<Response> {
  const serverConfig = loadServerConfig();

  // GET /cas/{realm} - Return endpoint info
  if (req.method === "GET" && subPath === "") {
    // Ticket realm - no auth required
    if (requestedRealm.startsWith("tkt_")) {
      const ticketId = requestedRealm;
      const token = await tokensDb.getToken(ticketId);
      if (!token || token.type !== "ticket") {
        return errorResponse(404, "Ticket not found");
      }
      if (token.expiresAt < Date.now()) {
        return errorResponse(410, "Ticket expired");
      }

      // Build commit permission
      let commit: { quota?: number; accept?: string[]; root?: string } | undefined;
      if (token.commit) {
        commit = {
          quota: token.commit.quota,
          accept: token.commit.accept,
          root: token.commit.root,
        };
      }

      return jsonResponse(200, {
        realm: token.realm,
        scope: token.scope,
        commit,
        expiresAt: new Date(token.expiresAt).toISOString(),
        nodeLimit: serverConfig.nodeLimit,
        maxNameBytes: serverConfig.maxNameBytes,
      });
    }

    // User realm - requires auth
    const auth = await authenticate(req);
    if (!auth) {
      return errorResponse(401, "Unauthorized");
    }

    let effectiveScope: string;
    if (requestedRealm === "@me" || requestedRealm === "~") {
      effectiveScope = auth.scope;
    } else {
      if (requestedRealm !== auth.scope) {
        return errorResponse(403, "Access denied to this scope");
      }
      effectiveScope = requestedRealm;
    }

    return jsonResponse(200, {
      realm: effectiveScope,
      // No scope restriction for user realm (full access)
      commit: auth.canWrite ? {} : undefined,
      nodeLimit: serverConfig.nodeLimit,
      maxNameBytes: serverConfig.maxNameBytes,
    });
  }

  // Authenticate - ticket realm uses ticket ID directly, otherwise standard auth
  let auth: AuthContext | null;
  if (requestedRealm.startsWith("tkt_")) {
    auth = await authenticateByTicketId(requestedRealm);
  } else {
    auth = await authenticate(req);
  }
  if (!auth) {
    return errorResponse(401, "Unauthorized");
  }

  // Resolve scope:
  // - @me or ~ resolves to user's scope
  // - tkt_ realm uses the ticket's actual realm
  // - explicit scope must match auth.scope
  let effectiveScope: string;
  if (requestedRealm === "@me" || requestedRealm === "~") {
    effectiveScope = auth.scope;
  } else if (requestedRealm.startsWith("tkt_")) {
    effectiveScope = auth.scope; // ticket's realm
  } else {
    // Explicit scope - must match
    if (requestedRealm !== auth.scope) {
      return errorResponse(403, "Access denied to this scope");
    }
    effectiveScope = requestedRealm;
  }

  // PUT /chunk/:key - Upload chunk data
  const putChunkMatch = subPath.match(/^\/chunk\/(.+)$/);
  if (req.method === "PUT" && putChunkMatch) {
    if (!auth.canWrite) {
      return errorResponse(403, "Write access denied");
    }
    const key = decodeURIComponent(putChunkMatch[1]!);
    const content = Buffer.from(await req.arrayBuffer());
    if (content.length === 0) {
      return errorResponse(400, "Empty body");
    }
    const contentType = req.headers.get("Content-Type") ?? "application/octet-stream";

    const result = await casStorage.putWithKey(key, content, contentType);
    if ("error" in result) {
      return errorResponse(400, "Hash mismatch", {
        expected: result.expected,
        actual: result.actual,
      });
    }

    await ownershipDb.addOwnership(
      effectiveScope,
      result.key,
      auth.tokenId,
      contentType,
      result.size
    );

    return jsonResponse(200, {
      key: result.key,
      size: result.size,
    });
  }

  // GET /tree/:key - Get complete DAG structure
  const getTreeMatch = subPath.match(/^\/tree\/(.+)$/);
  if (req.method === "GET" && getTreeMatch) {
    if (!auth.canRead) {
      return errorResponse(403, "Read access denied");
    }
    const rootKey = decodeURIComponent(getTreeMatch[1]!);

    const hasAccess = await ownershipDb.hasOwnership(effectiveScope, rootKey);
    if (!hasAccess) {
      return errorResponse(404, "Not found");
    }

    const MAX_NODES = 1000;
    const nodes: Record<string, any> = {};
    const queue: string[] = [rootKey];
    let next: string | undefined;

    while (queue.length > 0) {
      if (Object.keys(nodes).length >= MAX_NODES) {
        next = queue[0];
        break;
      }

      const key = queue.shift()!;
      if (nodes[key]) continue;

      const blob = await casStorage.get(key);
      if (!blob) continue;

      const { content, contentType, metadata } = blob;

      if (contentType === "application/vnd.cas.collection") {
        try {
          const data = JSON.parse(content.toString("utf-8"));
          const children = data.children as Record<string, string>;
          nodes[key] = {
            kind: "collection",
            size: metadata.casSize ?? content.length,
            children,
          };
          for (const childKey of Object.values(children)) {
            if (!nodes[childKey]) {
              queue.push(childKey);
            }
          }
        } catch {
          // Invalid JSON
        }
      } else if (contentType === "application/vnd.cas.file") {
        const chunkCount = content.length / 64;
        nodes[key] = {
          kind: "file",
          size: metadata.casSize ?? 0,
          contentType: metadata.casContentType,
          chunks: chunkCount,
        };
      } else if (contentType === "application/vnd.cas.inline-file") {
        nodes[key] = {
          kind: "inline-file",
          size: metadata.casSize ?? content.length,
          contentType: metadata.casContentType,
        };
      }
    }

    const response: any = { nodes };
    if (next) {
      response.next = next;
    }

    return jsonResponse(200, response);
  }

  // GET /raw/:key - Get raw node data with metadata headers
  const getRawMatch = subPath.match(/^\/raw\/(.+)$/);
  if (req.method === "GET" && getRawMatch) {
    if (!auth.canRead) {
      return errorResponse(403, "Read access denied");
    }
    const key = decodeURIComponent(getRawMatch[1]!);

    if (auth.allowedKey && auth.allowedKey !== key) {
      return errorResponse(403, "Read access denied for this key");
    }

    const hasAccess = await ownershipDb.hasOwnership(effectiveScope, key);
    if (!hasAccess) {
      return errorResponse(404, "Not found");
    }

    const blob = await casStorage.get(key);
    if (!blob) {
      return errorResponse(404, "Content not found");
    }

    const { content, contentType, metadata } = blob;
    const headers: Record<string, string> = {
      "Content-Type": contentType,
      "Content-Length": String(content.length),
    };

    if (metadata.casContentType) {
      headers["X-CAS-Content-Type"] = metadata.casContentType;
    }
    if (metadata.casSize !== undefined) {
      headers["X-CAS-Size"] = String(metadata.casSize);
    }

    return new Response(new Uint8Array(content), { status: 200, headers });
  }

  return errorResponse(404, "CAS endpoint not found");
}

// ============================================================================
// Server
// ============================================================================

const PORT = parseInt(process.env.CAS_API_PORT ?? process.env.PORT ?? "3550", 10);

if (!COGNITO_USER_POOL_ID) {
  console.error("ERROR: COGNITO_USER_POOL_ID environment variable is required");
  console.error("Set COGNITO_USER_POOL_ID in .env, or run: awp config pull");
  process.exit(1);
}

const authInfo = `║  Auth: Cognito + Google Sign-In                              ║
║    User Pool: ${COGNITO_USER_POOL_ID.padEnd(43)}║
║    Login via cas-webui with Google                           ║`;

const storageInfo = useDynamo
  ? "║  Storage: DynamoDB (local)"
  : "║  Storage: In-memory (set DYNAMODB_ENDPOINT for local DynamoDB)";

console.log(`
╔══════════════════════════════════════════════════════════════╗
║                      CASFA Local Server                      ║
╠══════════════════════════════════════════════════════════════╣
║  URL: http://localhost:${String(PORT).padEnd(38)}║
║                                                              ║
${authInfo}
║                                                              ║
${storageInfo.padEnd(58)}║
║  Endpoints:                                                  ║
║    GET  /api/health             - Health check               ║
║    GET  /api/oauth/config       - Cognito config             ║
║    GET  /api/oauth/me           - Current user info          ║
║    GET  /api/auth/clients       - List AWP clients           ║
║    GET  /api/auth/tokens        - List agent tokens          ║
║    POST /api/auth/ticket        - Create ticket              ║
║    GET  /api/admin/users        - List users (admin)         ║
║    */api/realm/{realmId}/...   - Realm operations (auth)    ║
║    */api/ticket/{ticketId}/... - Ticket operations (no auth)║
╚══════════════════════════════════════════════════════════════╝
`);

Bun.serve({
  port: PORT,
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    console.log(`[${new Date().toISOString()}] ${req.method} ${path}`);

    // CORS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    try {
      // All API routes under /api prefix
      if (!path.startsWith("/api/")) {
        return errorResponse(404, "Not found");
      }

      // Strip /api prefix for internal routing
      const apiPath = path.slice(4); // Remove "/api"

      // Health check
      if (apiPath === "/health") {
        return jsonResponse(200, { status: "ok", service: "casfa-local" });
      }

      // OAuth routes (login/authentication)
      if (apiPath.startsWith("/oauth/")) {
        return handleOAuth(req, apiPath.replace("/oauth", ""));
      }

      // Auth routes (authorization)
      if (apiPath.startsWith("/auth/")) {
        return handleAuth(req, apiPath.replace("/auth", ""));
      }

      // Admin routes
      if (apiPath.startsWith("/admin/")) {
        return handleAdmin(req, apiPath.replace("/admin", ""));
      }

      // Realm routes (same as CAS routes, just different path format)
      const realmMatch = apiPath.match(/^\/realm\/([^/]+)(.*)$/);
      if (realmMatch) {
        const [, realmId, subPath] = realmMatch;
        return handleRealm(req, realmId!, subPath ?? "");
      }

      // CAS routes (legacy)
      const casMatch = apiPath.match(/^\/cas\/([^/]+)(.*)$/);
      if (casMatch) {
        const [, scope, subPath] = casMatch;
        return handleCas(req, scope!, subPath ?? "");
      }

      return errorResponse(404, "Not found");
    } catch (error: any) {
      console.error("Server error:", error);
      return errorResponse(500, error.message ?? "Internal server error");
    }
  },
});
