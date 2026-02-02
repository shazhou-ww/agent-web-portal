# OAuth 认证 API

用于用户身份认证的 API 端点。

## 端点列表

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| GET | `/api/oauth/config` | 获取 Cognito 配置 | 无 |
| POST | `/api/oauth/token` | 交换授权码获取 Token | 无 |
| POST | `/api/oauth/login` | 用户登录（邮箱密码） | 无 |
| POST | `/api/oauth/refresh` | 刷新 Token | 无 |
| GET | `/api/oauth/me` | 获取当前用户信息 | User Token |

---

## GET /api/oauth/config

获取 Cognito 配置信息，用于前端初始化 OAuth 流程。

### 请求

无需参数

### 响应

```json
{
  "cognitoUserPoolId": "us-east-1_xxxxxx",
  "cognitoClientId": "xxxxxxxxxxxxxxxxxxxxxxxxxx",
  "cognitoHostedUiUrl": "https://xxx.auth.us-east-1.amazoncognito.com"
}
```

---

## POST /api/oauth/token

交换 OAuth 授权码获取 Token（用于 Cognito Hosted UI / Google 登录）。

### 请求

```json
{
  "code": "授权码",
  "redirect_uri": "回调 URL"
}
```

### 响应

成功时返回 Cognito Token 响应：

```json
{
  "access_token": "...",
  "id_token": "...",
  "refresh_token": "...",
  "token_type": "Bearer",
  "expires_in": 3600
}
```

### 错误

| 状态码 | 描述 |
|--------|------|
| 400 | 缺少 code 或 redirect_uri |
| 502 | Cognito Token 交换失败 |
| 503 | OAuth 未配置 |

---

## POST /api/oauth/login

使用邮箱和密码登录。

### 请求

```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

### 响应

```json
{
  "userToken": "JWT Token",
  "refreshToken": "刷新 Token",
  "expiresAt": "2025-02-03T12:00:00.000Z",
  "user": {
    "id": "用户 ID",
    "email": "user@example.com",
    "name": "用户名"
  },
  "role": "authorized"
}
```

### 错误

| 状态码 | 描述 |
|--------|------|
| 400 | 请求格式错误 |
| 401 | 认证失败 |

---

## POST /api/oauth/refresh

使用刷新 Token 获取新的访问 Token。

### 请求

```json
{
  "refreshToken": "刷新 Token"
}
```

### 响应

```json
{
  "userToken": "新的 JWT Token",
  "expiresAt": "2025-02-03T12:00:00.000Z",
  "role": "authorized"
}
```

### 错误

| 状态码 | 描述 |
|--------|------|
| 400 | 请求格式错误 |
| 401 | Token 刷新失败 |

---

## GET /api/oauth/me

获取当前已认证用户的信息。

### 请求

需要 `Authorization` header：

```http
Authorization: Bearer {userToken}
```

### 响应

```json
{
  "userId": "用户 ID",
  "realm": "usr_xxxxxxxx",
  "role": "authorized"
}
```

### 错误

| 状态码 | 描述 |
|--------|------|
| 401 | 未认证 |

---

## 用户角色说明

| 角色 | 描述 |
|------|------|
| `unauthorized` | 未授权用户，无法访问 CAS 资源 |
| `authorized` | 已授权用户，可以访问自己的 Realm |
| `admin` | 管理员，可以管理所有用户 |
