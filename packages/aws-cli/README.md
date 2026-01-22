# @agent-web-portal/aws-cli

Agent Web Portal AWS 部署 CLI 工具。

## 概述

`@agent-web-portal/aws-cli` 提供：

- **Skills 上传** - 将 SKILL.md 文件打包上传到 S3
- **Frontmatter 解析** - 解析和验证 SKILL.md 文件
- **环境检查** - 验证 AWS 配置

## 安装

```bash
bun add -D @agent-web-portal/aws-cli
```

## CLI 使用

### 上传 Skills

```bash
# 上传整个 skills 文件夹
bunx awp upload --folder ./skills --bucket my-skills-bucket

# 指定前缀
bunx awp upload --folder ./skills --bucket my-bucket --prefix skills/v1/
```

### 检查环境

```bash
bunx awp check-env
```

## 编程使用

### 发现和上传 Skills

```typescript
import { discoverSkills, uploadSkills } from "@agent-web-portal/aws-cli";

// 发现本地 Skills
const skills = discoverSkills("./skills");
console.log(skills);
// [
//   { name: "my-skill", path: "./skills/my-skill", frontmatter: { ... } },
// ]

// 上传到 S3
await uploadSkills({
  folder: "./skills",
  bucket: "my-bucket",
  prefix: "skills/",
});
```

### 解析 SKILL.md

```typescript
import { parseSkillFile, validateFrontmatter } from "@agent-web-portal/aws-cli";

const { frontmatter, markdown } = parseSkillFile("./skills/my-skill/SKILL.md");

const validation = validateFrontmatter(frontmatter, "my-skill");
if (!validation.valid) {
  console.error("Errors:", validation.errors);
}
```

### 检查环境

```typescript
import { checkEnv, printCheckEnvResult } from "@agent-web-portal/aws-cli";

const result = await checkEnv();
printCheckEnvResult(result);

if (!result.success) {
  process.exit(1);
}
```

## SKILL.md 格式

```markdown
---
name: My Skill
description: A skill that does something
version: 1.0.0
allowed-tools:
  - tool_a
  - tool_b
  - external_mcp:tool_c
mcp-servers:
  external_mcp: https://external.example.com/mcp
---

# My Skill

Skill content in markdown...
```

## 文件结构

Skills 应该按以下结构组织：

```
skills/
├── skill-a/
│   └── SKILL.md
├── skill-b/
│   └── SKILL.md
└── skill-c/
    └── SKILL.md
```

每个 Skill 目录包含一个 `SKILL.md` 文件。

## 上传输出

上传后会生成 `skills.yaml` 配置文件：

```yaml
skills:
  - name: skill-a
    s3_key: skills/skill-a.zip
    frontmatter:
      name: Skill A
      allowed-tools:
        - tool_a
  - name: skill-b
    s3_key: skills/skill-b.zip
    frontmatter:
      name: Skill B
      allowed-tools:
        - tool_b
```

## API

### `discoverSkills(folderPath)`

发现指定目录下的所有 Skills。

### `uploadSkills(options)`

上传 Skills 到 S3。

```typescript
interface UploadOptions {
  folder: string;       // Skills 目录
  bucket: string;       // S3 bucket
  prefix?: string;      // S3 key 前缀
  region?: string;      // AWS 区域
}
```

### `parseSkillFile(filePath)`

解析单个 SKILL.md 文件。

### `parseFrontmatter(content)`

从 Markdown 内容解析 Frontmatter。

### `validateFrontmatter(frontmatter, skillName)`

验证 Frontmatter 格式。

### `checkEnv()`

检查 AWS 环境配置。

## 类型导出

- `SkillMetadata` - Skill 元数据
- `UploadOptions` - 上传选项
- `SkillsYaml` - skills.yaml 结构
- `CheckEnvResult` - 环境检查结果

## 环境变量

| 变量 | 说明 |
|------|------|
| `AWS_REGION` | AWS 区域 |
| `AWS_ACCESS_KEY_ID` | AWS Access Key |
| `AWS_SECRET_ACCESS_KEY` | AWS Secret Key |

## License

MIT
