/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  readonly VITE_COGNITO_USER_POOL_ID: string;
  readonly VITE_COGNITO_CLIENT_ID: string;
  /** Cognito Hosted UI base URL (e.g. https://xxx.auth.region.amazoncognito.com) for Google / OAuth sign-in; optional when not using Google */
  readonly VITE_COGNITO_HOSTED_UI_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
