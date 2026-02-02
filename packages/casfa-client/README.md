# @aspect/casfa-client

CASFA client library for accessing CAS storage service.

## Overview

This package provides two main classes:

- **CasfaEndpoint**: Operations on a single CAS realm (read/write/commit)
- **CasfaClient**: Full CASFA service client (endpoint management, tickets, user info)

## Installation

```bash
bun add @aspect/casfa-client
```

## Usage

### Using a Ticket (for sharing/agents)

```typescript
import { CasfaClient } from "@aspect/casfa-client";

// Create endpoint from ticket (no full auth needed)
const endpoint = await CasfaClient.fromTicket(
  "https://api.example.com",
  "tkt_abc123"
);

// Read files
const tree = await endpoint.getTree("sha256:abc...");
const fileData = await endpoint.readFile("sha256:def...");

// Write files (if ticket has commit permission)
const result = await endpoint.putFile(data, "image/png");
await endpoint.commit(result.key);
```

### Using Full Client (for authenticated users)

```typescript
import { CasfaClient } from "@aspect/casfa-client";

const client = new CasfaClient({
  baseUrl: "https://api.example.com",
  auth: { type: "user", token: userToken },
});

// Get your CAS endpoint
const myEndpoint = await client.getMyEndpoint();

// Upload a file
const result = await myEndpoint.putFile(data, "image/png");

// Create a dict
const dictKey = await myEndpoint.makeDict([
  { name: "image.png", key: result.key },
]);

// Commit to storage
await myEndpoint.commit(dictKey);

// Create a sharing ticket
const ticket = await client.createTicket({
  scope: [collectionKey],
  expiresIn: 3600 * 24, // 24 hours
  label: "Share with Bob",
});

console.log(`Share URL: https://app.example.com/view?ticket=${ticket.id}`);
```

### With Local Caching

```typescript
import { CasfaClient, createMemoryStorage } from "@aspect/casfa-client";

// Use memory cache (or provide IndexedDB/FileSystem provider)
const cache = createMemoryStorage();

const endpoint = await CasfaClient.fromTicket(
  "https://api.example.com",
  ticketId,
  cache
);

// Subsequent reads will use cache
const data1 = await endpoint.getRaw("sha256:abc..."); // Network
const data2 = await endpoint.getRaw("sha256:abc..."); // Cache hit
```

## API

### CasfaEndpoint

| Method | Description |
|--------|-------------|
| `getInfo()` | Get endpoint configuration |
| `getTree(key)` | Get tree structure from root key |
| `getRaw(key)` | Get raw node bytes (with caching) |
| `getNode(key)` | Get decoded CAS node |
| `readFile(key)` | Read complete file content |
| `streamFile(key)` | Stream file content |
| `resolvePath(root, path)` | Resolve path within dict |
| `putFile(data, type)` | Upload a file |
| `makeDict(entries)` | Create a dict |
| `commit(key)` | Commit root to realm |
| `createBlobRef(node, path)` | Create blob reference |

### CasfaClient

| Method | Description |
|--------|-------------|
| `fromTicket(url, id, cache?)` | Create endpoint from ticket (static) |
| `getMyEndpoint()` | Get current user's endpoint |
| `getEndpoint(realm)` | Get endpoint for specific realm |
| `createTicket(options)` | Create a new ticket |
| `listTickets()` | List all tickets |
| `getTicket(id)` | Get ticket info |
| `revokeTicket(id)` | Revoke a ticket |
| `getProfile()` | Get user profile |
| `getUsage()` | Get storage usage |

## Platform Packages

For browser or Node.js specific features (storage providers, stream utilities):

- `@aspect/casfa-client-browser` - IndexedDB caching
- `@aspect/casfa-client-nodejs` - File system caching
