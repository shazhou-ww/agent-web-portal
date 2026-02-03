# CASFA API 文档

CASFA (Content-Addressable Storage for Agents) 是一个为 AI Agent 设计的内容寻址存储服务 API。

## 概述

所有 API 路由均以 `/api` 为前缀。

## ID 格式规范

所有 128 位标识符使用 Crockford Base32 编码，固定 26 位字符。

| 类型 | 格式 | 示例 |
|------|------|------|
| User ID | `user:{ulid}` | `user:01HQXK5V8N3Y7M2P4R6T9W0ABC` |
| Ticket ID | `ticket:{ulid}` | `ticket:01HQXK5V8N3Y7M2P4R6T9W0ABC` |
| Depot ID | `depot:{ulid}` | `depot:01HQXK5V8N3Y7M2P4R6T9W0ABC` |
| Agent ID | `agent:{ulid}` | `agent:01HQXK5V8N3Y7M2P4R6T9W0ABC` |
| Node Key | `node:{hash}` | `node:abc123...` |

> **注意**: 
> - 所有时间戳使用 epoch 毫秒格式（如 `1738497600000`）
> - Node Key 使用统一的 hash 算法，不带算法前缀
> - Realm ID 等同于 User ID

## 路由表

### 健康检查

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| GET | `/api/health` | 服务健康检查 | 无 |

### OAuth 认证 API

[详细文档](./01-oauth.md)

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| GET | `/api/oauth/config` | 获取 Cognito 配置 | 无 |
| POST | `/api/oauth/token` | 交换授权码获取 Token | 无 |
| POST | `/api/oauth/login` | 用户登录（邮箱密码） | 无 |
| POST | `/api/oauth/refresh` | 刷新 Token | 无 |
| GET | `/api/oauth/me` | 获取当前用户信息 | User Token |

### Auth 授权 API

[详细文档](./02-auth.md)

#### AWP 客户端管理

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| POST | `/api/auth/clients/init` | 初始化 AWP 客户端认证流程 | 无 |
| GET | `/api/auth/clients/status` | 轮询认证完成状态 | 无 |
| POST | `/api/auth/clients/complete` | 完成客户端授权 | User Token |
| GET | `/api/auth/clients` | 列出已授权的 AWP 客户端 | User Token |
| DELETE | `/api/auth/clients/:pubkey` | 撤销 AWP 客户端 | User Token |

#### Ticket 管理

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| POST | `/api/auth/ticket` | 创建 Ticket | Agent/User Token |
| DELETE | `/api/auth/ticket/:id` | 撤销 Ticket | Agent/User Token |

#### Agent Token 管理

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| POST | `/api/auth/tokens` | 创建 Agent Token | User Token |
| GET | `/api/auth/tokens` | 列出 Agent Token | User Token |
| DELETE | `/api/auth/tokens/:id` | 撤销 Agent Token | User Token |

### Admin 管理 API

[详细文档](./03-admin.md)

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| GET | `/api/admin/users` | 列出所有用户 | Admin |
| POST | `/api/admin/users/:userId/authorize` | 设置用户角色 | Admin |
| DELETE | `/api/admin/users/:userId/authorize` | 撤销用户授权 | Admin |

### MCP 协议 API

[详细文档](./04-mcp.md)

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| POST | `/api/mcp` | MCP JSON-RPC 端点 | Agent/User Token |

### Realm CAS 操作 API

[详细文档](./05-realm/README.md)

