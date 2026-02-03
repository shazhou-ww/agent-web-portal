# Commit 操作

Commit 是对 DAG 根节点的命名引用，用于标记重要的数据版本。

---

## POST /api/realm/{realmId}/commit

创建一个新的 Commit。root 节点必须先通过 `PUT /nodes/:key` 上传。

### 请求

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

### 响应

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
  "message": "Root node sha256:abc123... not found. Upload it via PUT /nodes/sha256:abc123... first."
}
```

---

## GET /api/realm/{realmId}/commits

列出 Realm 的所有 Commits。

### 查询参数

| 参数 | 类型 | 描述 |
|------|------|------|
| `limit` | `number?` | 返回数量限制，默认 100，最大 1000 |
| `startKey` | `string?` | 分页游标 |

### 响应

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

## GET /api/realm/{realmId}/commits/:root

获取指定 Commit 的详情。

### 响应

```json
{
  "root": "sha256:abc123...",
  "title": "My first commit",
  "createdAt": "2025-02-02T12:00:00.000Z",
  "createdBy": "token_xxxx"
}
```

---

## PATCH /api/realm/{realmId}/commits/:root

更新 Commit 的元数据。

### 请求

```json
{
  "title": "Updated title"
}
```

### 响应

```json
{
  "root": "sha256:abc123...",
  "title": "Updated title",
  "createdAt": "2025-02-02T12:00:00.000Z"
}
```

---

## DELETE /api/realm/{realmId}/commits/:root

删除指定的 Commit。这会减少根节点的引用计数，实际数据由 GC 处理。

### 响应

```json
{
  "success": true
}
```
