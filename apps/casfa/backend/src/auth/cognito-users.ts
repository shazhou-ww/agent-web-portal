/**
 * Cognito user attributes lookup (for admin user list)
 */

import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
} from "@aws-sdk/client-cognito-identity-provider";

export interface CognitoUserInfo {
  email: string;
  name?: string;
}

/**
 * List all Cognito users and return a map sub -> { email, name }.
 * Returns empty map if poolId is empty or ListUsers fails.
 */
export async function getCognitoUserMap(
  poolId: string,
  region: string
): Promise<Map<string, CognitoUserInfo>> {
  const map = new Map<string, CognitoUserInfo>();
  if (!poolId) return map;

  const client = new CognitoIdentityProviderClient({ region });
  let paginationToken: string | undefined;

  try {
    do {
      const result = await client.send(
        new ListUsersCommand({
          UserPoolId: poolId,
          Limit: 60,
          PaginationToken: paginationToken,
        })
      );

      for (const u of result.Users ?? []) {
        const sub = u.Attributes?.find((a) => a.Name === "sub")?.Value ?? "";
        const email =
          u.Attributes?.find((a) => a.Name === "email")?.Value ??
          u.Attributes?.find((a) => a.Name === "preferred_username")?.Value ??
          u.Username ??
          "";
        const name = u.Attributes?.find((a) => a.Name === "name")?.Value;
        if (sub) map.set(sub, { email, name });
      }

      paginationToken = result.PaginationToken;
    } while (paginationToken);
  } catch (err) {
    console.error("[Cognito] ListUsers failed:", err);
  }

  return map;
}
