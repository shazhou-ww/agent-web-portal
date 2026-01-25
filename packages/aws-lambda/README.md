# @agent-web-portal/aws-lambda

Agent Web Portal 的 AWS Lambda 适配器。

## 概述

`@agent-web-portal/aws-lambda` 提供：

- **Lambda Handler Builder** - 流式构建 Lambda 函数
- **API Gateway 集成** - 自动处理请求/响应转换
- **Skills 配置** - S3 Skills 加载支持
- **CORS 支持** - 自动处理跨域请求
- **OAuth Metadata** - 自动暴露 well-known 端点

## 安装

```bash
bun add @agent-web-portal/aws-lambda
```

## 快速开始

```typescript
import { createAgentWebPortalHandler } from "@agent-web-portal/aws-lambda";
import { z } from "zod";

export const handler = createAgentWebPortalHandler({ name: "my-portal" })
  .registerTool("greet", {
    inputSchema: z.object({ name: z.string() }),
    outputSchema: z.object({ message: z.string() }),
    handler: async ({ name }) => ({ message: `Hello, ${name}!` }),
  })
  .build();
```

## Skills 配置

从 S3 加载 Skills：

```typescript
export const handler = createAgentWebPortalHandler({ name: "my-portal" })
  .registerTool("search", { ... })
  .withSkillsConfig({
    bucket: process.env.SKILLS_BUCKET!,
    prefix: "skills/",
    skills: [
      {
        name: "search-skill",
        s3Key: "search-skill.zip",
        frontmatter: {
          name: "Search Skill",
          "allowed-tools": ["search"],
        },
      },
    ],
  })
  .build();
```

## API

### `createAgentWebPortalHandler(options)`

创建 Lambda Handler Builder。

```typescript
const builder = createAgentWebPortalHandler({
  name: "my-portal",
  version: "1.0.0",
  description: "My AWP Lambda",
});
```

### `.registerTool(name, options)`

注册 Tool（同 core 包）。

### `.withSkillsConfig(config)`

配置 Skills 加载。

```typescript
interface SkillsConfig {
  bucket: string;              // S3 bucket 名称
  prefix?: string;             // S3 key 前缀
  skills: SkillConfig[];       // Skills 列表
}

interface SkillConfig {
  name: string;                // Skill 名称
  s3Key: string;               // S3 中的文件 key
  frontmatter: SkillFrontmatter;
}
```

### `.withMiddleware(middleware)`

添加认证中间件。

```typescript
import { createAwpAuthMiddleware } from "@agent-web-portal/auth";

const authMiddleware = createAwpAuthMiddleware({
  pendingAuthStore,
  pubkeyStore,
});

builder.withMiddleware(authMiddleware);
```

### `.withAwpAuth(config)`

配置 AWP ECDSA P-256 认证。自动处理 `/auth/init` 和 `/auth/status` 端点。

```typescript
import { DynamoDBPendingAuthStore, DynamoDBPubkeyStore } from "@agent-web-portal/aws-lambda";

const pendingAuthStore = new DynamoDBPendingAuthStore({ tableName: "awp-auth" });
const pubkeyStore = new DynamoDBPubkeyStore({ tableName: "awp-auth" });

builder.withAwpAuth({
  pendingAuthStore,
  pubkeyStore,
  authInitPath: "/auth/init",      // 可选，默认 "/auth/init"
  authStatusPath: "/auth/status",  // 可选，默认 "/auth/status"
  authPagePath: "/auth",           // 可选，默认 "/auth"
});
```

**注意：** `/auth/complete` 端点需要应用自己实现，因为需要验证用户会话。使用 `.withRoutes()` 添加：

```typescript
import { completeAuthorization } from "@agent-web-portal/auth";

builder.withRoutes(async (request) => {
  const url = new URL(request.url);
  if (url.pathname === "/auth/complete" && request.method === "POST") {
    const userId = await getUserFromSession(request); // 应用特定的会话验证
    if (!userId) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }
    const body = JSON.parse(await request.text());
    const result = await completeAuthorization(
      body.pubkey,
      body.verification_code,
      userId,
      { pendingAuthStore, pubkeyStore }
    );
    return new Response(JSON.stringify(result), {
      status: result.success ? 200 : 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  return null;
});
```

### `.withRoutes(handler)`

添加自定义路由处理器。返回 `Response` 表示已处理，返回 `null` 继续到下一个处理器。

```typescript
builder.withRoutes(async (request) => {
  const url = new URL(request.url);
  if (url.pathname === "/health") {
    return new Response(JSON.stringify({ status: "ok" }), {
      headers: { "Content-Type": "application/json" },
    });
  }
  return null;
});

### `.build()`

构建 Lambda Handler。

## 路由

默认路由：

| Path | Method | 功能 |
|------|--------|------|
| `/mcp` 或 `/` | POST | MCP 端点 |
| `/auth/init` | POST | AWP 认证初始化（需配置 `withAwpAuth`） |
| `/auth/status` | GET | AWP 认证状态查询（需配置 `withAwpAuth`） |
| `/skills/:name` | GET | Skill 下载（重定向到 S3 presigned URL） |
| 任意路径 | OPTIONS | CORS 预检 |

## 环境变量

| 变量 | 说明 |
|------|------|
| `SKILLS_BUCKET` | Skills S3 bucket |
| `AWS_REGION` | AWS 区域 |

## SAM 模板示例

```yaml
AWSTemplateFormatVersion: '2010-09-09'
Transform: AWS::Serverless-2016-10-31

Resources:
  MyPortalFunction:
    Type: AWS::Serverless::Function
    Properties:
      Handler: handler.handler
      Runtime: nodejs20.x
      MemorySize: 256
      Timeout: 30
      Environment:
        Variables:
          SKILLS_BUCKET: !Ref SkillsBucket
      Events:
        McpEndpoint:
          Type: Api
          Properties:
            Path: /mcp
            Method: POST

  SkillsBucket:
    Type: AWS::S3::Bucket
```

## 低级 API

直接使用 `createLambdaHandler`：

```typescript
import { createLambdaHandler } from "@agent-web-portal/aws-lambda";

const portal = createAgentWebPortal({ name: "my-portal" })
  .registerTool(...)
  .build();

export const handler = createLambdaHandler(portal, {
  basePath: "/api",
  corsOrigins: ["https://example.com"],
});
```

## 类型导出

- `LambdaHandlerBuilder` - Builder 类
- `LambdaHandler` - Lambda Handler 类型
- `APIGatewayProxyEvent` - API Gateway 事件
- `APIGatewayProxyResult` - API Gateway 响应
- `SkillsConfig` - Skills 配置
- `LambdaAuthMiddleware` - 认证中间件类型
- `AwpAuthLambdaConfig` - AWP 认证配置
- `DynamoDBPendingAuthStore` - DynamoDB 待授权存储
- `DynamoDBPubkeyStore` - DynamoDB 公钥存储

## License

MIT
