# CAS 存储技术概览

> 本文档总结 CAS (Content-Addressable Storage) 存储系统的核心概念和原理。

## 1. 什么是 CAS？

CAS（内容寻址存储）是一种以数据内容的哈希值作为地址的存储方式。

**核心公式**：
$$\text{Key} = \text{sha256:} + \text{hex}(\text{SHA256}(\text{Content}))$$

例如，内容 `"Hello, World!"` 的地址是：
```
sha256:315f5bdb76d078c43b8ac0064e4a0164612b1fce77c869345bfc94c75894edd3
```

### 三大核心特性

| 特性 | 含义 | 好处 |
|------|------|------|
| **不可变性** | 同一内容永远对应同一地址 | 版本天然存在，引用永不失效 |
| **全局去重** | 相同内容只存一份 | 节省存储空间 |
| **完整性校验** | 地址即校验和 | 自动验证数据完整性 |

---

## 2. 二进制节点格式

CAS 使用紧凑的二进制格式存储节点。每个节点由 **Header + 可选段落** 组成。

### 节点结构

```
┌──────────────────────────────────────────────────────────────────┐
│                         HEADER (32 bytes)                        │
├──────────────────────────────────────────────────────────────────┤
│                    CHILDREN (N × 32 bytes)                       │
│                    [子节点哈希数组，可选]                           │
├──────────────────────────────────────────────────────────────────┤
│                    NAMES (Pascal strings)                        │
│                    [子节点名称，仅 collection]                      │
├──────────────────────────────────────────────────────────────────┤
│                    CONTENT-TYPE (Pascal string)                  │
│                    [MIME 类型，可选]                               │
├──────────────────────────────────────────────────────────────────┤
│                    DATA (raw bytes)                              │
│                    [原始数据，仅 chunk]                            │
└──────────────────────────────────────────────────────────────────┘
```

### Header 结构 (32 bytes)

| 偏移 | 大小 | 字段 | 说明 |
|------|------|------|------|
| 0 | 4 | Magic | `0x01534143` ("CAS\x01" LE) |
| 4 | 4 | Flags | 位标志 |
| 8 | 4 | Count | 子节点数量 |
| 12 | 4 | Padding | 保留 |
| 16 | 8 | Size | 逻辑大小 (u64) |
| 24 | 4 | NamesOffset | NAMES 段偏移 |
| 28 | 4 | TypeOffset | CONTENT-TYPE 段偏移 |

### Flags 标志位

| 位 | 名称 | 含义 |
|----|------|------|
| 0 | HAS_NAMES | 有 NAMES 段（仅 collection） |
| 1 | HAS_TYPE | 有 CONTENT-TYPE 段 |
| 2 | HAS_DATA | 有 DATA 段（仅 chunk） |

### 节点类型判断

通过 Flags 判断节点类型：
- **Collection**：`HAS_NAMES` 为 1
- **Chunk**：`HAS_NAMES` 为 0

---

## 3. 两种节点类型

### Chunk（数据块）

Chunk 是存储原始二进制数据的节点。

**结构**：
- Header (flags: HAS_DATA, 可能有 HAS_TYPE)
- Children（可选，用于 B-Tree 分片）
- Content-Type（可选，MIME 类型）
- Data（原始字节）

**用途**：
- 文件的实际内容
- 大文件分片（多个 chunk 组成）

### Collection（目录）

Collection 表示一个目录结构，包含命名的子节点引用。

**结构**：
- Header (flags: HAS_NAMES, 可能有 HAS_TYPE)
- Children（子节点哈希数组）
- Names（子节点名称，与 Children 一一对应）
- Content-Type（可选）

**用途**：
- 表示目录
- 组织多个文件

---

## 4. Merkle DAG

节点通过子节点哈希形成 **Merkle DAG**（有向无环图）。

```
Collection (root)
├── file1.txt → Chunk (sha256:aaa...)
│               └── DATA: "Hello"
├── file2.png → Chunk (sha256:bbb...)
│               └── DATA: [PNG bytes]
└── subdir/   → Collection (sha256:ccc...)
                ├── a.txt → Chunk (sha256:ddd...)
                └── b.txt → Chunk (sha256:eee...)
```

### 完整性保证

**任何节点被篡改 → 该节点哈希变化 → 父节点哈希变化 → ... → 根节点哈希变化**

只需验证根节点哈希，即可确保整棵树的完整性。

---

## 5. 空集合

空集合是一个特殊的 Collection，没有任何子节点。

**二进制内容**（32 bytes）：
```
Magic:       0x01534143
Flags:       0x00000001 (HAS_NAMES)
Count:       0
Padding:     0
Size:        0
NamesOffset: 32 (紧跟 header)
TypeOffset:  0
```

**固定 Key**：
```
sha256:a78577c5cfc47ab3e4b116f01902a69e2e015b40cdef52f9b552cfb5104e769a
```

---

## 6. 大文件处理

超过节点大小限制（默认 1MB）的文件会被分片处理。

### B-Tree 结构

```
File Node (contentType: "video/mp4")
├── chunk-0 (1MB)
├── chunk-1 (1MB)
├── ...
└── chunk-N (剩余部分)
```

**Size 字段**：对于父节点，Size 表示所有子节点数据的总大小，支持 seek 操作。

---

## 7. Pascal String 编码

Names 和 Content-Type 使用 **Pascal String** 格式存储：

| 字节 | 内容 |
|------|------|
| 0 | 长度 N (1 byte, max 255) |
| 1..N | UTF-8 字符串内容 |

多个 Pascal String 紧密排列，无分隔符。

---

## 8. 哈希计算

Key 由节点的完整二进制内容计算：

$$\text{Key} = \text{"sha256:"} + \text{hex}(\text{SHA256}(\text{Header} \| \text{Children} \| \text{Names} \| \text{Type} \| \text{Data}))$$

**注意**：子节点的哈希值参与父节点的哈希计算，这是 Merkle Tree 的核心。

---

## 9. 与其他系统的对比

| 特性 | CAS | Git | IPFS |
|------|-----|-----|------|
| 哈希算法 | SHA-256 | SHA-1 → SHA-256 | SHA-256 (默认) |
| 网络模型 | 中心化服务 | 本地仓库 | P2P 网络 |
| 访问控制 | Ticket 机制 | 无 | 公开访问 |
| 节点类型 | chunk/collection | blob/tree/commit | 多种 |
| MIME 类型 | 内置支持 | 无 | 可选 |

---

## 10. 关键设计决策

### 为什么用二进制而非 JSON？

- **紧凑**：无额外字符开销
- **高效**：直接内存映射，无需解析
- **哈希稳定**：避免 JSON 格式化差异

### 为什么 Header 固定 32 字节？

- **对齐**：便于内存对齐访问
- **简单**：固定偏移，快速解析
- **扩展性**：保留空间用于未来扩展

### 为什么用 Flags 而非 type 字段？

- **灵活**：多个属性可组合
- **紧凑**：1 字节可表达 8 个特性
- **兼容**：新增 flag 不破坏旧格式

---

## 总结

CAS 存储的核心原理：

1. **内容寻址**：地址 = SHA-256(内容)
2. **二进制格式**：32 字节 Header + 可变段落
3. **两种节点**：Chunk（数据）和 Collection（目录）
4. **Merkle DAG**：树状结构，根哈希保证完整性
5. **高效存储**：全局去重，大文件分片

这种设计让 CAS 在 MCP 生态中成为可靠的二进制数据层，既高效又安全。
