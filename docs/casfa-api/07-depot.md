# Depot 管理 API

Depot 是 CAS 中的命名存储空间，支持版本控制和回滚。

## 访问方式

Depot API 可以通过两种路由访问：

1. **Realm 路由**: `/api/realm/{realmId}/depots/...`
2. **Ticket 路由**: `/api/ticket/{ticketId}/depots/...`

## 端点列表

| 方法 | 路径 | 描述 | 权限 |
|------|------|------|------|
| GET | `{base}/depots` | 列出所有 Depots | Read |
| POST | `{base}/depots` | 创建 Depot | Write |
| GET | `{base}/depots/:depotId` | 获取 Depot 详情 | Read |
| PUT | `{base}/depots/:depotId` | 更新 Depot root | Write |
| DELETE | `{base}/depots/:depotId` | 删除 Depot | Write |
| GET | `{base}/depots/:depotId/history` | 列出 Depot 历史 | Read |
| POST | `{base}/depots/:depotId/rollback` | 回滚到指定版本 | Write |

> `{base}` = `/api/realm/{realmId}` 或 `/api/ticket/{ticketId}`

---

## GET {base}/depots

列出 Realm 中的所有 Depots。

### 查询参数

| 参数 | 类型 | 描述 |
|------|------|------|
| `limit` | `number?` | 返回数量限制，默认 100 |
| `cursor` | `string?` | 分页游标 |

### 响应

```json
{
  "depots": [
    {
      "depotId": "depot_xxxx",
      "name": "main",
      "root": "sha256:abc123...",
      "version": 5,
      "createdAt": "2025-01-01T00:00:00.000Z",
      "updatedAt": "2025-02-02T12:00:00.000Z",
      "description": "主仓库"
    }
  ],
  "cursor": "下一页游标"
}
```

---

## POST {base}/depots

创建一个新的 Depot。

### 请求

```json
{
  "name": "my-depot",
  "description": "我的仓库"
}
```

| 字段 | 类型 | 描述 |
|------|------|------|
| `name` | `string` | Depot 名称（唯一，1-100 字符） |
| `description` | `string?` | 描述（最多 500 字符） |

### 响应

```json
{
  "depotId": "depot_xxxx",
  "name": "my-depot",
  "root": "sha256:empty...",
  "version": 1,
  "createdAt": "2025-02-02T12:00:00.000Z",
  "updatedAt": "2025-02-02T12:00:00.000Z",
  "description": "我的仓库"
}
```

> 新创建的 Depot 以空 dict node (d-node) 作为初始 root

### 错误

| 状态码 | 描述 |
|--------|------|
| 409 | 同名 Depot 已存在 |

---

## GET {base}/depots/:depotId

获取指定 Depot 的详情。

### 响应

```json
{
  "depotId": "depot_xxxx",
  "name": "my-depot",
  "root": "sha256:abc123...",
  "version": 5,
  "createdAt": "2025-01-01T00:00:00.000Z",
  "updatedAt": "2025-02-02T12:00:00.000Z",
  "description": "我的仓库"
}
```

| 字段 | 描述 |
|------|------|
| `depotId` | Depot 唯一标识 |
| `name` | Depot 名称 |
| `root` | 当前根节点 key |
| `version` | 当前版本号 |
| `createdAt` | 创建时间 |
| `updatedAt` | 最后更新时间 |
| `description` | 描述 |

---

## PUT {base}/depots/:depotId

更新 Depot 的根节点。这会创建一个新版本。

### 请求

```json
{
  "root": "sha256:newroot...",
  "message": "更新说明"
}
```

| 字段 | 类型 | 描述 |
|------|------|------|
| `root` | `string` | 新的根节点 key（必须已存在） |
| `message` | `string?` | 版本更新说明 |

### 响应

```json
{
  "depotId": "depot_xxxx",
  "name": "my-depot",
  "root": "sha256:newroot...",
  "version": 6,
  "createdAt": "2025-01-01T00:00:00.000Z",
  "updatedAt": "2025-02-02T13:00:00.000Z",
  "description": "我的仓库"
}
```

### 错误

| 状态码 | 描述 |
|--------|------|
| 400 | 新 root 节点不存在 |
| 404 | Depot 不存在 |

---

## DELETE {base}/depots/:depotId

删除指定的 Depot。

> **注意**: 无法删除名为 "main" 的默认 Depot。

### 响应

```json
{
  "deleted": true
}
```

### 错误

| 状态码 | 描述 |
|--------|------|
| 403 | 无法删除 main depot |
| 404 | Depot 不存在 |

---

## GET {base}/depots/:depotId/history

列出 Depot 的版本历史。

### 查询参数

| 参数 | 类型 | 描述 |
|------|------|------|
| `limit` | `number?` | 返回数量限制，默认 50 |
| `cursor` | `string?` | 分页游标 |

### 响应

```json
{
  "history": [
    {
      "version": 6,
      "root": "sha256:v6root...",
      "createdAt": "2025-02-02T13:00:00.000Z",
      "message": "最新更新"
    },
    {
      "version": 5,
      "root": "sha256:v5root...",
      "createdAt": "2025-02-02T12:00:00.000Z",
      "message": "之前的版本"
    }
  ],
  "cursor": "下一页游标"
}
```

---

## POST {base}/depots/:depotId/rollback

回滚 Depot 到指定的历史版本。

### 请求

```json
{
  "version": 3
}
```

| 字段 | 类型 | 描述 |
|------|------|------|
| `version` | `number` | 目标版本号 |

### 响应

```json
{
  "depotId": "depot_xxxx",
  "name": "my-depot",
  "root": "sha256:v3root...",
  "version": 7,
  "createdAt": "2025-01-01T00:00:00.000Z",
  "updatedAt": "2025-02-02T14:00:00.000Z",
  "description": "我的仓库"
}
```

> 回滚会创建一个新版本，记录回滚操作

### 错误

| 状态码 | 描述 |
|--------|------|
| 404 | Depot 或目标版本不存在 |

---

## 版本控制说明

### 版本号

- 版本号从 1 开始，每次更新 root 时递增
- 回滚也会创建新版本（不会减少版本号）

### 引用计数

- 更新 root 时，新 root 引用计数 +1，旧 root 引用计数 -1
- 删除 Depot 时，当前 root 引用计数 -1
- 引用计数为 0 的节点由 GC 清理

### 历史保留

- 历史记录保留所有版本信息
- 可以通过 rollback 恢复到任意历史版本

---

## 使用示例

### 创建并更新 Depot

```bash
# 1. 创建 Depot
curl -X POST /api/realm/usr_xxx/depots \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"name": "docs", "description": "文档仓库"}'

# 2. 上传数据（省略 chunks 上传步骤）

# 3. 更新 Depot root
curl -X PUT /api/realm/usr_xxx/depots/depot_yyy \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"root": "sha256:newroot...", "message": "添加新文档"}'

# 4. 查看历史
curl /api/realm/usr_xxx/depots/depot_yyy/history \
  -H "Authorization: Bearer $TOKEN"

# 5. 回滚到版本 2
curl -X POST /api/realm/usr_xxx/depots/depot_yyy/rollback \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"version": 2}'
```
