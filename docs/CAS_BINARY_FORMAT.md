# Content Addressed Storage (CAS) Binary Format Specification

> 版本: 2.0  
> 基于: `packages/cas-core` 实现  
> 日期: 2026-02-03

---

## 目录

1. [术语表](#1-术语表)
2. [整体介绍](#2-整体介绍)
3. [Merkle Tree 逻辑结构](#3-merkle-tree-逻辑结构)
4. [节点二进制协议](#4-节点二进制协议)
5. [大文件拆分逻辑](#5-大文件拆分逻辑)
6. [实现约束参数](#6-实现约束参数)
7. [验证规则](#7-验证规则)
8. [Well-Known Keys](#8-well-known-keys)

---

## 1. 术语表

| 术语 | 定义 |
|------|------|
| **CAS** | Content Addressed Storage，内容寻址存储。数据的地址由其内容的哈希值决定 |
| **CAS Key** | 数据的唯一标识符，格式为 `sha256:<64位十六进制>`，例如 `sha256:04821167d026fa3b24e160b8f9f0ff2a342ca1f96c78c24b23e6a086b71e2391` |
| **Node** | CAS 中的基本存储单元，一个二进制块，包含 Header 和 Body |
| **d-node** | Dict Node（目录节点），存储有序的子节点名称和引用 |
| **s-node** | Successor Node（续块节点），文件 B-Tree 的内部节点 |
| **f-node** | File Node（文件节点），文件 B-Tree 的根节点，包含 Content-Type |
| **Merkle Tree** | 一种哈希树结构，每个非叶节点的哈希值由其子节点哈希值计算得出 |
| **B-Tree** | 大文件拆分使用的平衡树结构，每个节点既存数据也存子节点引用 |
| **Pascal String** | 以 u16 LE 长度前缀编码的 UTF-8 字符串 |
| **Content-Type** | MIME 类型字符串，描述文件内容类型（如 `application/json`） |
| **Content-Type Slot** | 固定大小的 Content-Type 存储槽（0/16/32/64 字节） |
| **Logical Size** | 节点的逻辑大小：文件节点为原始文件字节数，目录节点为所有子节点逻辑大小之和 |
| **Node Limit** | 单个节点的最大字节数限制（默认 1 MB） |
| **Hash Provider** | 提供 SHA-256 哈希计算的抽象接口 |
| **Storage Provider** | 提供节点存取的抽象接口（S3、HTTP、内存等） |

---

## 2. 整体介绍

### 2.1 什么是 Content Addressed Storage

Content Addressed Storage（内容寻址存储）是一种数据存储范式，其核心思想是：

> **数据的地址由其内容决定，而非由存储位置决定。**

在传统存储系统中，数据通过路径（如 `/home/user/file.txt`）或 ID（如数据库主键）定位。这种方式存在问题：

- 同一数据存储多次会占用多倍空间
- 数据被篡改后，标识符不变，无法检测
- 引用其他数据需要依赖外部系统维护一致性

CAS 使用**加密哈希函数**（本规范使用 SHA-256）计算数据的唯一标识符：

```
Key = "sha256:" + hex(SHA-256(data))
```

这带来了关键特性：

| 特性 | 说明 |
|------|------|
| **不可变性** | 一旦存储，数据永不改变。修改数据会产生新的 Key |
| **去重** | 相同内容自动共享同一存储位置 |
| **完整性验证** | 读取数据时可重新计算哈希验证正确性 |
| **分布式友好** | 无中心化命名空间，任何节点可独立生成 Key |

### 2.2 解决什么问题

CAS 特别适用于以下场景：

1. **版本控制系统**：Git 就是基于 CAS 的典型实现
2. **内容分发网络**：相同内容只需存储和传输一次
3. **不可变数据存储**：审计日志、区块链数据
4. **大文件存储**：通过 Merkle Tree 实现增量同步和并行传输

### 2.3 数据模型的自洽性

本规范的核心设计原则是**数据自解释**（Self-Describing Data）：

> **一个 CAS 节点包含理解其内容所需的全部信息，无需外部元数据。**

这意味着：

1. **Content-Type 内嵌**：文件节点（f-node）内嵌 MIME 类型，读取者无需查询外部数据库
2. **结构信息内嵌**：目录节点（d-node）包含子节点名称，无需外部索引
3. **大小信息内嵌**：每个节点包含其逻辑大小，无需遍历计算
4. **哈希即验证**：Key 本身就是数据完整性的证明

这种自洽性使得：
- 任何节点可以独立验证，无需访问其他数据
- 数据可以在任意存储系统间迁移，只需复制字节
- 客户端可以离线验证数据完整性

---

## 3. Merkle Tree 逻辑结构

### 3.1 节点类型概述

CAS 定义三种节点类型，通过 flags 字段的低 2 位区分：

| 类型 | 二进制值 | 十进制 | 用途 |
|------|----------|--------|------|
| **d-node** (Dict) | `0b01` | 1 | 目录，包含有序的命名子节点 |
| **s-node** (Successor) | `0b10` | 2 | 文件续块，B-Tree 内部节点 |
| **f-node** (File) | `0b11` | 3 | 文件顶层节点，包含 Content-Type |

**位含义**：
- Bit 0: 有字符串段（d-node 的名称列表，f-node 的 Content-Type）
- Bit 1: 有数据段（s-node 和 f-node 存储原始数据）

### 3.2 目录结构（d-node）

d-node 表示一个目录，包含零个或多个命名子节点：

```
        ┌─────────────────────────────────┐
        │         d-node (Dict)           │
        │   size = 1500 (总逻辑大小)       │
        └─────────────┬───────────────────┘
                      │
      ┌───────────────┼───────────────┐
      │               │               │
      ▼               ▼               ▼
 "config.json"   "readme.md"    "src/" 
      │               │               │
      ▼               ▼               ▼
  f-node          f-node         d-node
  size=256        size=512       size=732
```

**关键规则**：
1. 子节点按**UTF-8 字节序**升序排列（lexicographic byte order）
2. 不允许重复名称
3. `size` 字段 = 所有子节点 `size` 之和（递归）

### 3.3 文件结构（f-node + s-node）

小文件（≤ Node Limit - Header Size）存储在单个 f-node 中：

```
┌─────────────────────────────────┐
│         f-node (File)           │
│   contentType = "text/plain"    │
│   size = 256                    │
│   data = [256 bytes]            │
└─────────────────────────────────┘
```

大文件使用 B-Tree 结构，f-node 作为根节点，s-node 作为内部节点：

```
                    ┌─────────────────────────────────┐
                    │         f-node (Root)           │
                    │   contentType = "video/mp4"     │
                    │   size = 100,000,000            │
                    │   data = [部分数据]              │
                    │   children = [hash1, hash2]     │
                    └─────────────┬───────────────────┘
                                  │
              ┌───────────────────┴───────────────────┐
              │                                       │
              ▼                                       ▼
     ┌─────────────────┐                    ┌─────────────────┐
     │    s-node       │                    │    s-node       │
     │   size = ...    │                    │   size = ...    │
     │   data = [...]  │                    │   data = [...]  │
     │   children=[..] │                    │   children=[]   │
     └────────┬────────┘                    └─────────────────┘
              │
      ┌───────┴───────┐
      ▼               ▼
   s-node          s-node
   (叶子)           (叶子)
```

**数据读取顺序**：
1. 先读取当前节点的 `data` 段
2. 按顺序递归读取每个 `children` 引用的节点
3. 拼接所有数据得到原始文件

### 3.4 Merkle Tree 的安全性

由于每个节点的 Key 是其内容的 SHA-256 哈希，形成了 Merkle Tree：

```
Root Key = SHA-256(Header + Children + Data)
                         ↑
                    包含子节点的 Key（哈希值）
```

这意味着：
- **根节点的 Key 隐含验证了整棵树**
- 任何子节点被篡改，父节点的哈希会变化
- 验证根节点等于验证所有数据

---

## 4. 节点二进制协议

### 4.1 通用 Header 格式（32 字节）

所有节点类型共享相同的 32 字节 Header：

```
Offset  Size   Field      Type     Description
────────────────────────────────────────────────────────────────
0-3     4      magic      u32 LE   固定值 0x01534143 ("CAS\x01")
4-7     4      flags      u32 LE   节点类型 + CT 长度编码
8-15    8      size       u64 LE   逻辑大小
16-19   4      count      u32 LE   子节点数量
20-23   4      length     u32 LE   节点总字节数（含 Header）
24-31   8      reserved   u64      保留字段（必须为 0）
```

#### 4.1.1 Magic Number

```
字节序列: 0x43, 0x41, 0x53, 0x01 ("CAS\x01" ASCII)
u32 LE 值: 0x01534143
```

用于快速识别 CAS 节点格式。

#### 4.1.2 Flags 字段布局

```
Bits 0-1:   节点类型 (TYPE_MASK = 0b11)
            01 = d-node, 10 = s-node, 11 = f-node
            
Bits 2-3:   Content-Type 长度编码 (CT_LENGTH_MASK = 0b1100)
            仅 f-node 使用，其他类型必须为 0
            
Bits 4-31:  保留位（必须为 0）
```

**Content-Type 长度编码**（仅 f-node）：

| 编码值 | 位模式 | 实际长度 |
|--------|--------|----------|
| 0 | `00` | 0 字节（无 Content-Type） |
| 1 | `01` | 16 字节 |
| 2 | `10` | 32 字节 |
| 3 | `11` | 64 字节 |

#### 4.1.3 Size 字段

- **f-node / s-node**：原始文件的总字节数（整个 B-Tree 表示的文件大小）
- **d-node**：所有子节点 `size` 的递归总和

#### 4.1.4 Length 字段

节点的总字节数，包含 Header。用于校验数据完整性。

### 4.2 d-node 完整格式

```
┌────────────────────────────────────────┐
│ Header (32 bytes)                      │
├────────────────────────────────────────┤
│ Children (count × 32 bytes)            │  ← SHA-256 哈希数组
├────────────────────────────────────────┤
│ Names (Pascal strings)                 │  ← 按 UTF-8 字节序排序
└────────────────────────────────────────┘
```

**Children 段**：
- `count` 个连续的 32 字节 SHA-256 哈希
- 顺序与 Names 段一一对应

**Names 段**：
- `count` 个连续的 Pascal String
- 每个 Pascal String: `[u16 LE 长度][UTF-8 字节]`
- 必须按 UTF-8 字节序严格升序排列

**示例**（2 个子节点）：
```
Offset   Content
0-31     Header (magic=0x01534143, flags=0x01, count=2, ...)
32-63    Child[0] hash (32 bytes)
64-95    Child[1] hash (32 bytes)
96-97    Name[0] length (u16 LE) = 5
98-102   Name[0] bytes "alpha"
103-104  Name[1] length (u16 LE) = 4
105-108  Name[1] bytes "beta"
```

### 4.3 s-node 完整格式

```
┌────────────────────────────────────────┐
│ Header (32 bytes)                      │
├────────────────────────────────────────┤
│ Children (count × 32 bytes)            │  ← SHA-256 哈希数组
├────────────────────────────────────────┤
│ Padding (16-byte alignment)            │  ← 填充到 16 字节边界
├────────────────────────────────────────┤
│ Data (raw bytes)                       │  ← 原始文件数据片段
└────────────────────────────────────────┘
```

**Padding 段**：
- 使 Data 段起始于 16 字节对齐的偏移
- 填充字节必须为 0
- 计算：`padding = ceil((32 + count × 32) / 16) × 16 - (32 + count × 32)`

**示例**（1 个子节点，100 字节数据）：
```
Offset   Content
0-31     Header (flags=0x02, count=1, size=..., length=148)
32-63    Child[0] hash (32 bytes)
64-79    Padding (16 bytes of zeros for alignment)
80-179   Data (100 bytes)
```

### 4.4 f-node 完整格式

```
┌────────────────────────────────────────┐
│ Header (32 bytes)                      │
├────────────────────────────────────────┤
│ Children (count × 32 bytes)            │  ← SHA-256 哈希数组
├────────────────────────────────────────┤
│ Content-Type (0/16/32/64 bytes)        │  ← null-padded ASCII
├────────────────────────────────────────┤
│ Data (raw bytes)                       │  ← 原始文件数据片段
└────────────────────────────────────────┘
```

**Content-Type 段**：
- 长度由 flags 的 bits 2-3 决定
- 内容为 ASCII 编码的 MIME 类型
- 不足的部分用 0x00 填充
- 仅允许 printable ASCII (0x20-0x7E)

**对齐规则**：
- Header = 32 字节（16 的倍数）
- Children = N × 32 字节（16 的倍数）
- Content-Type = 0/16/32/64 字节（16 的倍数）
- 因此 Data 段自然对齐到 16 字节边界，无需额外 padding

**示例**（无子节点，Content-Type="application/json"，50 字节数据）：
```
Offset   Content
0-31     Header (flags=0x07, count=0, length=98)
         flags = 0b0111 = type=11(f-node) + ct_len=01(16 bytes)
32-47    Content-Type: "application/json" (16 bytes, null-padded)
48-97    Data (50 bytes)
```

### 4.5 Pascal String 编码

Pascal String 用于 d-node 的子节点名称：

```
┌────────────┬───────────────────────────────┐
│ Length     │ UTF-8 Bytes                   │
│ (u16 LE)   │ (0-65535 bytes)               │
└────────────┴───────────────────────────────┘
```

- 最大长度：65,535 字节（u16 上限）
- 编码：UTF-8
- 验证：解码时使用 `fatal` 模式检测无效 UTF-8

---

## 5. 大文件拆分逻辑

### 5.1 为什么需要拆分

当文件大小超过 `nodeLimit - HEADER_SIZE` 时（默认约 1 MB - 32 = 1,048,544 字节），需要将文件拆分为多个节点。

**不拆分的问题**：
1. 单个节点过大影响传输效率
2. 无法并行上传/下载
3. 小改动需要重新上传整个文件

### 5.2 B-Tree 拓扑设计

CAS 使用**贪婪填充 B-Tree**（Greedy Fill B-Tree）而非传统的 CDC（Content-Defined Chunking）：

**核心思想**：
- 每个节点既存储数据，也存储子节点引用
- 子节点引用各占 32 字节（SHA-256 哈希）
- 优先填满最左侧节点

**容量公式**：

深度 $d$ 的 B-Tree 最大容量：

$$C(d) = \frac{L^d}{32^{d-1}}$$

其中：
- $d$ = 树深度（1 = 叶节点，2 = 一层内部节点 + 叶节点，...）
- $L$ = 每节点可用空间 = `nodeLimit - HEADER_SIZE`

**推导**：
- 深度 1（叶节点）：$C(1) = L$（全部空间存数据）
- 深度 2：根节点存 $L - 32n$ 字节数据，$n$ 个子节点各存 $L$ 字节
  - 最优时 $n = L/32$，容量 = $L + n \times L \approx L^2/32$
- 以此类推

### 5.3 深度计算算法

```typescript
function computeDepth(fileSize: number, nodeLimit: number): number {
  if (fileSize <= 0) return 1;
  
  let depth = 1;
  while (computeCapacity(depth, nodeLimit) < fileSize) {
    depth++;
    if (depth > 10) {
      throw new Error("File too large");
    }
  }
  return depth;
}

function computeCapacity(depth: number, nodeLimit: number): number {
  const L = nodeLimit - HEADER_SIZE;  // 可用空间
  if (depth === 1) return L;
  
  // 使用对数避免溢出
  const logCapacity = depth * Math.log(L) - (depth - 1) * Math.log(32);
  return Math.min(Math.exp(logCapacity), Number.MAX_SAFE_INTEGER);
}
```

### 5.4 贪婪填充布局算法

布局算法决定每个节点存储多少数据、有多少子节点：

```typescript
function computeLayout(fileSize: number, nodeLimit: number): LayoutNode {
  const depth = computeDepth(fileSize, nodeLimit);
  return computeLayoutAtDepth(fileSize, depth, nodeLimit);
}

function computeLayoutAtDepth(
  remainingSize: number,
  depth: number,
  nodeLimit: number
): LayoutNode {
  const L = nodeLimit - HEADER_SIZE;
  
  // 叶节点：全部空间存数据
  if (depth === 1) {
    return {
      depth: 1,
      dataSize: Math.min(remainingSize, L),
      children: []
    };
  }
  
  // 如果剩余数据能放入当前节点，无需子节点
  if (remainingSize <= L) {
    return { depth, dataSize: remainingSize, children: [] };
  }
  
  // 计算需要多少子节点
  const childCapacity = computeCapacity(depth - 1, nodeLimit);
  
  // 每个子节点贡献 childCapacity 容量，消耗 32 字节指针空间
  // 设 n 个子节点，则：
  //   myData = L - n * 32
  //   n * childCapacity + myData >= remainingSize
  //   n * (childCapacity - 32) >= remainingSize - L
  //   n >= (remainingSize - L) / (childCapacity - 32)
  
  const childCount = Math.ceil(
    (remainingSize - L) / (childCapacity - 32)
  );
  const myDataSize = L - childCount * 32;
  
  // 递归构建子节点布局
  let leftover = remainingSize - myDataSize;
  const children: LayoutNode[] = [];
  
  for (let i = 0; i < childCount; i++) {
    const childSize = Math.min(leftover, childCapacity);
    children.push(
      computeLayoutAtDepth(childSize, depth - 1, nodeLimit)
    );
    leftover -= childSize;
  }
  
  return { depth, dataSize: myDataSize, children };
}
```

### 5.5 多层 B-Tree 示例

以默认 `nodeLimit = 1 MB` 为例：

| 深度 | 最大容量 | 典型用途 |
|------|----------|----------|
| 1 | ~1 MB | 小文件，单节点 |
| 2 | ~32 GB | 中等文件，根节点 + 叶子 |
| 3 | ~1 PB | 大文件，三层结构 |
| 4 | ~32 EB | 理论上限 |

**深度 2 示例**（存储 50 MB 文件）：

```
                    ┌─────────────────────────────────────┐
                    │           f-node (Root)             │
                    │   dataSize ≈ 1MB - 50×32 = ~998 KB  │
                    │   children = [50 hashes]            │
                    └───────────────────┬─────────────────┘
                                        │
        ┌───────────────────────────────┼───────────────────────────────┐
        │                               │                               │
        ▼                               ▼                               ▼
   ┌─────────┐                     ┌─────────┐                    ┌─────────┐
   │ s-node  │                     │ s-node  │       ...          │ s-node  │
   │ ~1 MB   │                     │ ~1 MB   │                    │ 剩余    │
   └─────────┘                     └─────────┘                    └─────────┘
```

**深度 3 示例**（存储 10 GB 文件）：

```
                              f-node (Root)
                                  │
                ┌─────────────────┼─────────────────┐
                │                 │                 │
                ▼                 ▼                 ▼
            s-node            s-node            s-node
           (层 2)             (层 2)             (层 2)
                │
        ┌───────┼───────┐
        │       │       │
        ▼       ▼       ▼
     s-node  s-node  s-node
    (叶子)   (叶子)   (叶子)
```

### 5.6 上传流程

上传使用**自底向上**策略：

```typescript
async function uploadFileNode(
  ctx: CasContext,
  data: Uint8Array,
  offset: number,
  contentType: string,
  layout: LayoutNode,
  isRoot: boolean
): Promise<Uint8Array> {  // 返回节点哈希
  
  const nodeData = data.slice(offset, offset + layout.dataSize);
  
  // 叶节点：直接编码上传
  if (layout.children.length === 0) {
    const encoded = isRoot
      ? await encodeFileNodeWithSize({ data: nodeData, contentType }, totalSize, hash)
      : await encodeSuccessorNodeWithSize({ data: nodeData }, totalSize, hash);
    await storage.put(hashToKey(encoded.hash), encoded.bytes);
    return encoded.hash;
  }
  
  // 内部节点：先上传所有子节点
  const childHashes: Uint8Array[] = [];
  let childOffset = offset + layout.dataSize;
  
  for (const childLayout of layout.children) {
    const childHash = await uploadFileNode(
      ctx, data, childOffset, contentType, childLayout, false
    );
    childHashes.push(childHash);
    childOffset += computeTotalSize(childLayout);
  }
  
  // 编码当前节点（包含子节点哈希）并上传
  const encoded = isRoot
    ? await encodeFileNodeWithSize(
        { data: nodeData, contentType, children: childHashes },
        totalSize, hash
      )
    : await encodeSuccessorNodeWithSize(
        { data: nodeData, children: childHashes },
        totalSize, hash
      );
  
  await storage.put(hashToKey(encoded.hash), encoded.bytes);
  return encoded.hash;
}
```

### 5.7 读取流程

读取使用**深度优先前序遍历**：

```typescript
async function readFileData(ctx: CasContext, node: CasNode): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  
  // 1. 先读取当前节点的数据
  if (node.data) {
    parts.push(node.data);
  }
  
  // 2. 按顺序读取子节点
  if (node.children) {
    for (const childHash of node.children) {
      const childNode = await getNode(ctx, hashToKey(childHash));
      const childData = await readFileData(ctx, childNode);
      parts.push(childData);
    }
  }
  
  return concatBytes(...parts);
}
```

---

## 6. 实现约束参数

### 6.1 核心常量

| 常量 | 值 | 说明 |
|------|-----|------|
| `MAGIC` | `0x01534143` | "CAS\x01" little-endian |
| `HEADER_SIZE` | 32 字节 | 所有节点类型共用 |
| `HASH_SIZE` | 32 字节 | SHA-256 输出长度 |
| `DATA_ALIGNMENT` | 16 字节 | 数据段对齐边界 |
| `DEFAULT_NODE_LIMIT` | 1,048,576 字节 (1 MB) | 默认单节点最大值 |

### 6.2 大小限制

| 限制项 | 值 | 说明 |
|--------|-----|------|
| **最大 Size 值** | `Number.MAX_SAFE_INTEGER` | $2^{53} - 1 \approx 9$ PB |
| **最大树深度** | 10 | 硬编码安全限制 |
| **最大 Content-Type 长度** | 64 字节 | 最大 slot 大小 |
| **最大 Pascal String 长度** | 65,535 字节 | u16 上限 |

### 6.3 单节点子节点数约束

d-node 的子节点数受限于 Pascal String 总长度：

```
节点总大小 = Header + Children + Names
          = 32 + N × 32 + Σ(2 + len(name_i))
          ≤ nodeLimit
```

**最坏情况**（所有名称为空字符串）：
- 每个子节点消耗：32（哈希）+ 2（Pascal 长度前缀）= 34 字节
- 最大子节点数：$(nodeLimit - 32) / 34 \approx 30,840$（1 MB 节点）

**最佳情况**（无名称段，仅 s-node/f-node 的子节点）：
- 每个子节点消耗：32 字节（哈希）
- 最大子节点数：$(nodeLimit - 32) / 32 = 32,767$（1 MB 节点）

### 6.4 不同 Node Size 下的容量对比

| Node Limit | 深度 1 | 深度 2 | 深度 3 |
|------------|--------|--------|--------|
| 64 KB | ~64 KB | ~128 MB | ~256 GB |
| 256 KB | ~256 KB | ~2 GB | ~16 TB |
| 1 MB | ~1 MB | ~32 GB | ~1 PB |
| 4 MB | ~4 MB | ~512 GB | ~64 PB |

### 6.5 Size 字段精度说明

当前实现使用 JavaScript `number` 类型存储 size：

```typescript
// 编码：拆分为两个 u32
const sizeLow = header.size >>> 0;
const sizeHigh = Math.floor(header.size / 0x100000000) >>> 0;
view.setUint32(8, sizeLow, true);
view.setUint32(12, sizeHigh, true);

// 解码：合并两个 u32
const sizeLow = view.getUint32(8, true);
const sizeHigh = view.getUint32(12, true);
const size = sizeLow + sizeHigh * 0x100000000;
```

**限制**：
- `Number.MAX_SAFE_INTEGER = 2^53 - 1 ≈ 9 PB`
- 超过此值会丢失精度

**未来改进方向**：
- 对于需要超过 9 PB 的场景，可引入 `BigInt` 重载
- 二进制格式本身支持完整 64 位（约 16 EB）

---

## 7. 验证规则

服务端接收节点时必须执行严格验证。以下是完整验证规则清单：

### 7.1 Header 验证

| 规则 | 说明 |
|------|------|
| **Magic 验证** | 前 4 字节必须为 `0x43, 0x41, 0x53, 0x01` |
| **Length 验证** | `header.length` 必须等于实际 buffer 长度 |
| **Reserved 验证** | 字节 24-31 必须全为 0 |
| **Flags 未使用位** | bits 4-31 必须全为 0 |
| **CT_LENGTH 验证** | 非 f-node 的 CT_LENGTH 必须为 0 |

### 7.2 Content-Type 验证（f-node）

| 规则 | 说明 |
|------|------|
| **字符集限制** | 仅允许 printable ASCII (0x20-0x7E) |
| **Padding 验证** | 填充字节必须为 0x00 |
| **长度一致性** | 实际 Content-Type 长度 ≤ slot 大小 |

### 7.3 Alignment 验证（s-node）

| 规则 | 说明 |
|------|------|
| **Padding 全零** | Header + Children 后到 Data 段之间的填充必须全为 0 |

### 7.4 Pascal String 验证（d-node）

| 规则 | 说明 |
|------|------|
| **UTF-8 有效性** | 使用 `fatal` 模式解码，拒绝无效 UTF-8 |
| **长度边界** | 每个字符串不超出 buffer 边界 |
| **排序验证** | 名称必须按 UTF-8 字节序严格升序 |
| **唯一性验证** | 不允许重复名称 |

### 7.5 语义验证

| 规则 | 说明 |
|------|------|
| **叶节点 Size** | 无子节点时，`header.size == data.length` |
| **Dict Size 一致性** | d-node 的 `size == Σ children.size` |
| **哈希验证** | `sha256(bytes) == expectedKey` |
| **子节点存在性** | 所有引用的子节点 Key 必须存在（可选，按需验证） |

### 7.6 验证实现示例

```typescript
async function validateNode(
  buffer: Uint8Array,
  expectedKey: string,
  hashProvider: HashProvider
): Promise<ValidationResult> {
  // 1. 验证 Magic
  if (!buffer.slice(0, 4).every((b, i) => b === MAGIC_BYTES[i])) {
    return { valid: false, error: "Invalid magic number" };
  }
  
  // 2. 解码 Header
  const header = decodeHeader(buffer);
  
  // 3. 验证 Length
  if (header.length !== buffer.length) {
    return { valid: false, error: `Length mismatch: ${header.length} != ${buffer.length}` };
  }
  
  // 4. 验证 Reserved 字节
  for (let i = 24; i < 32; i++) {
    if (buffer[i] !== 0) {
      return { valid: false, error: `Reserved byte ${i} is not zero` };
    }
  }
  
  // 5. 验证 Flags 未使用位
  if ((header.flags & ~FLAGS.USED_MASK) !== 0) {
    return { valid: false, error: "Unused flag bits are set" };
  }
  
  // 6. 验证哈希
  const hash = await hashProvider.sha256(buffer);
  const actualKey = hashToKey(hash);
  if (actualKey !== expectedKey) {
    return { valid: false, error: `Hash mismatch: ${actualKey} != ${expectedKey}` };
  }
  
  // ... 更多节点类型特定验证
  
  return { valid: true, kind: nodeType, size: header.size };
}
```

---

## 8. Well-Known Keys

Well-Known Keys 是预计算的特殊节点，具有系统级意义。

### 8.1 Empty Dict（空目录）

**用途**：新 Depot 的初始根节点

**字节内容**（32 字节）：
```
Offset   Content
0-3      Magic: 0x43, 0x41, 0x53, 0x01
4-7      Flags: 0x01, 0x00, 0x00, 0x00 (d-node)
8-15     Size: 0x00 × 8 (size = 0)
16-19    Count: 0x00 × 4 (count = 0)
20-23    Length: 0x20, 0x00, 0x00, 0x00 (length = 32)
24-31    Reserved: 0x00 × 8
```

**Key**：
```
sha256:04821167d026fa3b24e160b8f9f0ff2a342ca1f96c78c24b23e6a086b71e2391
```

**生成代码**：
```typescript
const EMPTY_DICT_BYTES = new Uint8Array(32);
const view = new DataView(EMPTY_DICT_BYTES.buffer);
view.setUint32(0, 0x01534143, true);  // magic
view.setUint32(4, 0x01, true);        // flags = d-node
view.setUint32(16, 0, true);          // count = 0
view.setUint32(20, 32, true);         // length = 32

const hash = await crypto.subtle.digest("SHA-256", EMPTY_DICT_BYTES);
const key = "sha256:" + bytesToHex(new Uint8Array(hash));
// -> "sha256:04821167d026fa3b24e160b8f9f0ff2a342ca1f96c78c24b23e6a086b71e2391"
```

### 8.2 使用场景

1. **初始化 Depot**：创建新存储库时，使用 Empty Dict 作为初始根
2. **空目录表示**：任何空目录都可以直接引用此 Key，无需重复存储
3. **快速判断**：检测到此 Key 即可确定为空目录，无需读取内容

---

## 附录 A: 字节序约定

本规范所有多字节整数使用 **Little-Endian (LE)** 字节序：

```
u16 值 0x1234 存储为: 0x34, 0x12
u32 值 0x12345678 存储为: 0x78, 0x56, 0x34, 0x12
u64 值 0x123456789ABCDEF0 存储为: 0xF0, 0xDE, 0xBC, 0x9A, 0x78, 0x56, 0x34, 0x12
```

## 附录 B: 参考实现

核心实现位于 `packages/cas-core/src/`：

| 文件 | 功能 |
|------|------|
| `constants.ts` | 常量定义 |
| `types.ts` | TypeScript 类型 |
| `header.ts` | Header 编解码 |
| `node.ts` | 节点编解码 |
| `topology.ts` | B-Tree 拓扑算法 |
| `utils.ts` | Pascal String、Hex 工具 |
| `controller.ts` | 高层 API |
| `validation.ts` | 严格验证 |
| `well-known.ts` | 预定义节点 |
