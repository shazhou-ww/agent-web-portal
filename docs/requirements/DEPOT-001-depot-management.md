# DEPOT-001: Depot 管理

## 概述

Depot 是 Realm 中的持久化树结构，用于组织和管理用户的文件系统。与 Commit（流式收件箱）不同，Depot 提供完整的历史记录和稳定的访问入口。

## 背景

### 信息架构双层设计

| 维度 | Depot（树） | Commit（流） |
|------|------------|-------------|
| 结构 | 持久化树，有历史 | 临时收件箱 |
| 生命周期 | 永久保留 | 按留存天数自动清理 |
| 入口 | 固定名称（如 main） | 动态 ticketId |
| 用途 | 长期存储、版本管理 | 临时上传、Agent 提交 |
| 历史 | 完整保留所有版本 | 无历史（覆盖） |

### 核心概念

- **Depot**: 命名的持久化树，每个 Realm 可以有多个 Depot
- **main Depot**: 默认 Depot，在 Realm 首次访问时自动创建，不可删除
- **Depot History**: 每次更新 Depot 时自动保存历史版本
- **Empty Collection**: 空集合，所有新建 Depot 的初始 root

## 数据模型

### Depot 记录

存储在 `CasRealmTable` 中，与现有 Realm 数据共存：

```typescript
interface DepotRecord {
  // DynamoDB Keys
  pk: `realm#${realmId}`;
  sk: `depot#${depotId}`;
  
  // Depot 信息
  depotId: string;        // 系统生成的 UUID
  name: string;           // 用户可读名称（如 "main"）
  root: string;           // 当前 root 的 CAS key
  
  // 元数据
  createdAt: string;      // ISO 8601 创建时间
  updatedAt: string;      // ISO 8601 最后更新时间
  
  // 可选
  description?: string;   // 描述
}
```

### Depot History 记录

同样存储在 `CasRealmTable` 中：

```typescript
interface DepotHistoryRecord {
  // DynamoDB Keys
  pk: `realm#${realmId}`;
  sk: `depot-history#${depotId}#${version}`;
  
  // 历史信息
  depotId: string;
  version: number;        // 递增版本号
  root: string;           // 该版本的 root
  
  // 元数据
  createdAt: string;      // 该版本创建时间
  message?: string;       // 提交消息（可选）
}
```

### 索引设计

使用 `CasRealmTable` 的 GSI `by-type`：

```
GSI: by-type
  PK: realm#${realmId}
  SK: depot#${depotId} 或 depot-history#${depotId}#${version}
```

按 SK 前缀查询可以：

- 列出所有 Depot: `sk BEGINS_WITH "depot#"`
- 列出某 Depot 的历史: `sk BEGINS_WITH "depot-history#${depotId}#"`

## Well-Known Keys

### Empty Collection

空集合是一个特殊的 CAS 节点，作为所有新 Depot 的初始 root：

```typescript
// 空集合的结构（32 字节 header，无 children）
const EMPTY_COLLECTION_BYTES = new Uint8Array([
  // Magic: 0x01534143 (little-endian)
  0x43, 0x41, 0x53, 0x01,
  // Flags: HAS_NAMES (0x01)
  0x01, 0x00, 0x00, 0x00,
  // Count: 0
  0x00, 0x00, 0x00, 0x00,
  // Size: 0
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  // Names Offset: 32 (header size)
  0x20, 0x00, 0x00, 0x00,
  // Type Offset: 0 (unused for empty)
  0x00, 0x00, 0x00, 0x00,
  // Data Offset: 0 (unused for empty)
  0x00, 0x00, 0x00, 0x00,
]);

// SHA-256 hash（需计算）
const EMPTY_COLLECTION_KEY = "sha256:...";
```

## API 设计

### 1. 列出 Depots

```
GET /realms/{realmId}/depots
```

Response:

```json
{
  "depots": [
    {
      "depotId": "uuid",
      "name": "main",
      "root": "sha256:...",
      "createdAt": "2025-01-01T00:00:00Z",
      "updatedAt": "2025-01-01T00:00:00Z"
    }
  ]
}
```

### 2. 创建 Depot

```
POST /realms/{realmId}/depots
Content-Type: application/json

{
  "name": "backup",
  "description": "Backup depot"
}
```

Response:

```json
{
  "depotId": "uuid",
  "name": "backup",
  "root": "sha256:...",  // Empty collection
  "createdAt": "2025-01-01T00:00:00Z",
  "updatedAt": "2025-01-01T00:00:00Z"
}
```

### 3. 获取 Depot

```
GET /realms/{realmId}/depots/{depotId}
```

Response: 同创建响应

### 4. 更新 Depot Root

```
PUT /realms/{realmId}/depots/{depotId}
Content-Type: application/json

{
  "root": "sha256:...",
  "message": "Update message"  // 可选，记录在历史中
}
```

行为：

1. 验证新 root 存在且已提交
2. 对旧 root 执行 decrementRef
3. 对新 root 执行 incrementRef
4. 创建历史记录
5. 更新 Depot 记录

### 5. 删除 Depot

```
DELETE /realms/{realmId}/depots/{depotId}
```

限制：

- main Depot 不可删除（返回 403）
- 删除时对 root 执行 decrementRef
- 历史记录保留（可选：设置过期时间自动清理）

### 6. 获取 Depot 历史

```
GET /realms/{realmId}/depots/{depotId}/history?limit=20&cursor=xxx
```

Response:

```json
{
  "history": [
    {
      "version": 5,
      "root": "sha256:...",
      "createdAt": "2025-01-01T00:00:00Z",
      "message": "Update message"
    }
  ],
  "cursor": "next-page-token"
}
```

### 7. 回滚到历史版本

```
POST /realms/{realmId}/depots/{depotId}/rollback
Content-Type: application/json

