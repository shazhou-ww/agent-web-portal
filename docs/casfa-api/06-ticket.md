# Ticket CAS 操作 API

Ticket 是 Realm 的附属资源，提供有限的、有时间边界的 CAS 访问权限。Ticket ID 在 URL 路径中作为凭证，无需 Authorization header。

## 核心概念

### Ticket 是什么？

Ticket 承载了一个具体的任务上下文：
- **purpose**: 人类可读的任务描述，说明这个 ticket 的目的（创建时指定）
- **input**: 输入节点数组，代表任务的一个或多个输入数据（同时也是可读取的 scope）
- **output**: 可选的输出节点，代表任务的结果（commit 后填充）
- **writable**: 是否可写入（上传新节点并 commit）

### 生命周期

```
Active → Committed → Revoked → Deleted
  │          │          │          │
  │          │          │          └─ 物理删除（仅 User 可操作）
  │          │          └─ 被撤销，不可再使用（仅 Agent 可操作）
  │          └─ 已提交结果，output 已设置（仅 Tool 可操作）
  └─ 活跃状态，可读取和写入
```

| 状态 | 描述 | 可执行操作 |
|------|------|-----------|
| `active` | 活跃状态 | 读取、写入、commit、revoke |
| `committed` | 已提交 | 仅读取 |
| `revoked` | 已撤销 | 无（返回 410） |
| `deleted` | 已删除 | 无（返回 404） |

### 权限控制

| 操作 | 允许的调用者 |
|------|-------------|
| commit | Tool（通过 Ticket 凭证访问） |
| revoke | Agent（Ticket 的 issuer） |
| delete | User（Realm 所有者） |

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
| POST | `/api/ticket/{ticketId}/commit` | 提交结果（设置 output） | Write |
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
  "ticketId": "ticket:01HQXK5V8N3Y7M2P4R6T9W0ABC",
  "realm": "user:01HQXK5V8N3Y7M2P4R6T9W0XYZ",
  "status": "active",
  "purpose": "Generate thumbnail for uploaded image",
  "input": ["node:abc123..."],
  "output": null,
  "writable": true,
  "config": {
    "nodeLimit": 4194304,
    "maxNameBytes": 255,
    "quota": 10485760,
    "accept": ["image/*"]
  },
  "expiresAt": 1738501200000
}
```

| 字段 | 描述 |
|------|------|
| `ticketId` | Ticket ID |
| `realm` | Ticket 所属 Realm |
| `status` | 当前状态：`active`, `committed`, `revoked` |
| `purpose` | 人类可读的任务描述（创建时指定） |
| `input` | 输入节点 key 数组，同时也是可读取的 scope（包含所有 input 及其子节点） |
| `output` | 输出节点 key（commit 后填充） |
| `writable` | 是否可写入 |
| `config.nodeLimit` | 单个节点最大字节数 |
| `config.maxNameBytes` | 文件名最大 UTF-8 字节数 |
| `config.quota` | 上传字节数限制（仅 writable） |
| `config.accept` | 允许的 MIME 类型（仅 writable） |
| `expiresAt` | Ticket 过期时间 |

### 错误

| 状态码 | 描述 |
|--------|------|
| 404 | Ticket 不存在或已删除 |
| 410 | Ticket 已撤销 |

---

## POST /api/ticket/{ticketId}/commit

提交任务结果，设置 output 节点。状态从 `active` 变为 `committed`。

> **权限要求**: 仅 Tool（通过 Ticket 凭证访问）可以调用此接口。

### 请求

```json
{
  "output": "node:result..."
}
```

| 字段 | 类型 | 描述 |
|------|------|------|
| `output` | `string` | 输出节点 key（必须已上传） |

### 响应

成功：

```json
{
  "success": true,
  "status": "committed",
  "output": "node:result..."
}
```

### 错误

| 状态码 | 描述 |
|--------|------|
| 400 | output 节点不存在 |
| 403 | Ticket 不可写 |
| 409 | Ticket 已经 committed 或 revoked |
| 410 | Ticket 已撤销 |

---

## Ticket 权限说明

### 读取权限

Ticket 的读取权限由 `input` 字段控制：

- `input` 数组中的所有节点及其子节点都可读取
- 如果 `output` 已设置，`output` 及其子节点也可读取

### 写入权限

Ticket 的写入权限由 `writable` 字段控制：

- `writable: false`：只读，无法写入
- `writable: true`：可以写入，受以下限制：
  - `quota`：总上传字节数限制
  - `accept`：允许的 MIME 类型（如 `["image/*"]`）
  - 只能 commit 一次，之后变为 `committed` 状态

---

## CAS 操作

### 示例：Tool 通过 Ticket 完成任务

1. **获取 Ticket 信息**：

   ```http
   GET /api/ticket/ticket:01HQXK5V8N3Y7M2P4R6T9W0ABC
   ```

   返回 input 节点数组和配置信息。

2. **读取输入数据**（遍历 input 数组中的所有节点）：

   ```http
   GET /api/ticket/ticket:01HQXK5V8N3Y7M2P4R6T9W0ABC/nodes/node:input1.../metadata
   GET /api/ticket/ticket:01HQXK5V8N3Y7M2P4R6T9W0ABC/nodes/node:input1...
   GET /api/ticket/ticket:01HQXK5V8N3Y7M2P4R6T9W0ABC/nodes/node:input2.../metadata
   GET /api/ticket/ticket:01HQXK5V8N3Y7M2P4R6T9W0ABC/nodes/node:input2...
   ```

3. **上传结果节点**：

   ```http
   PUT /api/ticket/ticket:01HQXK5V8N3Y7M2P4R6T9W0ABC/nodes/node:result...
   Content-Type: application/octet-stream
   
   (二进制数据)
   ```

4. **提交结果**：

   ```http
   POST /api/ticket/ticket:01HQXK5V8N3Y7M2P4R6T9W0ABC/commit
   Content-Type: application/json
   
   {
     "output": "node:result..."
   }
   ```

### 示例：只读 Ticket 访问数据

1. **获取 Ticket 信息**，确认 input 节点数组

2. **读取节点数据**（可访问任意 input 及其子节点）：

   ```http
   GET /api/ticket/ticket:01HQXK5V8N3Y7M2P4R6T9W0ABC/nodes/node:input.../metadata
   GET /api/ticket/ticket:01HQXK5V8N3Y7M2P4R6T9W0ABC/nodes/node:file...
   ```

---

## 与 Realm 路由的对比

| 特性 | Realm 路由 | Ticket 路由 |
|------|------------|-------------|
| 认证方式 | Authorization header | URL 中的 Ticket ID |
| 访问范围 | 完整 Realm | input/output 节点及子节点 |
| 写入权限 | 总是可写 | 由 writable 控制 |
| 生命周期 | Token 有效期 | Ticket 状态机 |
| Commit | 无此概念 | 一次性提交 output |
| 适用场景 | 用户/Agent 直接访问 | 分享给 Tool 执行任务 |

---

## 错误处理

| 状态码 | 描述 |
|--------|------|
| 401 | Ticket 无效 |
| 403 | 超出 input 范围或 writable 权限 |
| 404 | Ticket 不存在或已删除 |
| 409 | 状态冲突（如已 committed） |
| 410 | Ticket 已撤销或过期 |
| 413 | 超出 quota 限制 |
