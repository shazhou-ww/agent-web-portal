# Node 操作

节点是 CAS 中的基本存储单元，包括三种类型：
- **d-node (dict)**: 目录节点，包含子节点映射
- **f-node (file)**: 文件顶层节点，包含 content-type
- **s-node (successor)**: 文件后继节点，用于大文件分块

---

## POST /api/realm/{realmId}/prepare-nodes

预上传检查：提交一个 key 列表，服务端返回哪些节点需要上传。对于已存在的节点，会 touch 其生命周期，防止被 GC 回收。

### 请求

```json
{
  "keys": ["sha256:abc123...", "sha256:def456...", "sha256:ghi789..."]
}
```

### 响应

```json
{
  "missing": ["sha256:abc123...", "sha256:ghi789..."],
  "exists": ["sha256:def456..."]
}
```

| 字段 | 描述 |
|------|------|
| `missing` | 需要上传的节点 key 列表 |
| `exists` | 已存在的节点 key 列表（已 touch 生命周期） |

---

## GET /api/realm/{realmId}/nodes/:key/metadata

获取节点元信息，包括类型、payload 大小、子节点列表等。

### 响应

Dict 节点 (d-node)：

```json
{
  "key": "sha256:abc123...",
  "kind": "dict",
  "payloadSize": 256,
  "children": {
    "file1.txt": "sha256:file1...",
    "subdir": "sha256:subdir..."
  }
}
```

File 节点 (f-node)：

```json
{
  "key": "sha256:abc123...",
  "kind": "file",
  "payloadSize": 1234,
  "contentType": "text/plain",
  "successor": "sha256:next..."
}
```

Successor 节点 (s-node)：

```json
{
  "key": "sha256:abc123...",
  "kind": "successor",
  "payloadSize": 4194304,
  "successor": "sha256:next..."
}
```

| 字段 | 描述 |
|------|------|
| `key` | 节点 key |
| `kind` | 节点类型：`dict`, `file`, `successor` |
| `payloadSize` | payload 大小（字节） |
| `children` | 子节点映射（仅 d-node） |
| `contentType` | 内容类型（仅 f-node） |
| `successor` | 后继节点 key（f-node/s-node，可选） |

---

## GET /api/realm/{realmId}/nodes/:key

获取节点的二进制数据。

### 响应

- Content-Type: `application/octet-stream`
- Body: 节点二进制数据（cas-core 格式）

响应头包含元数据：

- `X-CAS-Kind`: 节点类型
- `X-CAS-Payload-Size`: payload 大小

---

## PUT /api/realm/{realmId}/nodes/:key

上传节点（二进制格式）。

### 请求

- Content-Type: `application/octet-stream`
- Body: 二进制节点数据

节点格式遵循 cas-core 二进制格式，包含：

- Magic bytes 和头部结构
- Hash 验证
- 子节点存在性验证

### 响应

```json
{
  "key": "sha256:abc123...",
  "kind": "file",
  "payloadSize": 12345
}
```

| 字段 | 描述 |
|------|------|
| `key` | 节点 key |
| `kind` | 节点类型：`dict`, `file`, `successor` |
| `payloadSize` | payload 大小 |

### 错误

| 状态码 | 描述 |
|--------|------|
| 400 | 节点格式无效 |
| 403 | 配额超限 |

子节点缺失时返回：

```json
{
  "success": false,
  "error": "missing_nodes",
  "missing": ["sha256:xxx", "sha256:yyy"]
}
```