{
  "version": 3
}
```

行为：

1. 查找指定版本的历史记录
2. 将该版本的 root 设置为当前 root
3. 创建新的历史记录（指向相同 root）

## 引用计数集成

### Depot Root 引用

Depot 的 root 会被引用计数追踪：

```typescript
// 创建 Depot 时
await refCountDb.incrementRef(realmId, emptyCollectionKey, []);

// 更新 Depot root 时
await refCountDb.decrementRef(realmId, oldRoot);
await refCountDb.incrementRef(realmId, newRoot, getChildren(newRoot));

// 删除 Depot 时
await refCountDb.decrementRef(realmId, currentRoot);
```

### 与 Commit 的关系

Depot 和 Commit 的引用是独立的：

- 同一个 CAS key 可以同时被 Depot 和 Commit 引用
- 只有当所有引用（包括 Depot 和 Commit）都释放后，GC 才会清理节点

## Main Depot 自动创建

### 触发时机

当用户首次访问 Realm 时（任何需要 Realm 存在的操作），如果 main Depot 不存在：

```typescript
async function ensureMainDepot(realmId: string): Promise<DepotRecord> {
  const mainDepot = await depotDb.getByName(realmId, "main");
  if (mainDepot) return mainDepot;
  
  // 确保 empty collection 存在
  await ensureEmptyCollection();
  
  // 创建 main depot
  return await depotDb.create(realmId, {
    name: "main",
    root: EMPTY_COLLECTION_KEY,
    description: "Default depot"
  });
}
```

### Empty Collection 持久化

Empty Collection 需要在系统级别存在：

```typescript
async function ensureEmptyCollection(): Promise<void> {
  const exists = await storage.exists(EMPTY_COLLECTION_KEY);
  if (!exists) {
    await storage.put(EMPTY_COLLECTION_KEY, EMPTY_COLLECTION_BYTES);
  }
  
  // 使用特殊的全局引用确保不被 GC
  await refCountDb.incrementRef("__system__", EMPTY_COLLECTION_KEY, []);
}
```

## SDK 更新

### CasfaSession 扩展

```typescript
interface CasfaSession {
  // 现有方法
  commit(): Promise<CommitResult>;
  getCommit(ticketId: string): Promise<Collection>;
  
  // 新增 Depot 方法
  listDepots(): Promise<Depot[]>;
  getDepot(depotId: string): Promise<Depot>;
  createDepot(name: string, options?: DepotOptions): Promise<Depot>;
  updateDepot(depotId: string, root: string, message?: string): Promise<Depot>;
  deleteDepot(depotId: string): Promise<void>;
  getDepotHistory(depotId: string, options?: PaginationOptions): Promise<DepotHistory[]>;
  rollbackDepot(depotId: string, version: number): Promise<Depot>;
  
  // 便捷方法
  getMainDepot(): Promise<Depot>;
}
```

### Depot 类型定义

```typescript
interface Depot {
  depotId: string;
  name: string;
  root: string;
  createdAt: Date;
  updatedAt: Date;
  description?: string;
  
  // 便捷方法
  getRoot(): Promise<Collection>;
  update(root: string, message?: string): Promise<Depot>;
  getHistory(options?: PaginationOptions): Promise<DepotHistory[]>;
  rollback(version: number): Promise<Depot>;
}

interface DepotHistory {
  version: number;
  root: string;
  createdAt: Date;
  message?: string;
}

interface DepotOptions {
  description?: string;
}
```

## 实现计划

### Phase 1: 基础设施

1. 计算并定义 `EMPTY_COLLECTION_KEY` 常量
2. 创建 `DepotDb` 类
3. 添加 `ensureEmptyCollection()` 函数

### Phase 2: API 实现

1. 实现 Depot CRUD 路由
2. 实现历史记录查询
3. 实现回滚功能
4. 集成引用计数

### Phase 3: SDK 更新

1. 更新 `casfa-client-core` 添加 Depot 方法
2. 更新 `casfa-client-browser` 和 `casfa-client-nodejs`
3. 添加类型定义

### Phase 4: 前端集成

1. 更新 UI 显示 Depot 列表
2. 添加 Depot 管理界面
3. 添加历史记录浏览

## 安全考虑

1. **权限控制**: Depot 操作遵循现有 Realm 权限模型
2. **main 保护**: main Depot 不可删除，防止误操作
3. **历史不可变**: 历史记录创建后不可修改
4. **引用完整性**: 所有 root 更新都通过引用计数保护

## 测试计划

1. **单元测试**
   - DepotDb CRUD 操作
   - 历史记录创建和查询
   - 引用计数集成

2. **集成测试**
   - Main Depot 自动创建
   - Depot 更新和回滚流程
   - GC 不会删除 Depot 引用的节点

3. **端到端测试**
   - SDK Depot 操作
   - 前端 Depot 管理

## 相关文档

- [REFCOUNT-001: 引用计数系统](./REFCOUNT-001-reference-counting.md)
- [GC-001: 垃圾回收](./GC-001-garbage-collection.md)
- [QUOTA-001: 配额管理](./QUOTA-001-quota-management.md)
