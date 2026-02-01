/**
 * CAS Stack - User role storage (authorized / admin)
 * Reuses tokens table with pk = user#${userId}.
 */

import { DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import type { CasConfig, UserRole } from "../types.ts";
import { createDynamoDBClient } from "./client.ts";

const USER_PK_PREFIX = "user#";

function parseAdminUserIds(): string[] {
  const raw = process.env.CAS_ADMIN_USER_IDS ?? "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface UserRoleRecord {
  pk: string;
  type: "user_role";
  userId: string;
  role: "unauthorized" | "authorized" | "admin";
  createdAt: number;
  updatedAt: number;
}

export class UserRolesDb {
  private client: DynamoDBDocumentClient;
  private tableName: string;

  constructor(config: CasConfig, client?: DynamoDBDocumentClient) {
    this.tableName = config.tokensTable;
    this.client =
      client ??
      DynamoDBDocumentClient.from(createDynamoDBClient(), {
        marshallOptions: { removeUndefinedValues: true },
      });
  }

  /**
   * Resolve user role: DB first, then CAS_ADMIN_USER_IDS env.
   * Returns "unauthorized" if no record and not in admin list.
   */
  async getRole(userId: string): Promise<UserRole> {
    const pk = `${USER_PK_PREFIX}${userId}`;
    const result = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { pk },
      })
    );

    if (result.Item) {
      const r = result.Item as UserRoleRecord;
      if (r.type === "user_role") {
        return r.role;
      }
    }

    const adminIds = parseAdminUserIds();
    if (adminIds.includes(userId)) {
      return "admin";
    }

    return "unauthorized";
  }

  /**
   * Ensure user exists in DB. If no record, create one with "unauthorized" role.
   * Called on successful login so admins can see all users who have logged in.
   */
  async ensureUser(userId: string): Promise<void> {
    const pk = `${USER_PK_PREFIX}${userId}`;
    const result = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { pk },
      })
    );

    if (result.Item) {
      // User already exists, nothing to do
      return;
    }

    // Check if user is in bootstrap admin list
    const adminIds = parseAdminUserIds();
    const role = adminIds.includes(userId) ? "admin" : "unauthorized";

    const now = Date.now();
    const record: UserRoleRecord = {
      pk,
      type: "user_role",
      userId,
      role,
      createdAt: now,
      updatedAt: now,
    };

    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: record,
      })
    );
  }

  /**
   * Set user role to authorized or admin.
   */
  async setRole(userId: string, role: "authorized" | "admin"): Promise<void> {
    const now = Date.now();
    const record: UserRoleRecord = {
      pk: `${USER_PK_PREFIX}${userId}`,
      type: "user_role",
      userId,
      role,
      createdAt: now,
      updatedAt: now,
    };

    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: record,
      })
    );
  }

  /**
   * Revoke user - delete the user record from DynamoDB.
   */
  async revoke(userId: string): Promise<void> {
    const pk = `${USER_PK_PREFIX}${userId}`;

    await this.client.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: { pk },
      })
    );
  }

  /**
   * List all users with a role record. Used by admin UI.
   */
  async listRoles(): Promise<{ userId: string; role: string }[]> {
    const result = await this.client.send(
      new ScanCommand({
        TableName: this.tableName,
        FilterExpression: "begins_with(pk, :prefix) AND #t = :type",
        ExpressionAttributeNames: { "#t": "type" },
        ExpressionAttributeValues: { ":prefix": USER_PK_PREFIX, ":type": "user_role" },
      })
    );

    const items = (result.Items ?? []) as UserRoleRecord[];
    return items.map((r) => ({ userId: r.userId, role: r.role }));
  }
}
