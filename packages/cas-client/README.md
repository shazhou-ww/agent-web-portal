# CAS Client

A streaming-capable client for Content-Addressable Storage (CAS) with local caching support.

## Features

- **Three authentication modes**: User Token, Agent Token, Ticket
- **Streaming read/write**: Handle large files without loading into memory
- **Client-side chunking**: Automatic chunking based on server-configured threshold
- **Local caching**: Optional file system cache for frequently accessed data
- **Collection support**: Upload directory-like structures with hard link support

## Installation

```bash
npm install @agent-web-portal/cas-client
```

## Usage

### Basic Usage

```typescript
import { CasClient } from "@agent-web-portal/cas-client";

// Create client with user token
const cas = CasClient.fromUserToken("https://cas.example.com", "user_token");

// Or from a CasBlobContext (in Tool handlers)
const cas = CasClient.fromContext(context.cas);

// Read a file
const handle = await cas.openFile("sha256:abc123...");
console.log(handle.size, handle.contentType);

// Stream content
const stream = await handle.stream();
stream.pipe(fs.createWriteStream("output.png"));

// Or read to buffer (small files only)
const buffer = await handle.buffer();

// Upload a file
const key = await cas.putFile(buffer, "image/png");
```

### With Local Cache

```typescript
import { CasClient, FileSystemStorageProvider } from "@agent-web-portal/cas-client";

const storage = new FileSystemStorageProvider("/tmp/cas-cache");
const cas = CasClient.fromContext(context.cas, storage);

// Subsequent reads will use cache
const handle = await cas.openFile("sha256:abc123...");
```

### Upload Collection

```typescript
const key = await cas.putCollection(async (path) => {
  if (path === "/") {
    return { type: "collection", children: ["image.png", "data.json"] };
  }
  if (path === "/image.png") {
    return { type: "file", content: imageBuffer, contentType: "image/png" };
  }
  if (path === "/data.json") {
    return { type: "file", content: jsonBuffer, contentType: "application/json" };
  }
  return null;
});
```

### Hard Links

```typescript
const key = await cas.putCollection(async (path) => {
  if (path === "/") {
    return { type: "collection", children: ["original.png", "copy.png"] };
  }
  if (path === "/original.png") {
    return { type: "file", content: buffer, contentType: "image/png" };
  }
  if (path === "/copy.png") {
    // Link to existing key - no data duplication
    return { type: "link", target: "sha256:abc123..." };
  }
  return null;
});
```

## API

### CasClient

#### Static Factory Methods

- `CasClient.fromUserToken(endpoint, token)` - Create client with user token
- `CasClient.fromAgentToken(endpoint, token)` - Create client with agent token
- `CasClient.fromTicket(endpoint, ticketId)` - Create client with ticket
- `CasClient.fromContext(context, storage?)` - Create client from CasBlobContext

#### Read Methods

- `getNode(key)` - Get application layer node (CasNode)
- `getRawNode(key)` - Get storage layer node (CasRawNode)
- `openFile(key)` - Open file for streaming read
- `getChunkStream(key)` - Get chunk data as stream

#### Write Methods

- `putFile(content, contentType)` - Upload file (auto-chunks)
- `putCollection(resolver)` - Upload collection structure

### CasFileHandle

- `key` - CAS key
- `size` - Total size in bytes
- `contentType` - MIME type
- `stream()` - Get readable stream
- `buffer()` - Read to buffer
- `slice(start, end)` - Range read

### LocalStorageProvider

Interface for local caching. Use `FileSystemStorageProvider` for file-based cache.

## License

MIT
