# Ticket 管理

Ticket 是 Realm 的附属资源，提供有限的、有时间边界的 CAS 访问权限。Realm 所有者可以列出和管理其下的所有 Tickets。

> 关于 Ticket 的完整 API 文档，请参阅 [Ticket API](../06-ticket.md)。

## Issuer ID 格式

每个 Ticket 记录其创建者（issuer），格式根据创建方式不同：

| 创建方式 | 格式 | 说明 |
|---------|------|------|
| P256 Client | `client:{hash}` | 公钥的 Blake3s 哈希 |
| User Token | `user:{id}` | Cognito UUID 的 Base32 编码 |
| Agent Token | `token:{hash}` | Token 值的 Blake3s 哈希 |

---

## POST /api/realm/{realmId}/tickets

创建新的 Ticket。

> **权限要求**: 需要 Agent Token 或 User Token。

### 请求

```json
{
  "input": ["node:abc123..."],
  "purpose": "Generate thumbnail for uploaded image",
  "writable": {
    "quota": 10485760,
    "accept": ["image/*"]
  },
  "expiresIn": 86400
}
```

| 字段 | 类型 | 描述 |
|------|------|------|
| `input` | `string[]?` | 输入节点 key 数组，定义可读取的范围。省略表示完全读取权限 |
| `purpose` | `string?` | 人类可读的任务描述 |
| `writable` | `object?` | 写入权限配置。省略表示只读 |
| `writable.quota` | `number?` | 上传字节数限制 |
| `writable.accept` | `string[]?` | 允许的 MIME 类型 |
| `expiresIn` | `number?` | 过期时间（秒），默认 24 小时 |

### 响应

```json
{
  "ticketId": "ticket:01HQXK5V8N3Y7M2P4R6T9W0ABC",
  "endpoint": "https://api.example.com/api/ticket/ticket:01HQXK5V8N3Y7M2P4R6T9W0ABC",
  "input": ["node:abc123..."],
  "writable": true,
  "config": {
    "nodeLimit": 4194304,
    "maxNameBytes": 255,
    "quota": 10485760,
    "accept": ["image/*"]
  },
  "expiresAt": 1738584000000
}
```

### 错误

| 状态码 | 描述 |
|--------|------|
| 400 | 请求参数无效 |
| 403 | 无权创建 Ticket |

---

## GET /api/realm/{realmId}/tickets

列出 Realm 下的所有 Tickets。

### 查询参数

| 参数 | 类型 | 描述 |
|------|------|------|
| `limit` | `number?` | 返回数量限制，默认 100，最大 1000 |
| `cursor` | `string?` | 分页游标 |
| `status` | `string?` | 按状态过滤：`active`, `committed`, `revoked` |

### 响应

```json
{
  "tickets": [
    {
      "ticketId": "ticket:01HQXK5V8N3Y7M2P4R6T9W0ABC",
      "status": "active",
      "purpose": "Generate thumbnail for uploaded image",
      "input": ["node:abc123..."],
      "output": null,
      "issuerId": "client:01HQXK5V8N3Y7M2P4R6T9W0DEF",
      "createdAt": 1738497600000,
      "expiresAt": 1738584000000
    },
    {
      "ticketId": "ticket:01HQXK5V8N3Y7M2P4R6T9W0XYZ",
      "status": "committed",
      "purpose": "Convert document to PDF",
      "input": ["node:def456...", "node:template789..."],
      "output": "node:ghi789...",
      "issuerId": "user:01HQXK5V8N3Y7M2P4R6T9W0DEF",
      "createdAt": 1738404000000,
      "expiresAt": 1738490400000,
      "committedAt": 1738409400000
    }
  ],
  "nextCursor": "下一页游标"
}
```

---

## GET /api/realm/{realmId}/tickets/:ticketId

获取指定 Ticket 的详细信息。

### 响应

```json
{
  "ticketId": "ticket:01HQXK5V8N3Y7M2P4R6T9W0ABC",
  "status": "active",
  "purpose": "Generate thumbnail for uploaded image",
  "input": ["node:abc123..."],
  "output": null,
  "writable": true,
  "issuerId": "client:01HQXK5V8N3Y7M2P4R6T9W0DEF",
  "config": {
    "nodeLimit": 4194304,
    "maxNameBytes": 255,
    "quota": 10485760,
    "accept": ["image/*"]
  },
  "createdAt": 1738497600000,
  "expiresAt": 1738584000000
}
```

---

## POST /api/realm/{realmId}/tickets/:ticketId/revoke

撤销指定的 Ticket。状态从 `active` 或 `committed` 变为 `revoked`。

> **权限要求**: 需要 Agent Token，且必须是 Ticket 的 issuer。

### 响应

```json
{
  "success": true,
  "status": "revoked"
}
```

### 错误

| 状态码 | 描述 |
|--------|------|
| 403 | 不是 Ticket 的 issuer |
| 404 | Ticket 不存在 |
| 410 | Ticket 已撤销 |

---

## DELETE /api/realm/{realmId}/tickets/:ticketId

删除指定的 Ticket。

> **权限要求**: 只有 User Token 可以删除 Ticket。Agent Token 只能 revoke（通过 Ticket 路由）。

### 响应

```json
{
  "success": true
}
```

### 错误

| 状态码 | 描述 |
|--------|------|
| 403 | Agent Token 无权删除，只能 revoke |
| 404 | Ticket 不存在 |
