/**
 * DynamoDB store implementations for AWP Auth
 */

export {
  DynamoDBPendingAuthStore,
  type DynamoDBPendingAuthStoreOptions,
} from "./dynamodb-pending-auth-store.ts";

export {
  DynamoDBPubkeyStore,
  type DynamoDBPubkeyStoreOptions,
} from "./dynamodb-pubkey-store.ts";
