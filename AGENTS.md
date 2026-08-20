# 项目约定（AGENTS.md）

本文件会被 dsh-runner 的 memory 工具**每轮自动注入**模型上下文（见 FEATURES.md 2.3 项目记忆）。

## 铁律：功能特性必须沉淀到 FEATURES.md

**每次新增/变更客户端功能特性（工具、桌面能力、主题、设置、机制、构建产物等），
必须同步更新 `FEATURES.md`：**
1. 在「2. 功能清单」对应分组补充/修改条目（保持计数准确：工具数量、测试数量）；
2. 在「6. 变更记录」顶部插入一行（日期 + 提交号 + 变更摘要）。
提交信息里注明 `docs(FEATURES):` 或不影响，但文档必须改。

> 判断标准：任何用户可见的能力变化（新工具、新配置、新行为、新打包产物）都算。

## 架构速览

- **桌面壳**（`electron/main.js`）：拉起 `dsh web`（ELECTRON_RUN_AS_NODE 免系统 Node）→ 窗口加载
  http://127.0.0.1:3080；托盘/快捷键/菜单/IPC（`preload.js`）/本地 API 服务（`desktop-api.js`）。
- **插件注入**：main.js 启动时生成 `desktop.patch.yml`（userData），`dsh web --patch` 注入；
  host 插件为 `electron/<xxx>-tools/index.mjs`（`ctx.tools.register`），客户端插件在
  `electron/plugins/<name>/`（物化到 profile，浏览器面走 `__ModuleLoader__.load`）。
- **Skills**：仓库 `skills/<name>/SKILL.md`（Anthropic 格式：YAML frontmatter name/description），
  启动时物化到 `~/.agents/skills/`，dsh 自动扫描注入 agent 上下文；新增 skill 同步更新 FEATURES.md。
- **测试**：`npm test`（node:test，`scripts/test/*.test.mjs`）——每个工具核心都是纯函数模块
  （`*-core.mjs`），插件层只做注册；新增工具必须配核心单测。
- **postinstall 补丁**：`scripts/patch-node-pty.cjs`（Spectre）、`scripts/patch-theme-eye-care.cjs`
  （护眼主题选项）——幂等 + 片段严格校验，dsh 升级失效会显式报错。

## 关键路径

| 用途 | 路径 |
|---|---|
| 产品功能清单/变更记录 | `FEATURES.md` |
| 能力蓝图 / 路线图 / 竞品差距 | `DESKTOP-CAPABILITIES.md` / `DESKTOP-ROADMAP.md` / `COMPETITIVE-ANALYSIS.md` |
| 工具核心（纯函数） | `electron/*-tools/*-core.mjs` |
| 工具注册（Cordis 插件） | `electron/*-tools/index.mjs` |
| 客户端插件（浏览器面） | `electron/plugins/<name>/client.js` |
| 内置编程 Skills | `skills/<name>/SKILL.md`（物化到 `~/.agents/skills/`） |
| 测试 | `scripts/test/*.test.mjs` |
| 运行日志 | `%APPDATA%\DeepSeek Harness\dsh.log` |
| 用户数据 | `~/.dsh/`（profiles / indexes / checkpoints / cost-tracker.json） |
