# MCP 协议 API

CASFA 提供 MCP (Model Context Protocol) 兼容的 JSON-RPC 端点，让传统 MCP 客户端可以与 CAS 交互。

## 端点

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| POST | `/api/mcp` | MCP JSON-RPC 端点 | Agent/User Token |

## 认证

需要 Agent Token 或 User Token：

```http
Authorization: Agent {agentToken}
```

或

```http
Authorization: Bearer {userToken}
```

---

## MCP 协议

CASFA MCP 实现遵循 MCP 2024-11-05 协议版本。

### 请求格式

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "方法名",
  "params": { ... }
}
```

### 响应格式

成功：

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": { ... }
}
```

错误：

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": -32600,
    "message": "错误描述",
    "data": { ... }
  }
}
```

---

## MCP 方法

### initialize

初始化 MCP 会话。

#### 请求

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize"
}
```

#### 响应

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": "2024-11-05",
    "capabilities": {
      "tools": {}
    },
    "serverInfo": {
      "name": "cas-mcp",
      "version": "0.1.0"
    }
  }
}
```

---

### tools/list

列出可用的 MCP 工具。

#### 请求

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/list"
}
```

#### 响应

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "tools": [
      {
        "name": "cas_get_ticket",
        "description": "Get a CAS access ticket...",
        "inputSchema": { ... }
      },
      {
        "name": "cas_read",
        "description": "Read a blob from CAS...",
        "inputSchema": { ... }
      },
      {
        "name": "cas_write",
        "description": "Write a blob to CAS...",
        "inputSchema": { ... }
      }
    ]
  }
}
```

---

### tools/call

调用 MCP 工具。

#### 请求

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "工具名",
    "arguments": { ... }
  }
}
```

---

## MCP 工具

### cas_get_ticket

获取 CAS 访问 Ticket。

#### 参数

| 参数 | 类型 | 描述 |
|------|------|------|
| `scope` | `string \| string[]` | 要访问的 DAG root key(s) |
| `writable` | `boolean?` | 是否需要写入权限，默认 false |
| `expiresIn` | `number?` | 有效期（秒） |

#### 示例请求

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "cas_get_ticket",
    "arguments": {
      "scope": "sha256:abc123...",
      "writable": true,
      "expiresIn": 3600
    }
  }
}
```

#### 示例响应

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "{\"endpoint\":\"https://api.example.com/api/ticket/xxx\",\"scope\":[\"sha256:abc123...\"],\"expiresAt\":\"2025-02-02T13:00:00.000Z\"}"
      }
    ]
  }
}
```

---

### cas_read

从 CAS 读取 Blob。

#### 参数

| 参数 | 类型 | 描述 |
|------|------|------|
| `endpoint` | `string` | Ticket 端点 URL |
| `key` | `string` | CAS 节点 key |
| `path` | `string?` | 路径，默认 "."（节点本身） |

#### 示例请求

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "cas_read",
    "arguments": {
      "endpoint": "https://api.example.com/api/ticket/xxx",
      "key": "sha256:abc123...",
      "path": "."
    }
  }
}
```

#### 示例响应

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "{\"key\":\"sha256:abc123...\",\"contentType\":\"image/png\",\"size\":12345,\"content\":\"base64编码的内容...\"}"
      }
    ]
  }
}
```

---

### cas_write

向 CAS 写入 Blob。

#### 参数

| 参数 | 类型 | 描述 |
|------|------|------|
| `endpoint` | `string` | 可写的 Ticket 端点 URL |
| `content` | `string` | Base64 编码的内容 |
| `contentType` | `string` | MIME 类型 |

#### 示例请求

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "cas_write",
    "arguments": {
      "endpoint": "https://api.example.com/api/ticket/xxx",
      "content": "SGVsbG8gV29ybGQh",
      "contentType": "text/plain"
    }
  }
}
```

#### 示例响应

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "{\"key\":\"sha256:def456...\",\"contentType\":\"text/plain\",\"size\":12}"
      }
    ]
  }
}
```

---

## 错误码

| 错误码 | 描述 |
|--------|------|
| -32700 | 解析错误 |
| -32600 | 无效请求 |
| -32601 | 方法不存在 |
| -32602 | 无效参数 |
| -32603 | 内部错误 |
