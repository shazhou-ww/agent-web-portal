/**
 * CAS Stack - Auth Handlers (Cognito Integration)
 */

import {
  AdminInitiateAuthCommand,
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import type {
  CasConfig,
  CreateTicketRequest,
  CreateTicketResponse,
  LoginRequest,
  LoginResponse,
  RefreshRequest,
  RefreshResponse,
  AuthContext,
} from "../types.ts";
import { TokensDb } from "../db/index.ts";

export class AuthService {
  private cognito: CognitoIdentityProviderClient;
  private tokensDb: TokensDb;
  private config: CasConfig;

  constructor(
    config: CasConfig,
    tokensDb?: TokensDb,
    cognito?: CognitoIdentityProviderClient
  ) {
    this.config = config;
    this.tokensDb = tokensDb ?? new TokensDb(config);
    this.cognito =
      cognito ??
      new CognitoIdentityProviderClient({ region: config.cognitoRegion });
  }

  /**
   * Login with email/password
   */
  async login(request: LoginRequest): Promise<LoginResponse> {
    const authResult = await this.cognito.send(
      new InitiateAuthCommand({
        AuthFlow: "USER_PASSWORD_AUTH",
        ClientId: this.config.cognitoClientId,
        AuthParameters: {
          USERNAME: request.email,
          PASSWORD: request.password,
        },
      })
    );

    if (!authResult.AuthenticationResult) {
      throw new Error("Authentication failed");
    }

    const { AccessToken, RefreshToken, ExpiresIn } =
      authResult.AuthenticationResult;

    if (!AccessToken || !RefreshToken) {
      throw new Error("Missing tokens in auth response");
    }

    // Decode access token to get user info (Cognito JWT)
    const payload = this.decodeJwt(AccessToken);
    const userId = payload.sub as string;
    const email = payload.email as string;
    const name = payload.name as string | undefined;

    // Create our own user token for API access
    const userToken = await this.tokensDb.createUserToken(
      userId,
      RefreshToken,
      ExpiresIn ?? 3600
    );

    const tokenId = TokensDb.extractTokenId(userToken.pk);

    return {
      userToken: tokenId,
      refreshToken: RefreshToken,
      expiresAt: new Date(userToken.expiresAt).toISOString(),
      user: {
        id: userId,
        email,
        name,
      },
    };
  }

  /**
   * Refresh user token
   */
  async refresh(request: RefreshRequest): Promise<RefreshResponse> {
    const authResult = await this.cognito.send(
      new InitiateAuthCommand({
        AuthFlow: "REFRESH_TOKEN_AUTH",
        ClientId: this.config.cognitoClientId,
        AuthParameters: {
          REFRESH_TOKEN: request.refreshToken,
        },
      })
    );

    if (!authResult.AuthenticationResult) {
      throw new Error("Token refresh failed");
    }

    const { AccessToken, ExpiresIn } = authResult.AuthenticationResult;

    if (!AccessToken) {
      throw new Error("Missing access token in refresh response");
    }

    // Decode to get user ID
    const payload = this.decodeJwt(AccessToken);
    const userId = payload.sub as string;

    // Create new user token
    const userToken = await this.tokensDb.createUserToken(
      userId,
      request.refreshToken,
      ExpiresIn ?? 3600
    );

    const tokenId = TokensDb.extractTokenId(userToken.pk);

    return {
      userToken: tokenId,
      expiresAt: new Date(userToken.expiresAt).toISOString(),
    };
  }

  /**
   * Create ticket
   */
  async createTicket(
    auth: AuthContext,
    request: CreateTicketRequest
  ): Promise<CreateTicketResponse> {
    if (!auth.canIssueTicket) {
      throw new Error("Not authorized to issue tickets");
    }

    // Read tickets require a key
    if (request.type === "read" && !request.key) {
      throw new Error("Read tickets require a key");
    }

    const issuerId = TokensDb.extractTokenId(auth.token.pk);

    const ticket = await this.tokensDb.createTicket(
      auth.scope,
      issuerId,
      request.type,
      request.key,
      request.expiresIn
    );

    const ticketId = TokensDb.extractTokenId(ticket.pk);

    return {
      id: ticketId,
      type: ticket.ticketType,
      key: ticket.key,
      expiresAt: new Date(ticket.expiresAt).toISOString(),
    };
  }

  /**
   * Revoke ticket
   */
  async revokeTicket(auth: AuthContext, ticketId: string): Promise<void> {
    // Verify the ticket was issued by this user or their agent
    const isOwner = await this.tokensDb.verifyTokenOwnership(
      ticketId,
      auth.userId
    );
    if (!isOwner) {
      throw new Error("Ticket not found or access denied");
    }

    await this.tokensDb.deleteToken(ticketId);
  }

  /**
   * Decode JWT payload (without verification - Cognito already verified)
   */
  private decodeJwt(token: string): Record<string, unknown> {
    const parts = token.split(".");
    if (parts.length !== 3 || !parts[1]) {
      throw new Error("Invalid JWT format");
    }

    const payload = Buffer.from(parts[1], "base64url").toString("utf-8");
    return JSON.parse(payload);
  }
}
