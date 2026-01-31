/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** API base URL (empty = same origin / proxy). Cognito config is loaded at runtime from GET /api/oauth/config. */
  readonly VITE_API_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
