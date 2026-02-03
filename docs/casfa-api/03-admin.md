# Admin 管理 API

用于管理用户和权限的管理员 API 端点。

> **注意**: 所有 Admin API 都需要管理员权限（role = "admin"）。

## 端点列表

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| GET | `/api/admin/users` | 列出所有用户 | Admin |
| POST | `/api/admin/users/:userId/authorize` | 设置用户角色 | Admin |
| DELETE | `/api/admin/users/:userId/authorize` | 撤销用户授权 | Admin |

---

## GET /api/admin/users

列出所有已授权的用户，包含 Cognito 用户信息。

### 请求

需要管理员认证：

```http
Authorization: Bearer {adminToken}
```

### 响应

```json
{
  "users": [
    {
      "userId": "cognito-user-id",
      "role": "authorized",
      "email": "user@example.com",
      "name": "用户名"
    },
    {
      "userId": "another-user-id",
      "role": "admin",
      "email": "admin@example.com",
      "name": "管理员"
    }
  ]
}
```

### 用户角色说明

| 角色 | 描述 |
|------|------|
| `unauthorized` | 未授权用户，无法访问 CAS 资源 |
| `authorized` | 已授权用户，可以访问自己的 Realm |
| `admin` | 管理员，可以管理所有用户 |

---

## POST /api/admin/users/:userId/authorize

设置指定用户的角色。

### 请求

需要管理员认证：

```http
Authorization: Bearer {adminToken}
```

路径参数：

- `userId`: 用户 ID（URL 编码）

请求体：

```json
{
  "role": "authorized"
}
```

| 字段 | 类型 | 描述 |
|------|------|------|
| `role` | `"authorized" \| "admin"` | 要设置的角色 |

### 响应

```json
{
  "userId": "cognito-user-id",
  "role": "authorized"
}
```

### 错误

| 状态码 | 描述 |
|--------|------|
| 400 | 请求格式错误或角色无效 |
| 401 | 未认证 |
| 403 | 需要管理员权限 |

---

## DELETE /api/admin/users/:userId/authorize

撤销指定用户的授权。

### 请求

需要管理员认证：

```http
Authorization: Bearer {adminToken}
```

路径参数：

- `userId`: 用户 ID（URL 编码）

### 响应

```json
{
  "userId": "cognito-user-id",
  "revoked": true
}
```

### 错误

| 状态码 | 描述 |
|--------|------|
| 401 | 未认证 |
| 403 | 需要管理员权限 |

---

## 权限说明

### 角色层级

```
unauthorized < authorized < admin
```

### 权限矩阵

| 操作 | unauthorized | authorized | admin |
|------|--------------|------------|-------|
| 访问自己的 Realm | ❌ | ✅ | ✅ |
| 创建 Ticket | ❌ | ✅ | ✅ |
| 创建 Agent Token | ❌ | ✅ | ✅ |
| 管理 AWP 客户端 | ❌ | ✅ | ✅ |
| 管理用户 | ❌ | ❌ | ✅ |
| 查看所有用户 | ❌ | ❌ | ✅ |
