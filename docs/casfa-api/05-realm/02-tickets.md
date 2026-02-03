# Ticket 管理

Ticket 是 Realm 的附属资源，提供有限的、有时间边界的 CAS 访问权限。Realm 所有者可以列出和管理其下的所有 Tickets。

> 关于 Ticket 的完整 API 文档，请参阅 [Ticket API](../06-ticket.md)。

---

## POST /api/realm/{realmId}/tickets

创建新的 Ticket。

> **权限要求**: 需要 Agent Token 或 User Token。

### 请求

```json
{
  "input": ["blake3s:abc123..."],
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
  "ticketId": "ticket_xxx",
  "endpoint": "https://api.example.com/api/ticket/ticket_xxx",
  "input": ["blake3s:abc123..."],
  "writable": true,
  "config": {
    "nodeLimit": 4194304,
    "maxNameBytes": 255,
    "quota": 10485760,
    "accept": ["image/*"]
  },
  "expiresAt": "2025-02-03T12:00:00.000Z"
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
| `startKey` | `string?` | 分页游标 |
| `status` | `string?` | 按状态过滤：`active`, `committed`, `revoked` |

### 响应

```json
{
  "tickets": [
    {
      "ticketId": "ticket_xxx",
      "status": "active",
      "purpose": "Generate thumbnail for uploaded image",
      "input": ["blake3s:abc123..."],
      "output": null,
      "issuerId": "agent_yyy",
      "createdAt": "2025-02-02T12:00:00.000Z",
      "expiresAt": "2025-02-03T12:00:00.000Z"
    },
    {
      "ticketId": "ticket_zzz",
      "status": "committed",
      "purpose": "Convert document to PDF",
      "input": ["blake3s:def456...", "blake3s:template789..."],
      "output": "blake3s:ghi789...",
      "issuerId": "agent_yyy",
      "createdAt": "2025-02-01T10:00:00.000Z",
      "expiresAt": "2025-02-02T10:00:00.000Z",
      "committedAt": "2025-02-01T11:30:00.000Z"
    }
  ],
  "nextKey": "下一页游标"
```

---

## GET /api/realm/{realmId}/tickets/:ticketId

获取指定 Ticket 的详细信息。

### 响应

```json
{
  "ticketId": "ticket_xxx",
  "status": "active",
  "purpose": "Generate thumbnail for uploaded image",
  "input": ["blake3s:abc123..."],
  "output": null,
  "writable": true,
  "issuerId": "agent_yyy",
  "issuerFingerprint": "fp_xxx",
  "config": {
    "nodeLimit": 4194304,
    "maxNameBytes": 255,
    "quota": 10485760,
    "accept": ["image/*"]
  },
  "createdAt": "2025-02-02T12:00:00.000Z",
  "expiresAt": "2025-02-03T12:00:00.000Z"
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
