# @agent-web-portal/core

MCP 兼容的、场景导向的 AI Agent 框架核心包。

## 概述

`@agent-web-portal/core` 是 Agent Web Portal 的核心包，提供：

- **AgentWebPortal Builder** - 创建和配置 Portal 实例
- **Tool Registry** - 注册和管理 Tools
- **Skill Registry** - 注册和管理 Skills
- **HTTP Handler** - MCP 协议实现
- **Blob 支持** - 二进制数据交换机制

## 安装

```bash
bun add @agent-web-portal/core
```

## 快速开始

```typescript
import { createAgentWebPortal } from "@agent-web-portal/core";
import { z } from "zod";

const portal = createAgentWebPortal({ name: "my-portal" })
  .registerTool("greet", {
    inputSchema: z.object({ name: z.string() }),
    outputSchema: z.object({ message: z.string() }),
    handler: async ({ name }) => ({ message: `Hello, ${name}!` }),
  })
  .registerSkills({
    "greeting-skill": {
      url: "/skills/greeting-skill",
      frontmatter: { "allowed-tools": ["greet"] },
    },
  })
  .build();

// 使用 Bun 启动服务
Bun.serve({
  port: 3000,
  fetch: (req) => portal.handleRequest(req),
});
```

## API

### `createAgentWebPortal(options?)`

创建 Portal Builder 实例。

```typescript
const builder = createAgentWebPortal({
  name: "my-portal",      // 服务器名称
  version: "1.0.0",       // 版本号
  description: "...",     // 描述
});
```

### `.registerTool(name, options)`

注册一个 Tool。

```typescript
builder.registerTool("search", {
  inputSchema: z.object({ query: z.string() }),
  outputSchema: z.object({ results: z.array(z.string()) }),
  description: "Search for items",
  handler: async ({ query }) => ({ results: [] }),
});
```

### `.registerSkills(skills)`

批量注册 Skills。

```typescript
builder.registerSkills({
  "my-skill": {
    url: "/skills/my-skill.md",
    frontmatter: {
      name: "My Skill",
      "allowed-tools": ["search"],
    },
  },
});
```

### `.build(options?)`

构建 Portal 实例，验证所有 Skills 依赖。

```typescript
const portal = builder.build({
  coerceXmlClientArgs: true, // 可选：兼容 XML MCP 客户端
});
```

## 高级功能：Blob 支持

使用 `defineTool` 和 `blob()` 处理二进制数据：

```typescript
import { defineTool, blob } from "@agent-web-portal/core";

const processImage = defineTool({
  name: "process-image",
  input: {
    image: blob({ mimeType: "image/png" }),
    options: z.object({ width: z.number() }),
  },
  output: {
    thumbnail: blob({ mimeType: "image/png" }),
    metadata: z.object({ size: z.number() }),
  },
  handler: async (args, context) => {
    // 通过 context.blobs.input.image 读取输入
    // 通过 context.blobs.output.thumbnail 写入输出
    return { metadata: { size: 1024 } };
  },
});
```

## 导出

### 主要导出

- `createAgentWebPortal` - 创建 Portal Builder
- `defineTool` - 定义带 Blob 支持的 Tool
- `blob` - 创建 Blob 字段 Schema

### 类型导出

- `AgentWebPortalInstance` - Portal 实例类型
- `ToolDefinition` - Tool 定义类型
- `SkillFrontmatter` - Skill Frontmatter 类型
- `BlobContext` - Blob 上下文类型

### 错误类型

- `ToolNotFoundError` - Tool 不存在
- `ToolValidationError` - Tool 验证失败
- `SkillValidationError` - Skill 验证失败
- `BlobContextError` - Blob 上下文错误

## License

MIT
