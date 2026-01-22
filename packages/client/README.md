# @agent-web-portal/client

Agent Web Portal 客户端 SDK，提供自动 Blob 处理和预签名 URL 管理。

## 概述

`@agent-web-portal/client` 提供：

- **AwpClient** - 高级客户端类
- **Blob 自动处理** - 自动生成预签名 URL
- **Storage Provider** - 抽象存储接口 (支持 S3)

## 安装

```bash
bun add @agent-web-portal/client

# 如果使用 S3 存储
bun add @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

## 快速开始

```typescript
import { AwpClient, S3StorageProvider } from "@agent-web-portal/client";

const client = new AwpClient({
  endpoint: "https://my-awp-server.com/mcp",
  storage: new S3StorageProvider({
    region: "us-east-1",
    bucket: "my-bucket",
  }),
  outputPrefix: "output",
});

// 初始化连接
await client.initialize();

// 调用 Tool
const result = await client.callTool("greet", { name: "World" });
console.log(result.data); // { message: "Hello, World!" }
```

## Blob 处理

客户端自动处理 Blob 字段：

```typescript
// 调用带 Blob 的 Tool
const result = await client.callTool("process-document", {
  document: "s3://my-bucket/input/doc.pdf",  // 输入 Blob URI
  options: { quality: 80 },
});

// 结果中的 Blob 字段自动填充为永久 URI
console.log(result.data.thumbnail); // "s3://my-bucket/output/thumb.png"
console.log(result.data.metadata);  // { pageCount: 10 }
```

## API

### `AwpClient`

```typescript
const client = new AwpClient({
  endpoint: string,           // AWP 服务器 URL
  storage: StorageProvider,   // 存储提供者
  outputPrefix?: string,      // 输出 Blob 前缀
  headers?: Record<string, string>,  // 自定义请求头
  fetch?: typeof fetch,       // 自定义 fetch 函数
});

// 方法
await client.initialize();                    // 初始化连接
await client.listTools();                     // 列出所有 Tools
await client.callTool(name, args, schema?);   // 调用 Tool
await client.getToolBlobSchema(name);         // 获取 Tool 的 Blob Schema
client.setToolBlobSchema(name, schema);       // 设置 Tool 的 Blob Schema
```

### `S3StorageProvider`

```typescript
const storage = new S3StorageProvider({
  region: "us-east-1",
  bucket: "my-bucket",
  prefix?: "data/",           // 可选前缀
  expiresIn?: 3600,           // 预签名 URL 有效期 (秒)
});
```

### 自定义 Storage Provider

实现 `StorageProvider` 接口：

```typescript
interface StorageProvider {
  canHandle(uri: string): boolean;
  generatePresignedGetUrl(uri: string): Promise<string>;
  generatePresignedPutUrl(prefix: string): Promise<PresignedUrlPair>;
}

interface PresignedUrlPair {
  uri: string;          // 永久 URI (如 s3://bucket/key)
  presignedUrl: string; // 预签名 URL
}
```

## BlobInterceptor

低级 API，用于自定义 Blob 处理：

```typescript
import { BlobInterceptor } from "@agent-web-portal/client";

const interceptor = new BlobInterceptor({
  storage: myStorage,
  outputPrefix: "output",
});

// 准备 Blob 上下文
const blobContext = await interceptor.prepareBlobContext(args, blobSchema);

// 填充输出 Blob URI
const filledResult = interceptor.fillOutputBlobUris(result, blobContext, blobSchema);
```

## 类型导出

- `AwpClient` - 客户端类
- `AwpClientOptions` - 客户端选项
- `S3StorageProvider` - S3 存储提供者
- `StorageProvider` - 存储提供者接口
- `BlobInterceptor` - Blob 拦截器
- `ToolBlobSchema` - Tool Blob Schema

## License

MIT
