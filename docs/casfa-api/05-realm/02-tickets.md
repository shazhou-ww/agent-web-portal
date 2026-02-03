# Ticket 管理

Ticket 是 Realm 的附属资源，提供有限的、有时间边界的 CAS 访问权限。Realm 所有者可以列出和管理其下的所有 Tickets。

> 关于 Ticket 的完整 API 文档，请参阅 [Ticket API](../06-ticket.md)。

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
      "input": "blake3s:abc123...",
      "output": null,
      "issuerId": "agent_yyy",
      "createdAt": "2025-02-02T12:00:00.000Z",
      "expiresAt": "2025-02-03T12:00:00.000Z"
    },
    {
      "ticketId": "ticket_zzz",
      "status": "committed",
      "input": "blake3s:def456...",
      "output": "blake3s:ghi789...",
      "issuerId": "agent_yyy",
      "createdAt": "2025-02-01T10:00:00.000Z",
      "expiresAt": "2025-02-02T10:00:00.000Z",
      "committedAt": "2025-02-01T11:30:00.000Z"
    }
  ],
  "nextKey": "下一页游标"
}
```

---

## GET /api/realm/{realmId}/tickets/:ticketId

获取指定 Ticket 的详细信息。

### 响应

```json
{
  "ticketId": "ticket_xxx",
  "status": "active",
  "input": "blake3s:abc123...",
  "output": null,
  "writable": true,
  "scope": ["blake3s:abc123..."],
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
