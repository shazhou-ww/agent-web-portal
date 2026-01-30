/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** API base URL (empty = same origin / proxy). Cognito config is loaded at runtime from GET /api/auth/config. */
  readonly VITE_API_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
