# REFCOUNT-001: 引用计数统一方案

> 优先级：P0 - 必须完成
> 
> 本需求整合 [GC-001](./GC-001-garbage-collection.md) 和 [QUOTA-001](./QUOTA-001-quota-management.md)

## 背景

CAS 存储需要解决三个紧密关联的问题：

1. **用量统计**：精确追踪每个 realm 的存储使用量
2. **垃圾回收**：清理不再被引用的孤立节点
3. **配额管理**：限制用户存储使用量

这三个问题的核心都是**引用关系追踪**，因此采用统一的引用计数方案来解决。

## 设计决策

### 1. 大小定义

| 概念 | 定义 | 用途 |
|-----|------|-----|
| **逻辑大小 (logicalSize)** | 纯用户数据大小。Chunk = `data.length`，Collection/File = `sum(children.logicalSize)` | 用户视角："这个文件夹有多少内容" |
| **物理大小 (physicalSize)** | 节点完整字节数（header + children hashes + names + data） | 计费视角："实际占用多少存储" |

- 逻辑大小：重复文件重复计算（符合用户直觉）
- 物理大小：按 realm 去重（首次引用时计入）

### 2. 引用计数规则

只追踪**直接引用**，不递归：

| 引用源 | 引用目标 | 说明 |
|-------|---------|------|
| **Upload** | 节点自身 + children | 上传时建立引用 |
| **Commit** | root key | commit 直接引用其 root |
| **Collection/File** | children keys | 父节点直接引用子节点 |

### 3. 保护周期

- 新上传的节点有 **72 小时**保护期
- 保护期内即使 `count=0` 也不会被 GC 回收
- 保护期可通过环境变量 `GC_PROTECTION_HOURS` 配置

### 4. GC 策略

- **触发频率**：每小时运行一次（CloudWatch Events）
- **分批处理**：每批 100 个节点，每次最多 5000 个
- **递归清理**：当节点被删除时，递归减少其 children 的引用计数
- **物理删除**：当一个 key 在所有 realm 的引用都为 0 时，删除 S3 blob

### 5. Quota 双层控制

| 层级 | 检查时机 | 限制内容 | 超限行为 |
|-----|---------|---------|---------|
| **Ticket Quota** | Commit 时 | 单次提交的 root 节点 size | Hard Reject (403) |
| **Realm Quota** | Upload 时 | 累计物理存储 | Hard Reject (403) |

**为什么 Hard Reject**：Ticket 主要用于 Agent 工具调用，超限时工具需要感知并向 Agent 报错。

## 数据模型

### RefCount 表

```typescript
interface RefCount {
  pk: string;           // "ref#{realm}"
  sk: string;           // key (sha256:...)
  count: number;        // 直接引用次数
  physicalSize: number; // 节点完整字节数
  logicalSize: number;  // 仅 chunk = data.length，其他 = 0
  gcStatus: "active" | "pending";  // pending = count 为 0，待 GC
  createdAt: number;    // 首次创建时间（用于保护周期判断）
}
```

**GSI: by-gc-status**
- Partition Key: `gcStatus` ("pending")
- Sort Key: `createdAt`
- 稀疏索引：只有 `gcStatus="pending"` 的记录被索引

### RealmUsage 表

```typescript
interface RealmUsage {
  pk: string;           // "usage#{realm}"
  sk: string;           // "SUMMARY"
  physicalBytes: number; // 物理存储总量（去重）
  logicalBytes: number;  // 逻辑存储总量（chunk data 去重）
  nodeCount: number;     // 节点数（去重）
  quotaLimit: number;    // 配额限制 (bytes)，0 = 无限制
  updatedAt: number;
}
```

## 核心流程

### Upload 流程

