import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
  CognitoUserSession,
} from "amazon-cognito-identity-js";

// Cognito configuration - loaded from environment variables
const COGNITO_USER_POOL_ID = import.meta.env.VITE_COGNITO_USER_POOL_ID || "";
const COGNITO_CLIENT_ID = import.meta.env.VITE_COGNITO_CLIENT_ID || "";
const COGNITO_HOSTED_UI_URL = import.meta.env.VITE_COGNITO_HOSTED_UI_URL || "";

/** SessionStorage key for OAuth (Hosted UI / Google) tokens */
export const COGNITO_OAUTH_TOKENS_KEY = "cognito_oauth_tokens";

// Initialize Cognito User Pool
const userPool = new CognitoUserPool({
  UserPoolId: COGNITO_USER_POOL_ID,
  ClientId: COGNITO_CLIENT_ID,
});

export interface User {
  userId: string;
  email: string;
  name?: string;
}

interface AuthTokens {
  accessToken: string;
  idToken: string;
  refreshToken: string;
}

interface AuthContextType {
  user: User | null;
  tokens: AuthTokens | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  /** Redirect to Cognito Hosted UI for Google sign-in (only when VITE_COGNITO_HOSTED_UI_URL is set) */
  loginWithGoogle: () => void;
  logout: () => Promise<void>;
  refreshSession: () => Promise<void>;
  getAccessToken: () => Promise<string | null>;
  /** Whether Google sign-in is available */
  googleSignInEnabled: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

function parseJwt(token: string): Record<string, unknown> {
  try {
    const base64Url = token.split(".")[1];
    const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split("")
        .map((c) => `%${`00${c.charCodeAt(0).toString(16)}`.slice(-2)}`)
        .join("")
    );
    return JSON.parse(jsonPayload);
  } catch {
    return {};
  }
}

function extractUserFromSession(session: CognitoUserSession): User {
  const idToken = session.getIdToken().getJwtToken();
  return extractUserFromIdToken(idToken);
}

function extractUserFromIdToken(idToken: string): User {
  const payload = parseJwt(idToken);
  return {
    userId: (payload.sub as string) || "",
    email: (payload.email as string) || "",
    name: (payload.name as string) || (payload.email as string) || "",
  };
}

