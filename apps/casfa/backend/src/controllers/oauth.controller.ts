/**
 * OAuth Controller
 *
 * Handles OAuth/Cognito authentication flows.
 * Platform-agnostic - no HTTP concerns.
 */

import type {
  AuthContext,
  CognitoConfig,
  ControllerResult,
  Dependencies,
} from "./types.ts";
import { ok, err } from "./types.ts";

// ============================================================================
// Request/Response Types
// ============================================================================

export interface OAuthConfigResponse {
  cognitoUserPoolId: string;
  cognitoClientId: string;
  cognitoHostedUiUrl: string;
}

export interface TokenExchangeRequest {
  code: string;
  redirectUri: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RefreshRequest {
  refreshToken: string;
}

export interface MeResponse {
  userId: string;
  realm: string;
  role: string;
}

// ============================================================================
// OAuth Controller
// ============================================================================

export class OAuthController {
  constructor(
    private deps: Dependencies,
    private authService?: {
      login(req: LoginRequest): Promise<unknown>;
      refresh(req: RefreshRequest): Promise<unknown>;
    }
  ) { }

  /**
   * GET /oauth/config - Public Cognito config for frontend
   * No auth required
   */
  getConfig(): ControllerResult<OAuthConfigResponse> {
    const config = this.deps.cognitoConfig;
    return ok({
      cognitoUserPoolId: config?.userPoolId ?? "",
      cognitoClientId: config?.clientId ?? "",
      cognitoHostedUiUrl: config?.hostedUiUrl ?? "",
    });
  }

  /**
   * POST /oauth/token - Exchange authorization code for tokens
   * No auth required
   */
  async exchangeToken(
    request: TokenExchangeRequest
  ): Promise<ControllerResult<unknown>> {
    const config = this.deps.cognitoConfig;
    if (!config?.hostedUiUrl || !config?.clientId) {
      return err(
        503,
        "OAuth / Google sign-in not configured (missing Hosted UI URL or Client ID)"
      );
    }

    const tokenBody = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: config.clientId,
      code: request.code,
      redirect_uri: request.redirectUri,
    });

    try {
      const tokenRes = await fetch(`${config.hostedUiUrl}/oauth2/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: tokenBody.toString(),
      });

      const text = await tokenRes.text();
      if (!tokenRes.ok) {
        console.error("[OAuth] Token exchange failed:", tokenRes.status, text);
        return err(tokenRes.status, "Token exchange failed", text);
      }

      try {
        const data = JSON.parse(text);
        return ok(data);
      } catch {
        return err(502, "Invalid token response from Cognito");
      }
    } catch (error: any) {
      return err(500, error.message ?? "Token exchange failed");
    }
  }

  /**
   * POST /oauth/login - Login with email/password
   * No auth required
   */
  async login(request: LoginRequest): Promise<ControllerResult<unknown>> {
    if (!this.authService) {
      return err(503, "Login not configured");
    }

    try {
      const result = await this.authService.login(request);
      return ok(result);
    } catch (error: any) {
      return err(401, error.message ?? "Authentication failed");
    }
  }

  /**
   * POST /oauth/refresh - Refresh tokens
   * No auth required
   */
  async refresh(request: RefreshRequest): Promise<ControllerResult<unknown>> {
    if (!this.authService) {
      return err(503, "Refresh not configured");
    }

    try {
      const result = await this.authService.refresh(request);
      return ok(result);
    } catch (error: any) {
      return err(401, error.message ?? "Token refresh failed");
    }
  }

  /**
   * GET /oauth/me - Get current user info
   * Requires auth
   */
  getMe(auth: AuthContext): ControllerResult<MeResponse> {
    return ok({
      userId: auth.userId,
      realm: auth.realm,
      role: auth.role ?? "unauthorized",
    });
  }
}
