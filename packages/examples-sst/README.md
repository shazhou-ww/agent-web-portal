# @agent-web-portal/examples-sst

SST-based example Lambda portals for Agent Web Portal.

This package demonstrates how to deploy AWP portals using [SST v3 (Ion)](https://sst.dev/) instead of AWS SAM.

## Features

- **Pure SST Deployment**: No SAM templates required
- **Live Development**: Hot reload with `sst dev`
- **Infrastructure as Code**: All AWS resources defined in TypeScript
- **Modern Stack**: SST v3 with Pulumi under the hood

## Available Portals

| Portal | Endpoint | Description |
|--------|----------|-------------|
| Basic | `/basic` | Simple greeting service |
| E-commerce | `/ecommerce` | Shopping cart, product search, checkout |
| JSONata | `/jsonata` | JSONata expression evaluation |
| Auth | `/auth` | Authentication-enabled portal |
| Blob | `/blob` | Image upload/download with blob handling |

## Quick Start

### Prerequisites

- [Bun](https://bun.sh/) runtime
- [AWS CLI](https://aws.amazon.com/cli/) configured with credentials
- SST CLI (installed via npx)

### Local Development

```bash
# Install dependencies
bun install

# Start local development server (no AWS required)
bun run start

# Or with hot reload
bun run dev:local
```

The server will be available at `http://localhost:3000`.

### Deploy to AWS

```bash
# Development with live reload (requires AWS)
npx sst dev

# Deploy to AWS (development stage)
npx sst deploy

# Deploy to production
npx sst deploy --stage production

# Remove all resources
npx sst remove
```

## Project Structure

```
examples-sst/
├── sst.config.ts          # SST configuration (infrastructure as code)
├── package.json           # Package configuration
├── tsconfig.json          # TypeScript configuration
├── server.ts              # Local development server (Bun)
├── src/
│   ├── handler.ts         # Lambda handler (routes all portals)
│   ├── static.ts          # Static asset serving
│   ├── auth/              # Auth UI templates and session management
│   │   ├── index.ts
│   │   ├── session.ts
│   │   └── ui.ts
│   └── portals/           # Portal definitions
│       ├── index.ts
│       ├── basic.ts       # Basic greeting portal
│       ├── ecommerce.ts   # E-commerce portal
│       ├── jsonata.ts     # JSONata portal
│       ├── auth.ts        # Auth-enabled portal
│       ├── blob.ts        # Blob portal (in-memory storage)
│       └── blob-s3.ts     # S3-based blob storage for Lambda
├── skills/                # Skill definitions (SKILL.md files)
│   ├── automata-transition/
│   └── statistics/
└── ui/                    # React UI
    ├── package.json
    ├── vite.config.ts
    └── src/
```

## SST Configuration

The `sst.config.ts` file defines all AWS infrastructure:

```typescript
export default $config({
  app(input) {
    return {
      name: "awp-examples-sst",
      removal: input?.stage === "production" ? "retain" : "remove",
      home: "aws",
    };
  },
  async run() {
    // DynamoDB table for auth
    const authTable = new sst.aws.Dynamo("AuthTable", { ... });

    // S3 bucket for blob storage
    const blobBucket = new sst.aws.Bucket("BlobBucket", { ... });

    // API Gateway + Lambda
    const api = new sst.aws.ApiGatewayV2("Api", { ... });
    api.route("$default", { handler: "src/handler.handler", ... });

    // Static site for UI
    const site = new sst.aws.StaticSite("UI", { ... });

    return { api: api.url, ui: site.url };
  },
});
```

## Test Users

For development and testing:

| Username | Password | User ID |
|----------|----------|---------|
| test | test123 | test-user-001 |
| admin | admin123 | admin-user-001 |
| demo | demo | demo-user-001 |

## API Endpoints

### Health Check

```bash
curl http://localhost:3000/health
```

### Portal Endpoints

```bash
# Initialize a portal
curl -X POST http://localhost:3000/basic \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize"}'

# List tools
curl -X POST http://localhost:3000/basic \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# Call a tool
curl -X POST http://localhost:3000/basic \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"greet","arguments":{"name":"World"}}}'
```

### Auth Endpoints

```bash
# Initialize auth
curl -X POST http://localhost:3000/auth/init \
  -H "Content-Type: application/json" \
  -d '{"pubkey":"...","client_name":"My Client"}'

# Check auth status
curl http://localhost:3000/auth/status?pubkey=...
```

## Comparison with SAM Version

| Feature | SAM (`examples`) | SST (`examples-sst`) |
|---------|------------------|----------------------|
| Config Format | YAML (template.yaml) | TypeScript (sst.config.ts) |
| Local Dev | `sam local start-api` | `bun run start` or `npx sst dev` |
| Deploy | `sam deploy --guided` | `npx sst deploy` |
| Live Reload | ❌ | ✅ (with `sst dev`) |
| Type Safety | ❌ | ✅ |
| Console | CloudWatch | SST Console |

## Environment Variables

When deployed, the Lambda function receives these environment variables:

| Variable | Description |
|----------|-------------|
| `AUTH_TABLE` | DynamoDB table name for auth storage |
| `BLOB_BUCKET` | S3 bucket name for blob storage |
| `SKILLS_BUCKET` | S3 bucket name for skills (optional) |
| `AWS_REGION` | AWS region |

## License

MIT