```typescript
async function uploadNode(realm: string, nodeBytes: Uint8Array, children: string[]) {
  const key = computeHash(nodeBytes);
  const physicalSize = nodeBytes.length;
  const logicalSize = isChunk(nodeBytes) ? getDataSize(nodeBytes) : 0;
  
  // 1. 检查 Realm Quota
  const usage = await getRealmUsage(realm);
  const willAdd = await estimateNewPhysicalSize(realm, key, physicalSize, children);
  if (usage.quotaLimit > 0 && usage.physicalBytes + willAdd > usage.quotaLimit) {
    throw new QuotaExceededError("REALM_QUOTA_EXCEEDED");
  }
  
  // 2. 存储到 S3
  await storage.put(key, nodeBytes);
  
  // 3. 增加自身引用
  const { isNewToRealm } = await refCountDb.incrementRef(realm, key, physicalSize, logicalSize);
  
  // 4. 增加 children 引用
  for (const childKey of children) {
    await refCountDb.incrementRef(realm, childKey, ...);
  }
  
  // 5. 更新 RealmUsage（如果是新节点）
  if (isNewToRealm) {
    await updateRealmUsage(realm, { 
      physicalBytes: +physicalSize, 
      logicalBytes: +logicalSize,
      nodeCount: +1 
    });
  }
}
```

### Commit 流程

```typescript
async function createCommit(realm: string, rootKey: string, ticket?: Ticket) {
  // 1. 检查 Ticket Quota
  if (ticket?.commit?.quota) {
    const rootNode = await getNode(rootKey);
    if (rootNode.size > ticket.commit.quota) {
      throw new QuotaExceededError("TICKET_QUOTA_EXCEEDED");
    }
  }
  
  // 2. 增加 root 引用
  await refCountDb.incrementRef(realm, rootKey, ...);
  
  // 3. 创建 commit 记录
  await commitDb.createCommit(realm, rootKey, ...);
}
```

### Delete Commit 流程

```typescript
async function deleteCommit(realm: string, commitId: string) {
  const commit = await commitDb.getCommit(realm, commitId);
  
  // 1. 减少 root 引用（不递归，由 GC 处理 children）
  await refCountDb.decrementRef(realm, commit.root);
  
  // 2. 删除 commit 记录
  await commitDb.deleteCommit(realm, commitId);
}
```

### GC 流程

```typescript
async function runGC() {
  const BATCH_SIZE = 100;
  const MAX_BATCHES = 50;
  const PROTECTION_PERIOD = 72 * 3600 * 1000; // 72 hours
  const threshold = Date.now() - PROTECTION_PERIOD;
  
  let lastKey: string | undefined;
  
  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    // 1. 查询待回收节点（使用 GSI 分页）
    const { items, nextKey } = await refCountDb.listPendingGC({
      beforeTime: threshold,
      limit: BATCH_SIZE,
      startKey: lastKey,
    });
    
    if (items.length === 0) break;
    
    for (const item of items) {
      // 2. 读取节点获取 children
      const nodeBytes = await storage.get(item.sk);
      const children = parseChildren(nodeBytes);
      
      // 3. 递归减少 children 引用
      for (const childKey of children) {
        await refCountDb.decrementRef(item.realm, childKey);
      }
      
      // 4. 更新 RealmUsage
      await updateRealmUsage(item.realm, {
        physicalBytes: -item.physicalSize,
        logicalBytes: -item.logicalSize,
        nodeCount: -1,
      });
      
      // 5. 删除 RefCount 记录
      await refCountDb.delete(item.pk, item.sk);
      
      // 6. 检查是否可以删除 S3 blob（所有 realm 都无引用）
      const globalRefs = await refCountDb.countGlobalRefs(item.sk);
      if (globalRefs === 0) {
        await storage.delete(item.sk);
      }
    }
    
    lastKey = nextKey;
    if (!nextKey) break;
  }
}
```

## 错误响应

```typescript
enum QuotaErrorCode {
  TICKET_QUOTA_EXCEEDED = "TICKET_QUOTA_EXCEEDED",
  REALM_QUOTA_EXCEEDED = "REALM_QUOTA_EXCEEDED",
}

interface QuotaErrorResponse {
  error: QuotaErrorCode;
  message: string;
  details: {
    limit: number;      // 配额限制
    used?: number;      // 已使用（仅 Realm）
    requested: number;  // 本次请求
  };
}

// 示例响应
// Ticket Quota 超限
{
  "error": "TICKET_QUOTA_EXCEEDED",
  "message": "Commit size exceeds ticket quota",
  "details": { "limit": 10485760, "requested": 15728640 }
}

// Realm Quota 超限
{
  "error": "REALM_QUOTA_EXCEEDED", 
  "message": "Upload would exceed realm storage quota",
  "details": { "limit": 1073741824, "used": 1000000000, "requested": 100000000 }
}
```

