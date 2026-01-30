# @agent-web-portal/cas-stack

CAS (Content-Addressable Storage) service with global deduplication and scope-based access control.

## Features

- **Content-Addressable Storage**: Uses SHA-256 hash as keys for global deduplication
- **Scope-based Access Control**: Each user has isolated storage scope (`usr_xxx`)
- **Three-tier Authentication**: User Token → Agent Token → Ticket
- **DAG Support**: Upload and resolve Merkle DAG structures
- **AWS Native**: Built on Lambda, DynamoDB, S3, and Cognito

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        CAS Stack                                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │  /auth/*     │  │  /cas/{scope}│  │   Middleware         │  │
│  │  - login     │  │  - resolve   │  │   - Token parsing    │  │
│  │  - agent-token│ │  - node/:key │  │   - Scope validation │  │
│  │  - ticket    │  │  - dag       │  │                      │  │
│  └──────────────┘  └──────────────┘  └──────────────────────┘  │
│                            │                                    │
│         ┌──────────────────┼──────────────────┐                │
│         ▼                  ▼                  ▼                │
│  ┌─────────────┐   ┌─────────────┐   ┌─────────────┐          │
│  │  DynamoDB   │   │  DynamoDB   │   │     S3      │          │
│  │  (tokens)   │   │ (ownership) │   │   (blobs)   │          │
│  └─────────────┘   └─────────────┘   └─────────────┘          │
└─────────────────────────────────────────────────────────────────┘
```

## Authentication Chain

```
OAuth/Cognito ──► User Token ──► Agent Token ──► Ticket
     │                │               │             │
     │                │               │             └─► AWP Tool
     │                │               └─► Agent
     │                └─► User (Web UI)
     └─► Login
```

## API Endpoints

### Auth API

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/auth/login` | - | Login with email/password |
| POST | `/auth/refresh` | Refresh Token | Refresh user token |
| POST | `/auth/agent-token` | User | Issue agent token |
| GET | `/auth/agent-tokens` | User | List agent tokens |
| DELETE | `/auth/agent-token/:id` | User | Revoke agent token |
| POST | `/auth/ticket` | User/Agent | Issue ticket |
| DELETE | `/auth/ticket/:id` | User/Agent | Revoke ticket |

### CAS API

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/cas/{scope}/resolve` | All | Check which nodes exist |
| PUT | `/cas/{scope}/node/:key` | Write | Upload single node |
| GET | `/cas/{scope}/node/:key` | Read | Download single node |
| GET | `/cas/{scope}/dag/:key` | Read | Download DAG as tar |
| POST | `/cas/{scope}/dag` | Write | Upload DAG (multipart) |

**Scope**: `@me` (current user) or explicit `usr_xxx`

## Development

### Local Development

```bash
# Install dependencies
bun install

# Start local server (uses in-memory storage)
bun run dev

# Server runs at http://localhost:3500
```

### Local DynamoDB (Docker)

For persistent local storage, use DynamoDB Local in Docker:

```bash
# From repo root: start DynamoDB Local
docker compose up -d dynamodb

# Create CAS tables in local DynamoDB
cd packages/cas-stack && bun run create-local-tables

# In project root .env, add:
#   DYNAMODB_ENDPOINT=http://localhost:8000
#   TOKENS_TABLE=awp-cas-tokens
#   CAS_REALM_TABLE=awp-cas-cas-realm
#   CAS_DAG_TABLE=awp-cas-cas-dag

# Start CAS server (will use DynamoDB when DYNAMODB_ENDPOINT is set)
bun run dev
```

### Deploy to AWS

```bash
# Build and deploy
bun run deploy

# Or step by step:
bun run sam:build
bun run sam:deploy
```

### User roles and initial admin

CAS has three roles: **unauthorized** (no CAS access), **authorized** (normal CAS use), **admin** (can grant/revoke other users). New users are unauthorized until an admin grants access.

**Option A – script (recommended):** List Cognito users and set admin(s) by email or sub (writes to DynamoDB):

```bash
cd packages/cas-stack

# List all Cognito users (sub, email, name)
bun run set-admin-users --list

# Set one user as admin by email
bun run set-admin-users --set-admin admin@example.com

# Set by Cognito sub (from --list output)
bun run set-admin-users --set-admin a1b2c3d4-e5f6-7890-abcd-ef1234567890

# Set multiple users
bun run set-admin-users --set-admin admin@example.com "another-sub-uuid"
```

Requires `COGNITO_USER_POOL_ID`, `TOKENS_TABLE`, and AWS credentials (or `DYNAMODB_ENDPOINT` for local).

**Option B – env var:** Set `CAS_ADMIN_USER_IDS` (comma-separated Cognito `sub`). Used only when there is no role record in DB for that user (bootstrap). To get sub IDs: `bun run set-admin-users --list` or `aws cognito-idp list-users --user-pool-id <id> --query 'Users[*].Attributes[?Name==\`sub\`].Value' --output text`.

**Cognito config:** Backend uses env `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID`, `COGNITO_HOSTED_UI_URL`. Frontend gets Cognito config at runtime from `GET /api/auth/config` (no build-time env). `awp config pull` writes `COGNITO_*` to `.env` for the backend.

### Configuration

Set Cognito domain for OAuth (required for Hosted UI / Google sign-in):

```bash
sam deploy --parameter-overrides CognitoDomain=my-unique-domain
```

### Google Sign-In

To enable "Sign in with Google" in cas-webui:

1. **Deploy with Google parameters** (Client ID and Client Secret from Google Cloud Console):

   **Option A – use deploy script (reads secret from env):**

   In project root or `packages/cas-stack`, add to `.env`:
   ```bash
   GOOGLE_CLIENT_SECRET=你的Google客户端密钥
   # optional: COGNITO_DOMAIN=my-unique-domain   # default: awp-cas-ui
   ```
   Then:
   ```bash
   cd packages/cas-stack
   bun run deploy:google
   ```

   **Option B – pass on command line:**
   ```bash
   sam deploy --parameter-overrides \
     CognitoDomain=my-unique-domain \
     GoogleClientId=YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com \
     GoogleClientSecret=YOUR_GOOGLE_CLIENT_SECRET
   ```

2. **Google Cloud Console** – create/configure OAuth 2.0 credentials:

   - Go to [Google Cloud Console](https://console.cloud.google.com/) → **APIs & Services** → **Credentials**.
   - Create or edit an **OAuth 2.0 Client ID** (Application type: **Web application**).
   - **Authorized redirect URIs** – add **Cognito’s** callback URL (Google redirects to Cognito, not to your app):
     - `https://YOUR_COGNITO_DOMAIN_PREFIX.auth.YOUR_REGION.amazoncognito.com/oauth2/idpresponse`
     - Example: `https://my-unique-domain.auth.us-east-1.amazoncognito.com/oauth2/idpresponse`
   - (Optional) **Authorized JavaScript origins**: add your Cognito Hosted UI origin, e.g. `https://my-unique-domain.auth.us-east-1.amazoncognito.com`.
   - Copy **Client ID** and **Client Secret** into the `sam deploy` parameters above.

   After deploy, Cognito’s Hosted UI will show "Sign in with Google"; Google redirects to Cognito’s `/oauth2/idpresponse`, then Cognito redirects to your app’s `/auth/callback` with an authorization code.

   **Production callback URL (optional, avoids circular dependency):** On first deploy, leave `CallbackBaseUrl` empty. After deploy, copy `CloudFrontUrl` from stack outputs, then set in `.env`: `CALLBACK_BASE_URL=https://your-distribution.cloudfront.net` and run `bun run deploy:google` again so Cognito allows that URL for OAuth callback/logout.

3. **Pull config** so the frontend gets the Hosted UI URL:

   ```bash
   awp config pull
   ```

   Run `awp config pull` to write `COGNITO_*` into `.env` for the backend. The UI loads Cognito config at runtime from `GET /api/auth/config`.

## Usage Example

```typescript
// 1. Login and get user token
const loginRes = await fetch('/auth/login', {
  method: 'POST',
  body: JSON.stringify({ email: 'user@example.com', password: 'xxx' }),
});
const { userToken } = await loginRes.json();

// 2. Issue agent token
const agentRes = await fetch('/auth/agent-token', {
  method: 'POST',
  headers: { Authorization: `Bearer ${userToken}` },
  body: JSON.stringify({
    name: 'My Agent',
    permissions: { read: true, write: true, issueTicket: true },
  }),
});
const { token: agentToken } = await agentRes.json();

// 3. Resolve DAG (check what's missing)
const resolveRes = await fetch('/cas/@me/resolve', {
  method: 'POST',
  headers: { Authorization: `Bearer ${agentToken}` },
  body: JSON.stringify({
    root: 'sha256:abc123...',
    nodes: ['sha256:abc123...', 'sha256:def456...'],
  }),
});
const { missing } = await resolveRes.json();

// 4. Upload missing nodes
for (const key of missing) {
  await fetch(`/cas/@me/node/${key}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${agentToken}`,
      'Content-Type': 'application/octet-stream',
    },
    body: nodeContent,
  });
}

// 5. Issue ticket for AWP tool
const ticketRes = await fetch('/auth/ticket', {
  method: 'POST',
  headers: { Authorization: `Bearer ${agentToken}` },
  body: JSON.stringify({
    type: 'read',
    key: 'sha256:abc123...',
  }),
});
const { id: ticketId } = await ticketRes.json();

// 6. AWP tool reads with ticket
const content = await fetch(`/cas/@me/node/sha256:abc123...`, {
  headers: { Authorization: `Ticket ${ticketId}` },
});
```

## License

MIT
