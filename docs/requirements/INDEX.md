# CAS/CASFA 需求索引

> 云端文件系统核心需求追踪

## 需求清单

### P0 - 必须完成

- [ ] [GC-001: 垃圾回收机制](./GC-001-garbage-collection.md)
- [ ] [QUOTA-001: 配额管理](./QUOTA-001-quota-management.md)

### P1 - 高优先级

- [ ] [API-001: CAS API 路由重构](./API-001-route-refactor.md)
- [ ] [SDK-001: Client SDK 文件操作辅助函数](./SDK-001-collection-operations.md)

### P2 - 中优先级

- [ ] VERSION-001: 版本历史（待细化）
- [ ] SEARCH-001: 搜索索引（待细化）
- [ ] UI-001: 前端文件浏览器增强（待细化）
- [ ] MONITOR-001: 监控统计（待细化）

### P3 - 低优先级

- [ ] SHARE-001: 共享协作（待细化）
- [ ] WEBHOOK-001: 事件通知（待细化）

---

## 设计原则

1. **不可变性**：CAS 节点一旦创建不可修改，所有"修改"都是创建新节点
2. **内容寻址**：SHA-256 哈希作为 key，天然去重
3. **最小服务端**：能在 client SDK 实现的不加服务端 API
4. **Merkle DAG**：chunk → file → collection 三层结构

## 已完成能力

- ✅ 三层节点存储（chunk/file/collection）
- ✅ 三层认证体系（User Token/Agent Token/Ticket）
- ✅ Ownership 追踪
- ✅ Commits 管理
- ✅ 跨平台 Client SDK
- ✅ MCP Tools 集成
- ✅ CAS Binary Format 核心库（`@agent-web-portal/cas-core`）