需要 `Authorization` header（User/Agent Token）

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| GET | `/api/realm/{realmId}` | 获取 Realm 端点信息 | User/Agent Token |
| GET | `/api/realm/{realmId}/usage` | 获取 Realm 使用统计 | User/Agent Token |
| POST | `/api/realm/{realmId}/commit` | 创建 Commit | Write |
| GET | `/api/realm/{realmId}/commits` | 列出 Commits | Read |
| GET | `/api/realm/{realmId}/commits/:root` | 获取 Commit 详情 | Read |
| PATCH | `/api/realm/{realmId}/commits/:root` | 更新 Commit 元数据 | Write |
| DELETE | `/api/realm/{realmId}/commits/:root` | 删除 Commit | Write |
| POST | `/api/realm/{realmId}/prepare-nodes` | 预上传检查 | Write |
| GET | `/api/realm/{realmId}/nodes/:key/metadata` | 获取节点元信息 | Read |
| GET | `/api/realm/{realmId}/nodes/:key` | 获取节点二进制数据 | Read |
| PUT | `/api/realm/{realmId}/nodes/:key` | 上传节点 | Write |
| GET | `/api/realm/{realmId}/depots` | 列出所有 Depots | Read |
| POST | `/api/realm/{realmId}/depots` | 创建 Depot | Write |
| GET | `/api/realm/{realmId}/depots/:depotId` | 获取 Depot 详情 | Read |
| PUT | `/api/realm/{realmId}/depots/:depotId` | 更新 Depot root | Write |
| DELETE | `/api/realm/{realmId}/depots/:depotId` | 删除 Depot | Write |
| GET | `/api/realm/{realmId}/depots/:depotId/history` | 列出 Depot 历史 | Read |
| POST | `/api/realm/{realmId}/depots/:depotId/rollback` | 回滚到指定版本 | Write |

### Ticket CAS 操作 API

[详细文档](./06-ticket.md)

Ticket ID 在路径中作为凭证，无需 `Authorization` header

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| GET | `/api/ticket/{ticketId}` | 获取 Ticket 端点信息 | Ticket ID |
| GET | `/api/ticket/{ticketId}/usage` | 获取使用统计 | Ticket (Read) |
| POST | `/api/ticket/{ticketId}/commit` | 创建 Commit | Ticket (Write) |
| GET | `/api/ticket/{ticketId}/commits` | 列出 Commits | Ticket (Read) |
| GET | `/api/ticket/{ticketId}/commits/:root` | 获取 Commit 详情 | Ticket (Read) |
| PATCH | `/api/ticket/{ticketId}/commits/:root` | 更新 Commit | Ticket (Write) |
| DELETE | `/api/ticket/{ticketId}/commits/:root` | 删除 Commit | Ticket (Write) |
| POST | `/api/ticket/{ticketId}/prepare-nodes` | 预上传检查 | Ticket (Write) |
| GET | `/api/ticket/{ticketId}/nodes/:key/metadata` | 获取节点元信息 | Ticket (Read) |
| GET | `/api/ticket/{ticketId}/nodes/:key` | 获取节点二进制数据 | Ticket (Read) |
| PUT | `/api/ticket/{ticketId}/nodes/:key` | 上传节点 | Ticket (Write) |

## 认证方式

CASFA 支持多种认证方式：

### 1. User Token

用户登录后获取的 JWT Token。

```http
Authorization: Bearer {userToken}
```

### 2. Agent Token

为 AI Agent 创建的长期访问令牌。

```http
Authorization: Agent {agentToken}
```

### 3. Ticket

临时访问凭证，Ticket ID 直接在 URL 路径中作为凭证。

```
/api/ticket/{ticketId}/...
```

### 4. AWP 签名

Agent Web Portal 客户端使用 P256 公钥签名认证。

```http
X-AWP-Pubkey: {publicKey}
X-AWP-Timestamp: {timestamp}
X-AWP-Signature: {signature}
```

## 用户角色

| 角色 | 描述 |
|------|------|
| `unauthorized` | 未授权用户，无法访问 CAS 资源 |
| `authorized` | 已授权用户，可以访问自己的 Realm |
| `admin` | 管理员，可以管理所有用户 |

## 错误响应

所有 API 在发生错误时返回统一格式：

```json
{
  "error": "错误描述",
  "details": { ... }
}
```

常见 HTTP 状态码：

| 状态码 | 描述 |
|--------|------|
| 400 | 请求参数错误 |
| 401 | 未认证 |
| 403 | 权限不足 |
| 404 | 资源不存在 |
| 409 | 资源冲突 |
| 410 | 资源已过期（如 Ticket） |
| 413 | 超出配额限制 |
| 500 | 服务器内部错误 |

## 相关文档

- [OAuth 认证 API](./01-oauth.md)
- [Auth 授权 API](./02-auth.md)
- [Admin 管理 API](./03-admin.md)
- [MCP 协议 API](./04-mcp.md)
- [Realm CAS 操作 API](./05-realm/README.md)
- [Ticket CAS 操作 API](./06-ticket.md)
