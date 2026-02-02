/**
 * Memory AWP Auth Stores
 *
 * In-memory implementations of PendingAuthStore and PubkeyStore for local development.
 */

import type { AuthorizedPubkey, PendingAuth } from "@agent-web-portal/auth";
import type { IPendingAuthStore, IPubkeyStore } from "./types.ts";

export class MemoryAwpPendingAuthStore implements IPendingAuthStore {
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

export class MemoryAwpPubkeyStore implements IPubkeyStore {
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
