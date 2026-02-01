# @aspect/casfa-client-nodejs

Node.js-specific CASFA client with file system caching.

## Installation

```bash
bun add @aspect/casfa-client-nodejs
```

## Usage

```typescript
import { 
  createCasfaClient, 
  createEndpointFromTicket,
  FileSystemStorageProvider 
} from "@aspect/casfa-client-nodejs";

// Create client with automatic file system caching
const client = createCasfaClient(
  "https://api.example.com",
  { type: "user", token: userToken }
);

// Or create endpoint from ticket
const endpoint = await createEndpointFromTicket(
  "https://api.example.com",
  "tkt_abc123"
);

// Read files (automatically cached to ~/.casfa-cache)
const data = await endpoint.readFile("sha256:abc...");
```

## Custom Cache Directory

```typescript
const client = createCasfaClient(
  "https://api.example.com",
  { type: "user", token },
  { cacheDir: "/path/to/cache" }
);
```

## Direct Storage Provider Usage

```typescript
import { 
  FileSystemStorageProvider,
  CasfaClient 
} from "@aspect/casfa-client-nodejs";

const cache = new FileSystemStorageProvider("/tmp/my-cache");

// Use with CasfaClient.fromTicket
const endpoint = await CasfaClient.fromTicket(
  "https://api.example.com",
  ticketId,
  cache
);

// Get cache stats
const totalSize = await cache.getTotalSize();
console.log(`Cache size: ${totalSize} bytes`);

// Clear cache when needed
await cache.clear();
```

## Cache Directory Structure

```
~/.casfa-cache/
  sha256/
    ab/
      cdef123....bin
    12/
      3456789....bin
```
