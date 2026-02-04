# CASFA v2 - Content-Addressable Storage for Agents

CASFA v2 是一个为 AI Agent 设计的内容寻址存储服务，基于 Hono 框架重写，提供更清晰的 API 设计和更好的可维护性。

## 功能特性

- 🔐 **多种认证方式**: Cognito JWT、Agent Token、Ticket
- 📦 **内容寻址存储**: 基于 BLAKE3 哈希的 CAS 系统
- 🏠 **Realm 隔离**: 每个用户拥有独立的存储空间
- 🎫 **Ticket 系统**: 细粒度的临时访问控制
- 📁 **Depot 管理**: 类似 Git 的版本化数据存储
- 🔄 **多种存储后端**: 支持 S3、文件系统、内存存储

## 快速开始

### 1. 环境准备

确保已安装：
- [Bun](https://bun.sh/) >= 1.0
- [Docker](https://www.docker.com/) (用于 DynamoDB Local)

### 2. 启动开发环境

```bash
# 从仓库根目录
cd apps/casfa-v2

# 一键设置开发环境（启动 DynamoDB、创建表、配置 .env）
bun run dev:setup

# 或者手动设置：
# 1. 启动 DynamoDB Local（从仓库根目录）
docker compose up -d dynamodb

# 2. 创建 DynamoDB 表
bun run db:create

# 3. 复制配置文件
cp .env.example .env
```

### 3. 启动开发服务器

```bash
bun run dev
```

服务器将在 `http://localhost:8801` 启动。

### 4. 验证服务

```bash
curl http://localhost:8801/health
# 返回: {"status":"healthy"}
```

## 端口分配

本项目遵循 monorepo 统一端口约定（详见根目录 `.env.example`）：

| 类型 | 端口范围 | 本项目 |
|------|----------|--------|
| 数据库 | 87xx | DynamoDB: 8700 |
| 后端 API | 88xx | CASFA v2: **8801** |
| 前端 | 89xx | (无前端) |

## 开发命令

```bash
# 开发
bun run dev          # 启动开发服务器
bun run dev:setup    # 一键设置开发环境

# 测试
bun test             # 运行所有测试
bun run test:e2e     # 运行 E2E 测试（自动管理 DynamoDB 表）

# 数据库
bun run db:create    # 创建本地 DynamoDB 表
bun run db:delete    # 删除本地 DynamoDB 表

# 构建
bun run build        # 构建 Lambda 部署包
bun run sam:build    # SAM 构建
bun run sam:deploy   # 部署到 AWS

# 代码质量
bun run check        # TypeScript 类型检查 + Biome lint
bun run lint:fix     # 自动修复 lint 问题
```

## 项目结构

```
apps/casfa-v2/
├── .env.example          # 环境变量模板
├── package.json
├── tsconfig.json
└── backend/
    ├── server.ts         # 本地开发服务器入口
    ├── e2e/              # E2E 测试
    │   ├── setup.ts      # 测试配置和辅助函数
    │   ├── admin.test.ts
    │   ├── auth.test.ts
    │   ├── depots.test.ts
    │   ├── nodes.test.ts
    │   ├── realm.test.ts
    │   └── tickets.test.ts
    ├── scripts/
    │   ├── build.ts              # 跨平台构建脚本
    │   ├── create-local-tables.ts # DynamoDB 表管理
    │   ├── dev-setup.ts          # 开发环境设置
    │   └── integration-test.ts   # E2E 测试运行器
    └── src/
        ├── app.ts            # Hono 应用工厂
        ├── bootstrap.ts      # 依赖初始化
        ├── config.ts         # 配置加载
        ├── handler.ts        # Lambda 入口
        ├── router.ts         # API 路由定义
        ├── types.ts          # 类型定义
        ├── auth/             # 认证相关
        ├── controllers/      # 请求处理器
        ├── db/               # DynamoDB 数据访问层
        ├── middleware/       # Hono 中间件
        └── schemas/          # Zod 验证模式
```

## 环境变量

主要配置从根目录 `.env` 继承，项目级 `.env` 可覆盖：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT_CASFA_V2_API` | 8801 | API 服务端口 |
| `DYNAMODB_ENDPOINT` | http://localhost:8700 | DynamoDB 端点 |
| `STORAGE_TYPE` | memory | 存储类型: memory/fs/s3 |
| `MOCK_JWT_SECRET` | - | 本地测试用 Mock JWT 密钥 |
| `COGNITO_USER_POOL_ID` | - | 生产环境 Cognito 配置 |

完整配置见 [.env.example](.env.example)。

## API 概览

### 认证

- `POST /api/auth/login` - 用户登录
- `POST /api/auth/tokens` - 创建 Agent Token
- `GET /api/auth/tokens` - 列出用户的 Token
- `DELETE /api/auth/tokens/:id` - 撤销 Token

### Realm

- `GET /api/realm/:realmId` - 获取 Realm 信息
- `GET /api/realm/:realmId/usage` - 获取使用统计

### Depot

- `GET /api/realm/:realmId/depots` - 列出 Depot
- `POST /api/realm/:realmId/depots` - 创建 Depot
- `GET /api/realm/:realmId/depots/:depotId` - 获取 Depot 详情
- `PATCH /api/realm/:realmId/depots/:depotId` - 更新 Depot
- `DELETE /api/realm/:realmId/depots/:depotId` - 删除 Depot
- `POST /api/realm/:realmId/depots/:depotId/commit` - 提交新版本

### Ticket

- `POST /api/realm/:realmId/tickets` - 创建 Ticket
- `GET /api/realm/:realmId/tickets` - 列出 Ticket
- `GET /api/realm/:realmId/tickets/:ticketId` - 获取 Ticket 详情
- `POST /api/realm/:realmId/tickets/:ticketId/commit` - 提交 Ticket 结果
- `POST /api/realm/:realmId/tickets/:ticketId/revoke` - 撤销 Ticket

### Node

- `POST /api/realm/:realmId/prepare-nodes` - 准备上传节点
- `PUT /api/realm/:realmId/nodes/:key` - 上传节点
- `GET /api/realm/:realmId/nodes/:key` - 获取节点内容
- `GET /api/realm/:realmId/nodes/:key/metadata` - 获取节点元数据

### 管理

- `GET /api/admin/users` - 列出所有用户（需要 Admin 权限）
- `PATCH /api/admin/users/:userId` - 更新用户角色

## 测试

E2E 测试需要 DynamoDB Local 运行：

```bash
# 确保 DynamoDB 正在运行
docker compose up -d dynamodb

# 运行测试
bun test
```

测试会自动：
1. 等待 DynamoDB 就绪
2. 创建测试所需的表
3. 在每个测试后清理数据

## 部署

### AWS SAM

```bash
# 构建
bun run sam:build

# 部署
bun run sam:deploy
```

### 手动部署

```bash
# 构建 Lambda 包
bun run build

# 输出: backend/dist/handler.mjs
```

## 相关文档

- [CASFA 技术原理](../../docs/CAS_TECHNICAL_PRINCIPLES.md)
- [CAS 二进制格式](../../docs/CAS_BINARY_FORMAT.md)
- [CASFA API 文档](../../docs/casfa-api/)