function getStoredOAuthTokens(): AuthTokens | null {
  try {
    const raw = sessionStorage.getItem(COGNITO_OAUTH_TOKENS_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as { idToken: string; accessToken: string; refreshToken: string };
    if (!data.idToken || !data.accessToken) return null;
    const payload = parseJwt(data.idToken);
    const exp = (payload.exp as number) | 0;
    if (exp > 0 && exp * 1000 < Date.now()) return null; // expired
    return { idToken: data.idToken, accessToken: data.accessToken, refreshToken: data.refreshToken };
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [tokens, setTokens] = useState<AuthTokens | null>(null);
  const [loading, setLoading] = useState(true);

  // Refresh session: prefer stored OAuth tokens, then Cognito user session
  const refreshSession = useCallback(async (): Promise<void> => {
    const oauthTokens = getStoredOAuthTokens();
    if (oauthTokens) {
      setTokens(oauthTokens);
      setUser(extractUserFromIdToken(oauthTokens.idToken));
      return;
    }

    return new Promise((resolve) => {
      const cognitoUser = userPool.getCurrentUser();
      if (!cognitoUser) {
        setUser(null);
        setTokens(null);
        resolve();
        return;
      }

      cognitoUser.getSession(
        (err: Error | null, session: CognitoUserSession | null) => {
          if (err || !session || !session.isValid()) {
            setUser(null);
            setTokens(null);
            resolve();
            return;
          }

          const newTokens: AuthTokens = {
            accessToken: session.getAccessToken().getJwtToken(),
            idToken: session.getIdToken().getJwtToken(),
            refreshToken: session.getRefreshToken().getToken(),
          };

          setTokens(newTokens);
          setUser(extractUserFromSession(session));
          resolve();
        }
      );
    });
  }, []);

  // Check for existing session on mount
  useEffect(() => {
    const checkSession = async () => {
      await refreshSession();
      setLoading(false);
    };
    checkSession();
  }, [refreshSession]);

  // Login with email and password
  const login = async (
    email: string,
    password: string
  ): Promise<{ success: boolean; error?: string }> => {

    return new Promise((resolve) => {
      const cognitoUser = new CognitoUser({
        Username: email,
        Pool: userPool,
      });

      const authDetails = new AuthenticationDetails({
        Username: email,
        Password: password,
      });

      cognitoUser.authenticateUser(authDetails, {
        onSuccess: (session: CognitoUserSession) => {
          const newTokens: AuthTokens = {
            accessToken: session.getAccessToken().getJwtToken(),
            idToken: session.getIdToken().getJwtToken(),
            refreshToken: session.getRefreshToken().getToken(),
          };

          setTokens(newTokens);
          setUser(extractUserFromSession(session));
          resolve({ success: true });
        },
        onFailure: (err) => {
          console.error("Login failed:", err);
          resolve({
            success: false,
            error: err.message || "Authentication failed",
          });
        },
        newPasswordRequired: () => {
          // Handle new password required scenario
          resolve({
            success: false,
            error: "New password required. Please contact administrator.",
          });
        },
      });
    });
  };

  const loginWithGoogle = useCallback((): void => {
    if (!COGNITO_CLIENT_ID) return;
    if (!COGNITO_HOSTED_UI_URL) {
      console.warn(
        "[Auth] Google sign-in: VITE_COGNITO_HOSTED_UI_URL is not set. " +
          "Set it in .env (e.g. run: awp config pull after deploying with CognitoDomain)."
      );
      alert(
        "Google 登录未配置：请在 .env 中设置 VITE_COGNITO_HOSTED_UI_URL。\n" +
          "部署时指定 CognitoDomain 后运行 awp config pull 可自动写入。"
      );
      return;
    }
    const returnUrl = encodeURIComponent(
      window.location.pathname === "/login"
        ? (new URLSearchParams(window.location.search).get("returnUrl") || "/")
        : window.location.pathname + window.location.search
    );
    const redirectUri = window.location.origin + "/auth/callback";
    const scope = "openid email profile";
    const params = new URLSearchParams({
      client_id: COGNITO_CLIENT_ID,
      response_type: "code",
      scope,
      redirect_uri: redirectUri,
      state: returnUrl,
      identity_provider: "Google",
    });
    window.location.href = `${COGNITO_HOSTED_UI_URL}/oauth2/authorize?${params.toString()}`;
  }, []);

  // Logout
  const logout = async (): Promise<void> => {
    sessionStorage.removeItem(COGNITO_OAUTH_TOKENS_KEY);
    const cognitoUser = userPool.getCurrentUser();
    if (cognitoUser) {
      cognitoUser.signOut();
    }
    setUser(null);
    setTokens(null);
  };

  // Get current access token (from OAuth storage or Cognito session)
  const getAccessToken = useCallback(async (): Promise<string | null> => {
    const oauthTokens = getStoredOAuthTokens();
    if (oauthTokens) return oauthTokens.accessToken;

    const cognitoUser = userPool.getCurrentUser();
    if (!cognitoUser) return null;

    return new Promise((resolve) => {
      cognitoUser.getSession(
        (err: Error | null, session: CognitoUserSession | null) => {
          if (err || !session || !session.isValid()) {
            resolve(null);
            return;
          }
          resolve(session.getAccessToken().getJwtToken());
        }
      );
    });
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        tokens,
        loading,
        login,
        loginWithGoogle,
        logout,
        refreshSession,
        getAccessToken,
        googleSignInEnabled: Boolean(COGNITO_CLIENT_ID),
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
