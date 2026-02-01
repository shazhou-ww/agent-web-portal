# @aspect/casfa-client-browser

Browser-specific CASFA client with IndexedDB-based caching.

## Installation

```bash
bun add @aspect/casfa-client-browser
```

## Usage

```typescript
import { 
  createCasfaClient, 
  createEndpointFromTicket,
  IndexedDBStorageProvider 
} from "@aspect/casfa-client-browser";

// Create client with automatic IndexedDB caching
const client = createCasfaClient(
  "https://api.example.com",
  { type: "user", token: userToken }
);

// Or create endpoint from ticket
const endpoint = await createEndpointFromTicket(
  "https://api.example.com",
  "tkt_abc123"
);

// Read files (automatically cached)
const data = await endpoint.readFile("sha256:abc...");
```

## Custom Cache Database

```typescript
const client = createCasfaClient(
  "https://api.example.com",
  { type: "user", token },
  { dbName: "my-app-cache" }
);
```

## Direct Storage Provider Usage

```typescript
import { 
  IndexedDBStorageProvider,
  CasfaClient 
} from "@aspect/casfa-client-browser";

const cache = new IndexedDBStorageProvider("my-cache");

// Use with CasfaClient.fromTicket
const endpoint = await CasfaClient.fromTicket(
  "https://api.example.com",
  ticketId,
  cache
);

// Clear cache when needed
await cache.clear();
```