## API 设计

### 用量查询

```
GET /realms/@me/usage

Response:
{
  "physicalBytes": 1073741824,
  "logicalBytes": 1342177280,
  "nodeCount": 1234,
  "quotaLimit": 10737418240
}
```

### 管理员配额设置

```
PUT /admin/realms/{realm}/quota

Body:
{
  "quotaLimit": 10737418240
}
```

### GC 状态（内部）

```
GET /admin/gc/status

Response:
{
  "lastRunAt": "2026-02-01T00:00:00Z",
  "nodesProcessed": 5000,
  "bytesReclaimed": 1073741824
}
```

## 配置项

| 环境变量 | 默认值 | 说明 |
|---------|-------|------|
| `GC_PROTECTION_HOURS` | 72 | 新节点保护周期（小时） |
| `GC_BATCH_SIZE` | 100 | 每批处理节点数 |
| `GC_MAX_BATCHES` | 50 | 每次 GC 最大批次数 |
| `DEFAULT_QUOTA_BYTES` | 0 | 默认配额（0 = 无限制） |

## DynamoDB 表定义

```yaml
CasRefCountTable:
  Type: AWS::DynamoDB::Table
  Properties:
    TableName: !Sub "${AWS::StackName}-refcount"
    AttributeDefinitions:
      - { AttributeName: pk, AttributeType: S }
      - { AttributeName: sk, AttributeType: S }
      - { AttributeName: gcStatus, AttributeType: S }
      - { AttributeName: createdAt, AttributeType: N }
    KeySchema:
      - { AttributeName: pk, KeyType: HASH }
      - { AttributeName: sk, KeyType: RANGE }
    GlobalSecondaryIndexes:
      - IndexName: by-gc-status
        KeySchema:
          - { AttributeName: gcStatus, KeyType: HASH }
          - { AttributeName: createdAt, KeyType: RANGE }
        Projection: { ProjectionType: ALL }
    BillingMode: PAY_PER_REQUEST

CasUsageTable:
  Type: AWS::DynamoDB::Table
  Properties:
    TableName: !Sub "${AWS::StackName}-usage"
    AttributeDefinitions:
      - { AttributeName: pk, AttributeType: S }
      - { AttributeName: sk, AttributeType: S }
    KeySchema:
      - { AttributeName: pk, KeyType: HASH }
      - { AttributeName: sk, KeyType: RANGE }
    BillingMode: PAY_PER_REQUEST
```

## 验收标准

### 引用计数
- [ ] Upload 时正确建立引用（自身 + children）
- [ ] Commit 时增加 root 引用
- [ ] Delete commit 时减少 root 引用
- [ ] 引用计数原子更新

### 用量统计
- [ ] 能查询 realm 的 physicalBytes/logicalBytes/nodeCount
- [ ] 新节点（isNewToRealm）正确增加用量
- [ ] GC 删除节点后正确减少用量

### GC
- [ ] 保护周期内的节点不被回收
- [ ] 分批处理，不超时
- [ ] 递归清理 children 引用
- [ ] 全局引用为 0 时删除 S3 blob
- [ ] 有 GC 执行日志

### Quota
- [ ] Upload 时检查 Realm Quota
- [ ] Commit 时检查 Ticket Quota
- [ ] 超限返回明确错误信息
- [ ] 管理员能设置用户配额

## 决策记录

| 日期 | 决策 | 原因 |
|------|------|------|
| 2026-02-01 | 逻辑大小只统计 chunk 的 data 段 | 概念更简单，用户易理解 |
| 2026-02-01 | 引用计数只追踪直接引用 | 避免 commit 时遍历整个 DAG |
| 2026-02-01 | 72 小时保护周期 | 给用户足够时间完成上传 |
| 2026-02-01 | 每小时 GC，分批处理 | 平衡及时性和系统负载 |
| 2026-02-01 | Quota 超限 Hard Reject | Ticket 用于工具调用，需明确错误 |
| 2026-02-01 | 不做跨 realm 存储成本共享 | 简化设计，GC 只需检查全局引用 |
