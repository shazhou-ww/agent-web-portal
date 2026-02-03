# Realm 端点信息

获取 Realm 基本信息和使用统计。

---

## GET /api/realm/{realmId}

获取 Realm 端点信息和配置。

### 响应

```json
{
  "realm": "usr_xxxxxxxx",
  "commit": {},
  "nodeLimit": 4194304,
  "maxNameBytes": 255
}
```

| 字段 | 描述 |
|------|------|
| `realm` | Realm 标识 |
| `scope` | 可读范围（undefined 表示完全访问） |
| `commit` | 提交权限配置（undefined 表示只读） |
| `nodeLimit` | 单个节点最大字节数 |
| `maxNameBytes` | 文件名最大 UTF-8 字节数 |

---

## GET /api/realm/{realmId}/usage

获取 Realm 的存储使用统计。

### 响应

```json
{
  "realm": "usr_xxxxxxxx",
  "physicalBytes": 1234567890,
  "logicalBytes": 987654321,
  "nodeCount": 12345,
  "quotaLimit": 10737418240,
  "updatedAt": "2025-02-02T12:00:00.000Z"
}
```

| 字段 | 描述 |
|------|------|
| `physicalBytes` | 物理存储字节数（去重后） |
| `logicalBytes` | 逻辑存储字节数（仅 f-node 和 s-node 数据） |
| `nodeCount` | 唯一节点数 |
| `quotaLimit` | 配额限制（0 = 无限制） |
| `updatedAt` | 最后更新时间 |
