# API-001: CAS API 路由重构

> 优先级：P1 - 高优先级
> 依赖：`@agent-web-portal/cas-core` 包完成后实施

## 背景

随着 CAS 存储设计的演进，需要重构 API 路由以匹配新的节点模型：
- 统一 binary 格式（32 字节 header + 变长 body）
- 自相似 B-Tree 结构存储大文件
- S3 存储构成完备的自包含文件系统

## 变更清单

### 1. 路由重命名

| 当前路由 | 新路由 | 说明 |
|----------|--------|------|
| `PUT /chunk/:key` | `PUT /chunks/:key` | 复数形式统一 |
| `GET /raw/:key` | `GET /chunks/:key` | 统一为 chunks 端点 |
| `DELETE /auth/ticket/:id` | `DELETE /auth/tickets/:id` | 复数形式统一（可选）|

### 2. 节点类型简化

| 当前类型 | 新类型 | 说明 |
|----------|--------|------|
| `"chunk"` | `"chunk"` | 保留 |
| `"inline-file"` | 删除 | 合并到 chunk |
| `"file"` | 删除 | 合并到 chunk（B-Tree 结构）|
| `"collection"` | `"collection"` | 保留 |

**新 NodeKind**: `"chunk" | "collection"`

### 3. Content-Type 简化

| 当前 | 新 | 说明 |
|------|-----|------|
| `application/octet-stream` | `application/vnd.cas.chunk` | Chunk 节点 |
| `application/vnd.cas.inline-file` | 删除 | 合并到 chunk |
| `application/vnd.cas.file` | 删除 | 合并到 chunk |
| `application/vnd.cas.collection` | `application/vnd.cas.collection` | 保留 |

### 4. `/tree/:key` 响应变更

**移除 `next` 字段**：分页由客户端决定，服务端只返回 BFS 展开的节点（最多 1000 个）。

客户端流程：
1. 调用 `GET /tree/:key` 获取根节点及其后代（最多 1000 个）
2. 对比本地缓存，找出需要进一步展开的 collection
3. 对每个需要展开的 collection 再调用 `GET /tree/:key`

**响应格式**：
```typescript
interface TreeResponse {
  nodes: Record<string, TreeNodeInfo>;
  // 移除 next 字段
}

interface TreeNodeInfo {
  kind: "chunk" | "collection";
  size: number;
  contentType?: string;      // chunk 的原始文件类型
  children?: string[];       // 子节点 keys（collection 和 B-Tree chunk）
  childNames?: string[];     // 子节点名称（仅 collection）
}
```

### 5. Commit 接口变更

**待决定**：commit 接口是否需要简化？

当前 commit 接口：
```typescript
POST /commit
{
  root: string,
  title?: string,
  files?: Record<key, { chunks: string[], contentType: string, size: number }>,
  collections?: Record<key, { children: Record<string, string>, size: number }>
}
```

**问题**：
- 新的 B-Tree chunk 结构由客户端构建并上传，服务端不再需要 `files.chunks` 列表
- 单 chunk 文件直接作为 chunk 上传，collection 直接引用 chunk key
- 服务端只需要验证 root 及其依赖的 keys 都存在

**选项 A**：保留 files 参数用于元数据记录
```typescript
{
  root: string,
  title?: string,
  files?: Record<key, { contentType: string, size: number }>,  // 移除 chunks
  collections?: Record<key, { children: Record<string, string>, size: number }>
}
```

**选项 B**：完全依赖 S3 节点自包含
```typescript
{
  root: string,
  title?: string,
  // 服务端从 S3 节点读取所有元数据
}
```

### 6. Quota 检查增强

在 `handleCommit` 中添加 quota 检查：
- 计算新增节点的总字节数
- 检查是否超过 ticket 的 quota 限制
- 当前只在 `PUT /chunks/:key` 检查，需要在 commit 时也检查

## 实施顺序

1. ✅ 完成 `@agent-web-portal/cas-core` 包
2. 更新 `casfa/backend` 使用 cas-core
3. 更新路由命名（chunks）
4. 简化节点类型和 Content-Type
5. 更新 `/tree` 响应格式
6. 更新 commit 接口
7. 添加 quota 检查
8. 更新 `cas-client-core` 匹配新 API
9. 更新 `awp-server-core` 匹配新 API

## 待决定

| 问题 | 选项 | 状态 |
|------|------|------|
| Commit 接口是否保留 files 参数 | A: 保留元数据 / B: 完全自包含 | 待定 |
| 是否需要迁移工具 | 旧格式节点兼容 | 待定 |
| S3 Content-Type 头 | 是否使用 `application/vnd.cas.chunk` | 待定 |

## 验收标准

- [ ] 所有路由使用新命名
- [ ] NodeKind 简化为 chunk/collection
- [ ] `/tree` 不再返回 `next` 字段
- [ ] Commit 时进行 quota 检查
- [ ] 所有现有测试通过
- [ ] Client SDK 匹配新 API

## 相关文档

- [CAS Binary Format](../../packages/cas-core/README.md)
- [GC-001: 垃圾回收机制](./GC-001-garbage-collection.md)
- [QUOTA-001: 配额管理](./QUOTA-001-quota-management.md)
