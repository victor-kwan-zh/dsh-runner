---
name: commit-message
version: 1.0.0
description: "规范提交信息：根据改动生成 Conventional Commits 格式的提交信息。当需要写 commit message、整理提交、或审查提交信息时使用。"
---

# 提交信息（Conventional Commits）

## 格式

```
<type>(<scope>): <subject>

<body>
```

- **type**：feat（新功能）/ fix（修复）/ docs（文档）/ style（格式）/ refactor（重构，非修复非功能）/ perf（性能）/ test（测试）/ build（构建）/ ci（CI）/ chore（杂项）
- **scope**（可选）：影响模块，如 `git-tools`、`desktop`、`skills`
- **subject**：祈使句、小写开头、≤72 字符、不带句号
- **body**（可选）：为什么改 + 怎么改（必要时），空行分隔

## 流程

1. `git_status` + `git_diff`（未暂存）看改动内容。
2. 判断改动属于哪个 type（**测试也提交吗？**——改测试 → `test`；顺带格式化 → 不要并进 feat）。
3. 用 subject 概括"做了什么"，body 写"为什么"（尤其是有取舍时）。
4. 提交前自查：subject 是否说清改动？有没有把两个无关改动塞进一个提交？

## 示例

```
feat(git-tools): 新增 git_pr_create 工具（GitHub REST API）

- 无需 gh CLI，用 GITHUB_TOKEN 建 PR
- 自动推送当前分支并解析远程 owner/repo
```

```
fix(changeset): 还原未跟踪文件时忽略不存在的备份
```

## 配合

- 批量/历史提交整理时配合 `git_workflow` skill。
- 中文项目可用中文 subject，但 type/scope 保持英文；保持一致即可。
