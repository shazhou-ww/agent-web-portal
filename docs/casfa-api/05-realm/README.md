# Realm CAS 操作 API

通过 Realm 路由访问 CAS 存储的 API。需要 User Token 或 Agent Token 认证。

## 认证

所有 Realm 路由需要 `Authorization` header：

```http
Authorization: Bearer {userToken}
```

或

```http
Authorization: Agent {agentToken}
```

> `realmId` 格式为 `usr_{userId}`

## 子文档

- [端点信息与使用统计](./01-endpoint.md) - Realm 基本信息和 usage 统计
- [Ticket 管理](./02-tickets.md) - Realm 下的 Ticket 列表与管理
- [Node 操作](./03-nodes.md) - 节点的预检查、上传、下载、元信息获取
- [Depot 管理](./04-depots.md) - 命名存储空间的版本控制

## 端点列表

### 基本信息

| 方法 | 路径 | 描述 | 权限 |
|------|------|------|------|
| GET | `/api/realm/{realmId}` | 获取 Realm 端点信息 | Read |
| GET | `/api/realm/{realmId}/usage` | 获取使用统计 | Read |

### Ticket 管理

| 方法 | 路径 | 描述 | 权限 |
|------|------|------|------|
| GET | `/api/realm/{realmId}/tickets` | 列出 Realm 下所有 Tickets | Read |
| GET | `/api/realm/{realmId}/tickets/:ticketId` | 获取 Ticket 详情 | Read |
| POST | `/api/realm/{realmId}/tickets/:ticketId/revoke` | 撤销 Ticket（仅 Issuer） | Write |
| DELETE | `/api/realm/{realmId}/tickets/:ticketId` | 删除 Ticket（仅 User） | Write |

### Node 操作

| 方法 | 路径 | 描述 | 权限 |
|------|------|------|------|
| POST | `/api/realm/{realmId}/prepare-nodes` | 预上传检查 | Write |
| GET | `/api/realm/{realmId}/nodes/:key/metadata` | 获取节点元信息 | Read |
| GET | `/api/realm/{realmId}/nodes/:key` | 获取节点二进制数据 | Read |
| PUT | `/api/realm/{realmId}/nodes/:key` | 上传节点 | Write |

### Depot 操作

| 方法 | 路径 | 描述 | 权限 |
|------|------|------|------|
| GET | `/api/realm/{realmId}/depots` | 列出所有 Depots | Read |
| POST | `/api/realm/{realmId}/depots` | 创建 Depot | Write |
| GET | `/api/realm/{realmId}/depots/:depotId` | 获取 Depot 详情 | Read |
| PUT | `/api/realm/{realmId}/depots/:depotId` | 更新 Depot root | Write |
| DELETE | `/api/realm/{realmId}/depots/:depotId` | 删除 Depot | Write |
| GET | `/api/realm/{realmId}/depots/:depotId/history` | 列出 Depot 历史 | Read |
| POST | `/api/realm/{realmId}/depots/:depotId/rollback` | 回滚到指定版本 | Write |

> **注意**: Ticket 路由不支持 Depot 操作，Depot 只能通过 Realm 路由管理。
