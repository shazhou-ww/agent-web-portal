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

## 端点列表

| 方法 | 路径 | 描述 | 权限 |
|------|------|------|------|
| GET | `/api/realm/{realmId}` | 获取 Realm 端点信息 | Read |
| GET | `/api/realm/{realmId}/usage` | 获取使用统计 | Read |
| POST | `/api/realm/{realmId}/commit` | 创建 Commit | Write |
| GET | `/api/realm/{realmId}/commits` | 列出 Commits | Read |
| GET | `/api/realm/{realmId}/commits/:root` | 获取 Commit 详情 | Read |
| PATCH | `/api/realm/{realmId}/commits/:root` | 更新 Commit 元数据 | Write |
| DELETE | `/api/realm/{realmId}/commits/:root` | 删除 Commit | Write |
| PUT | `/api/realm/{realmId}/chunks/:key` | 上传 CAS 节点 | Write |
| GET | `/api/realm/{realmId}/chunks/:key` | 获取原始节点数据 | Read |
| GET | `/api/realm/{realmId}/tree/:key` | 获取完整 DAG 结构 | Read |

> `realmId` 格式为 `usr_{userId}`

---

## GET /api/realm/{realmId}

获取 Realm 端点信息和配置。

### 响应

```json
{
  "realm": "usr_xxxxxxxx",
  "commit": {},
  "nodeLimit": 4194304,
  "maxNameBytes": 255
}
```

| 字段 | 描述 |
|------|------|
| `realm` | Realm 标识 |
| `scope` | 可读范围（undefined 表示完全访问） |
| `commit` | 提交权限配置（undefined 表示只读） |
| `nodeLimit` | 单个节点最大字节数 |
| `maxNameBytes` | 文件名最大 UTF-8 字节数 |

---

## GET /api/realm/{realmId}/usage

获取 Realm 的存储使用统计。

### 响应

```json
{
  "realm": "usr_xxxxxxxx",
  "physicalBytes": 1234567890,
  "logicalBytes": 987654321,
  "nodeCount": 12345,
  "quotaLimit": 10737418240,
  "updatedAt": "2025-02-02T12:00:00.000Z"
}
```

| 字段 | 描述 |
|------|------|
| `physicalBytes` | 物理存储字节数（去重后） |
| `logicalBytes` | 逻辑存储字节数（仅 f-node 和 s-node 数据） |
| `nodeCount` | 唯一节点数 |
| `quotaLimit` | 配额限制（0 = 无限制） |
| `updatedAt` | 最后更新时间 |

---

## Commit 操作

### POST /api/realm/{realmId}/commit

创建一个新的 Commit。root 节点必须先通过 `PUT /chunks/:key` 上传。

#### 请求

```json
{
  "root": "sha256:abc123...",
  "title": "My first commit"
}
```

| 字段 | 类型 | 描述 |
|------|------|------|
| `root` | `string` | 根节点 key（必须已存在） |
| `title` | `string?` | 提交标题 |

#### 响应

成功：

```json
{
  "success": true,
  "root": "sha256:abc123..."
}
```

根节点不存在：

```json
{
  "success": false,
  "error": "root_not_found",
  "message": "Root node sha256:abc123... not found. Upload it via PUT /chunks/sha256:abc123... first."
}
```

---

### GET /api/realm/{realmId}/commits

列出 Realm 的所有 Commits。

#### 查询参数

| 参数 | 类型 | 描述 |
|------|------|------|
| `limit` | `number?` | 返回数量限制，默认 100，最大 1000 |
| `startKey` | `string?` | 分页游标 |

#### 响应

```json
{
  "commits": [
    {
      "root": "sha256:abc123...",
      "title": "My first commit",
      "createdAt": "2025-02-02T12:00:00.000Z"
    }
  ],
  "nextKey": "下一页游标"
}
```

---

### GET /api/realm/{realmId}/commits/:root

获取指定 Commit 的详情。

#### 响应

```json
{
  "root": "sha256:abc123...",
  "title": "My first commit",
  "createdAt": "2025-02-02T12:00:00.000Z",
  "createdBy": "token_xxxx"
}
```

---

### PATCH /api/realm/{realmId}/commits/:root

更新 Commit 的元数据。

#### 请求

```json
{
  "title": "Updated title"
}
```

#### 响应

```json
{
  "root": "sha256:abc123...",
  "title": "Updated title",
  "createdAt": "2025-02-02T12:00:00.000Z"
}
```

---

### DELETE /api/realm/{realmId}/commits/:root

删除指定的 Commit。这会减少根节点的引用计数，实际数据由 GC 处理。

#### 响应

```json
{
  "success": true
}
```

---

## Chunk 操作

### PUT /api/realm/{realmId}/chunks/:key

上传 CAS 节点（二进制格式）。

#### 请求

- Content-Type: `application/octet-stream`
- Body: 二进制节点数据

节点格式遵循 cas-core 二进制格式，包含：

- Magic bytes 和头部结构
- Hash 验证
- 子节点存在性验证
- Dict 节点 (d-node) 的 size 验证

#### 响应

```json
{
  "key": "sha256:abc123...",
  "size": 12345,
  "kind": "file"
}
```

| 字段 | 描述 |
|------|------|
| `key` | 节点 key |
| `size` | 逻辑大小 |
| `kind` | 节点类型：`dict`, `file`, `successor` |

#### 错误

| 状态码 | 描述 |
|--------|------|
| 400 | 节点格式无效 |
| 403 | 配额超限 |

子节点缺失时返回：

```json
{
  "success": false,
  "error": "missing_nodes",
  "missing": ["sha256:xxx", "sha256:yyy"]
}
```

---

### GET /api/realm/{realmId}/chunks/:key

获取原始节点数据（二进制格式）。

#### 响应

- Content-Type: `application/octet-stream`
- 响应头包含元数据：
  - `X-CAS-Kind`: 节点类型
  - `X-CAS-Size`: 逻辑大小
  - `X-CAS-Content-Type`: 原始内容类型（如适用）

---

## Tree 操作

### GET /api/realm/{realmId}/tree/:key

获取以指定 key 为根的完整 DAG 结构。

#### 响应

```json
{
  "nodes": {
    "sha256:root...": {
      "kind": "dict",
      "size": 12345,
      "children": {
        "file1.txt": "sha256:file1...",
        "subdir": "sha256:subdir..."
      }
    },
    "sha256:file1...": {
      "kind": "file",
      "size": 1234,
      "contentType": "text/plain",
      "chunks": 1
    },
    "sha256:subdir...": {
      "kind": "dict",
      "size": 5678,
      "children": {
        "nested.txt": "sha256:nested..."
      }
    }
  },
  "next": "sha256:continuation..."
}
```

| 字段 | 描述 |
|------|------|
| `nodes` | key → 节点信息映射 |
| `next` | 如果结果被截断，继续获取的起始 key |

> 单次请求最多返回 1000 个节点

### 节点类型

| kind | 别名 | 描述 | 特有字段 |
|------|------|------|----------|
| `dict` | d-node | 目录节点，子节点按名称排序 | `children`: name → key 映射 |
| `file` | f-node | 文件顶层节点，包含 content-type | `contentType`, `chunks` |
| `successor` | s-node | 文件后继节点（大文件分块） | - |
