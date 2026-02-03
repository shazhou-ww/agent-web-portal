# Auth 授权 API

用于管理 AWP 客户端、Ticket 和 Agent Token 的 API 端点。

## AWP 客户端管理

AWP (Agent Web Portal) 客户端使用 P256 公钥进行认证。

### 端点列表

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| POST | `/api/auth/clients/init` | 初始化认证流程 | 无 |
| GET | `/api/auth/clients/status` | 轮询认证状态 | 无 |
| POST | `/api/auth/clients/complete` | 完成授权 | User Token |
| GET | `/api/auth/clients` | 列出已授权客户端 | User Token |
| DELETE | `/api/auth/clients/:pubkey` | 撤销客户端 | User Token |

---

### POST /api/auth/clients/init

初始化 AWP 客户端认证流程。客户端生成 P256 密钥对后调用此接口。

#### 请求

```json
{
  "pubkey": "P256 公钥（Base64 或 PEM 格式）",
  "client_name": "客户端名称"
}
```

#### 响应

```json
{
  "auth_url": "https://example.com/auth/awp?pubkey=xxx",
  "verification_code": "ABCD-1234",
  "expires_in": 600,
  "poll_interval": 5
}
```

| 字段 | 描述 |
|------|------|
| `auth_url` | 用户授权页面 URL |
| `verification_code` | 验证码，显示给用户核对 |
| `expires_in` | 过期时间（秒） |
| `poll_interval` | 建议的轮询间隔（秒） |

---

### GET /api/auth/clients/status

轮询认证完成状态。

#### 请求参数

| 参数 | 描述 |
|------|------|
| `pubkey` | 公钥（URL 编码） |

#### 响应

认证成功：

```json
{
  "authorized": true,
  "expires_at": 1709294400000
}
```

等待中：

```json
{
  "authorized": false
}
```

无待处理的认证：

```json
{
  "authorized": false,
  "error": "No pending authorization found"
}
```

---

### POST /api/auth/clients/complete

用户确认授权后完成客户端认证。

#### 请求

需要 `Authorization` header：

```http
Authorization: Bearer {userToken}
```

```json
{
  "pubkey": "P256 公钥",
  "verification_code": "ABCD-1234"
}
```

#### 响应

```json
{
  "success": true,
  "expires_at": 1709294400000
}
```

#### 错误

| 状态码 | 描述 |
|--------|------|
| 400 | 验证码无效或已过期 |
| 401 | 需要用户认证 |

---

### GET /api/auth/clients

列出当前用户已授权的 AWP 客户端。

#### 请求

需要 `Authorization` header

#### 响应

```json
{
  "clients": [
    {
      "pubkey": "P256 公钥",
      "clientName": "My Agent",
      "createdAt": 1738497600000,
      "expiresAt": 1741089600000
    }
  ]
}
```

---

### DELETE /api/auth/clients/:pubkey

撤销指定的 AWP 客户端授权。

#### 请求

需要 `Authorization` header

路径参数：

- `pubkey`: URL 编码的公钥

#### 响应

```json
{
  "success": true
}
```

#### 错误

| 状态码 | 描述 |
|--------|------|
| 404 | 客户端不存在或无权限 |

---

## Ticket 管理

Ticket 是临时访问凭证，可以限制访问范围和权限。

### 端点列表

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| POST | `/api/auth/ticket` | 创建 Ticket | Agent/User Token |
| DELETE | `/api/auth/ticket/:id` | 撤销 Ticket | Agent/User Token |

---

### POST /api/auth/ticket

创建一个新的 Ticket。

#### 请求

需要 `Authorization` header（支持 User Token 或 Agent Token）

```json
{
  "input": ["node:xxx", "node:yyy"],
  "writable": {
    "quota": 10485760,
    "accept": ["image/*", "application/json"]
  },
  "expiresIn": 3600
}
```

| 字段 | 类型 | 描述 |
|------|------|------|
| `input` | `string[]?` | 输入节点 key 数组，未指定则可读全部 |
| `writable` | `object?` | 写入权限配置，未指定则只读 |
| `writable.quota` | `number?` | 上传字节数限制 |
| `writable.accept` | `string[]?` | 允许的 MIME 类型 |
| `expiresIn` | `number?` | 有效期（秒），默认 3600 |

#### 响应

```json
{
  "id": "ticket:01HQXK5V8N3Y7M2P4R6T9W0ABC",
  "endpoint": "https://api.example.com/api/ticket/ticket:01HQXK5V8N3Y7M2P4R6T9W0ABC",
  "expiresAt": 1738501200000,
  "realm": "user:01HQXK5V8N3Y7M2P4R6T9W0XYZ",
  "input": ["node:xxx"],
  "writable": {
    "quota": 10485760,
    "accept": ["image/*"]
  },
  "config": {
    "nodeLimit": 4194304,
    "maxNameBytes": 255
  }
}
```

---

### DELETE /api/auth/ticket/:id

撤销指定的 Ticket。

#### 请求

需要 `Authorization` header

#### 响应

```json
{
  "success": true
}
```

---

## Agent Token 管理

Agent Token 是为 AI Agent 创建的长期访问令牌。

### Token 格式

| 字段 | 格式 | 说明 |
|------|------|------|
| Token 值 | `casfa_{base32}` | 240-bit 随机数的 Crockford Base32 编码（48 字符），共 54 字符 |
| Token ID | `token:{hash}` | Token 值的 Blake3s 哈希 |

> **安全设计**：
> - 服务端**不保存** Token 值，仅保存 Token ID（hash）
> - Token 值仅在创建时返回一次
> - 鉴权时，服务端计算请求中 Token 的 hash，查询数据库验证

### 端点列表

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| POST | `/api/auth/tokens` | 创建 Agent Token | User Token |
| GET | `/api/auth/tokens` | 列出 Agent Token | User Token |
| DELETE | `/api/auth/tokens/:id` | 撤销 Agent Token | User Token |

---

### POST /api/auth/tokens

创建一个新的 Agent Token。

#### 请求

需要 `Authorization` header

```json
{
  "name": "My AI Agent",
  "description": "用于自动化任务的 Agent",
  "expiresIn": 2592000
}
```

| 字段 | 类型 | 描述 |
|------|------|------|
| `name` | `string` | Token 名称（必填） |
| `description` | `string?` | 描述 |
| `expiresIn` | `number?` | 有效期（秒），默认 30 天 |

#### 响应

```json
{
  "id": "token:01HQXK5V8N3Y7M2P4R6T9W0ABC",
  "token": "casfa_0123456789ABCDEFGHJKMNPQRSTVWXYZ0123456789ABCDEF",
  "name": "My AI Agent",
  "description": "用于自动化任务的 Agent",
  "expiresAt": 1741089600000,
  "createdAt": 1738497600000
}
```

> **注意**: `token` 字段仅在创建时返回一次，请妥善保存。列表接口不会返回 token 内容。

---

### GET /api/auth/tokens

列出当前用户的所有 Agent Token。

#### 请求

需要 `Authorization` header

#### 响应

```json
{
  "tokens": [
    {
      "id": "token:01HQXK5V8N3Y7M2P4R6T9W0ABC",
      "name": "My AI Agent",
      "description": "用于自动化任务的 Agent",
      "expiresAt": 1741089600000,
      "createdAt": 1738497600000
    }
  ]
}
```

---

### DELETE /api/auth/tokens/:id

撤销指定的 Agent Token。

#### 请求

需要 `Authorization` header

#### 响应

```json
{
  "success": true
}
```

#### 错误

| 状态码 | 描述 |
|--------|------|
| 404 | Token 不存在 |
