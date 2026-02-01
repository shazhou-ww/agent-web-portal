# SDK-001: Client SDK 文件操作辅助函数

> 优先级：P1 - 高优先级

## 背景

CAS 的不可变设计决定了所有"修改"都是创建新节点。删除、重命名、移动、复制等操作本质上是：

1. 读取旧 collection
2. 修改内存中的 children 映射
3. Commit 新 collection

这些操作不需要新增服务端 API，在 client SDK 层面实现即可。

## 需求

在 `cas-client-core` 中提供便捷的 collection 操作辅助函数。

## 设计问题

### 1. 嵌套路径支持

是否支持类似 `deleteEntry(root, "a/b/c.txt")` 的嵌套路径操作？

| 选项 | 说明 | 优点 | 缺点 |
|------|------|------|------|
| 只支持单层 | 只操作直接 children | 简单，职责清晰 | 嵌套需调用方递归 |
| 支持嵌套路径 | 自动递归处理中间节点 | 使用方便 | 实现复杂，多个 collection 需要更新 |

**待决定**：是否支持嵌套路径。

### 2. 批量操作

多个操作是否合并成一次 commit？

| 选项 | 说明 |
|------|------|
| 每个操作独立 | 简单，但多次 commit |
| 提供 batch API | 一次性应用多个修改 |
| Builder 模式 | 链式调用，最后一次性提交 |

**待决定**：批量操作模式。

### 3. Orphaned 追踪

操作后是否返回可能可 GC 的 key？

| 选项 | 说明 |
|------|------|
| 不追踪 | 简单，GC 自己处理 |
| 返回 orphaned 列表 | 调用方可感知，但可能无用 |

**待决定**：是否追踪 orphaned keys。

## 拟实现的操作

### 基础操作

| 函数 | 输入 | 输出 | 说明 |
|------|------|------|------|
| `updateCollection` | collectionKey, updater | newKey | 通用修改 |
| `deleteEntry` | collectionKey, name | newKey | 删除 entry |
| `renameEntry` | collectionKey, old, new | newKey | 重命名 |
| `copyEntry` | collectionKey, src, dst | newKey | 复制（同 key 新名） |
| `setEntry` | collectionKey, name, valueKey | newKey | 添加/覆盖 |

### 跨 Collection 操作

| 函数 | 输入 | 输出 | 说明 |
|------|------|------|------|
| `moveEntry` | srcKey, dstKey, name | { srcNew, dstNew } | 移动到另一个 collection |

## API 设计（草案）

```typescript
// 方案 A：CasClient 实例方法
const newRoot = await cas.deleteEntry(rootKey, "old-file.txt");
const newRoot2 = await cas.renameEntry(newRoot, "a.txt", "b.txt");

// 方案 B：独立函数
import { deleteEntry, renameEntry } from "@agent-web-portal/cas-client-core";
const newChildren = deleteEntry(collection.children, "old-file.txt");
const newKey = await cas.createCollection(newChildren);

// 方案 C：Builder 模式
const newRoot = await cas.mutate(rootKey)
  .delete("old-file.txt")
  .rename("a.txt", "b.txt")
  .set("new.txt", newFileKey)
  .commit();
```

**待决定**：API 风格。

## 验收标准

- [ ] 能便捷地删除 collection entry
- [ ] 能便捷地重命名 entry
- [ ] 能便捷地复制 entry（利用 CAS 去重）
- [ ] 能便捷地移动 entry（跨 collection）
- [ ] 操作后返回新的 root key
- [ ] 有单元测试覆盖

## 决策记录

| 日期 | 决策 | 原因 |
|------|------|------|
| - | - | - |
