# Ticket CAS 操作 API

通过 Ticket 路由访问 CAS 存储的 API。Ticket ID 在 URL 路径中作为凭证，无需 Authorization header。

## 认证

Ticket 路由不需要 Authorization header，Ticket ID 本身就是凭证：

```
/api/ticket/{ticketId}/...
```

> **安全提示**: Ticket ID 应当保密，仅分享给需要访问的客户端。

## 端点列表

| 方法 | 路径 | 描述 | 权限 |
|------|------|------|------|
| GET | `/api/ticket/{ticketId}` | 获取 Ticket 端点信息 | - |
| GET | `/api/ticket/{ticketId}/usage` | 获取使用统计 | Read |
| POST | `/api/ticket/{ticketId}/commit` | 创建 Commit | Write |
| GET | `/api/ticket/{ticketId}/commits` | 列出 Commits | Read |
| GET | `/api/ticket/{ticketId}/commits/:root` | 获取 Commit 详情 | Read |
| PATCH | `/api/ticket/{ticketId}/commits/:root` | 更新 Commit | Write |
| DELETE | `/api/ticket/{ticketId}/commits/:root` | 删除 Commit | Write |
| POST | `/api/ticket/{ticketId}/prepare-nodes` | 预上传检查 | Write |
| GET | `/api/ticket/{ticketId}/nodes/:key/metadata` | 获取节点元信息 | Read |
| GET | `/api/ticket/{ticketId}/nodes/:key` | 获取节点二进制数据 | Read |
| PUT | `/api/ticket/{ticketId}/nodes/:key` | 上传节点 | Write |

---

## GET /api/ticket/{ticketId}

获取 Ticket 端点信息和配置。无需认证 header。

### 响应

```json
{
  "realm": "usr_xxxxxxxx",
  "scope": ["sha256:abc123..."],
  "commit": {
    "quota": 10485760,
    "accept": ["image/*"]
  },
  "expiresAt": "2025-02-02T13:00:00.000Z",
  "nodeLimit": 4194304,
  "maxNameBytes": 255
}
```

| 字段 | 描述 |
|------|------|
| `realm` | Ticket 所属 Realm |
| `scope` | 可读的 root key 列表，undefined 表示完全访问 |
| `commit` | 提交权限配置，undefined 表示只读 |
| `commit.quota` | 上传字节数限制 |
| `commit.accept` | 允许的 MIME 类型 |
| `commit.root` | 如已提交，显示提交的 root key |
| `expiresAt` | Ticket 过期时间 |
| `nodeLimit` | 单个节点最大字节数 |
| `maxNameBytes` | 文件名最大 UTF-8 字节数 |

### 错误

| 状态码 | 描述 |
|--------|------|
| 404 | Ticket 不存在 |
| 410 | Ticket 已过期 |

---

## Ticket 权限说明

### 读取权限

Ticket 的读取权限由 `scope` 字段控制：

- `scope` 为 undefined：可读取 Realm 内所有节点
- `scope` 为 string[]：只能读取指定 root key 及其子节点

### 写入权限

Ticket 的写入权限由 `commit` 字段控制：

- `commit` 为 undefined：只读，无法写入
- `commit` 存在：可以写入，受以下限制：
  - `quota`：总上传字节数限制
  - `accept`：允许的 MIME 类型（如 `["image/*"]`）
  - 一旦提交（commit），`commit.root` 会记录 root key，之后无法再次提交

---

## CAS 操作

Ticket 路由下的 CAS 操作与 [Realm 路由](./05-realm.md) 相同，区别在于：

1. **认证方式不同**: Ticket ID 在路径中，无需 header
2. **权限受限**: 受 Ticket 的 scope 和 commit 配置限制
3. **一次性提交**: 如果 Ticket 有 commit 权限，只能提交一次

### 示例：通过 Ticket 上传文件

1. **获取可写 Ticket**（从创建 Ticket 的响应中获取）：

   ```
   endpoint: https://api.example.com/api/ticket/ticket_xxx
   ```

2. **预检查需要上传的节点**：

   ```http
   POST /api/ticket/ticket_xxx/prepare-nodes
   Content-Type: application/json
   
   {"keys": ["sha256:abc123..."]}
   ```

3. **上传节点**：

   ```http
   PUT /api/ticket/ticket_xxx/nodes/sha256:abc123...
   Content-Type: application/octet-stream
   
   (二进制数据)
   ```

4. **创建 commit**：

   ```http
   POST /api/ticket/ticket_xxx/commit
   Content-Type: application/json
   
   {
     "root": "sha256:abc123...",
     "title": "Uploaded via ticket"
   }
   ```

### 示例：通过 Ticket 读取文件

1. **获取只读 Ticket**（带 scope 限制）

2. **获取节点元信息**：

   ```http
   GET /api/ticket/ticket_xxx/nodes/sha256:root.../metadata
   ```

3. **下载节点二进制数据**：

   ```http
   GET /api/ticket/ticket_xxx/nodes/sha256:file...
   ```

---

## 与 Realm 路由的对比

| 特性 | Realm 路由 | Ticket 路由 |
|------|------------|-------------|
| 认证方式 | Authorization header | URL 中的 Ticket ID |
| 访问范围 | 完整 Realm | 受 scope 限制 |
| 写入权限 | 总是可写 | 由 commit 配置控制 |
| 有效期 | Token 有效期 | Ticket 过期时间 |
| 适用场景 | 用户/Agent 直接访问 | 分享给第三方临时访问 |

---

## 错误处理

| 状态码 | 描述 |
|--------|------|
| 401 | Ticket 无效或已过期 |
| 403 | 超出 scope 或 commit 权限 |
| 413 | 超出 quota 限制 |
