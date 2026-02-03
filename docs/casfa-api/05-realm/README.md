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
- [Commit 操作](./02-commits.md) - 创建、列出、更新、删除 Commit
- [Node 操作](./03-nodes.md) - 节点的预检查、上传、下载、元信息获取
- [Depot 管理](./04-depots.md) - 命名存储空间的版本控制

## 端点列表

### 基本信息

| 方法 | 路径 | 描述 | 权限 |
|------|------|------|------|
| GET | `/api/realm/{realmId}` | 获取 Realm 端点信息 | Read |
| GET | `/api/realm/{realmId}/usage` | 获取使用统计 | Read |

### Commit 操作

| 方法 | 路径 | 描述 | 权限 |
|------|------|------|------|
| POST | `/api/realm/{realmId}/commit` | 创建 Commit | Write |
| GET | `/api/realm/{realmId}/commits` | 列出 Commits | Read |
| GET | `/api/realm/{realmId}/commits/:root` | 获取 Commit 详情 | Read |
| PATCH | `/api/realm/{realmId}/commits/:root` | 更新 Commit 元数据 | Write |
| DELETE | `/api/realm/{realmId}/commits/:root` | 删除 Commit | Write |

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

> **注意**: Ticket 不支持 Depot 操作。
