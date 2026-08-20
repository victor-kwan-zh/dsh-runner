---
name: git-workflow
version: 1.0.0
description: "Git 工作流：整理改动、审查、提交、推送、建 PR 的规范流程。当用户要提交代码、整理工作区、创建 PR、或问 git 操作怎么做时使用。"
---

# Git 工作流

## 标准流程

1. **看状态**：`git_status`（分支 + 变更清单）确认工作区现状。
2. **整理**：`changeset_status` 看每文件增删；`changeset_review` 让用户挑选保留的文件（未选中的还原）——保留的自动暂存。
3. **审一眼 diff**：`git_diff --staged` 确认要提交的内容干净、无敏感信息、无临时文件。
4. **提交**：`git_commit`（message 用规范格式，见 commit-message skill）；需要拆多个提交时用 `git_commit` 指定 `files` 分批。
5. **推送**：`git_push`（新分支自动 `-u` 建立上游）。
6. **建 PR**（GitHub）：`git_pr_create`（title/body/base/head；需 `GITHUB_TOKEN`）。

## 注意

- **不要乱提交**：build 产物、node_modules、日志、密钥绝不能进版本库（先确认 .gitignore）。
- **提交前自查**：`git_diff` 里有没有调试代码/临时打印？
- **冲突处理**：`git_pull` 失败 → 看冲突文件 → 手动解决 → `git_commit`（不带 message 的 merge 提交按提示处理）。
- **丢改动风险**：清理前先 `git_stash push`（暂存）或 `checkpoint_create`，确认不需要再丢。
- **分支**：`git_branch` list/create/switch/delete；不要直接在 main 上乱改。

## 紧急救援

- 误删/误改未提交内容：`git_stash list` + `pop`，或 `checkpoint_restore`（有检查点的话）
- 提交信息写错：`git_commit --amend`（只改最新一条、且未推送时）
