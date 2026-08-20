# DeepSeek Harness 桌面版 · 产品功能说明

> 本文档是**权威功能清单**：每次新增/变更功能特性，必须同步更新「功能清单」与「变更记录」。
> 关联文档：[README](./README.md)（快速开始/打包）、[DESKTOP-CAPABILITIES.md](./DESKTOP-CAPABILITIES.md)（能力蓝图）、
> [DESKTOP-ROADMAP.md](./DESKTOP-ROADMAP.md)（路线图）、[COMPETITIVE-ANALYSIS.md](./COMPETITIVE-ANALYSIS.md)（竞品差距）。

## 1. 产品概览

DeepSeek Harness 桌面版 = **Electron 桌面壳 + dsh（Agent Harness）**。启动时自动拉起本地 `dsh web`
（默认 `http://127.0.0.1:3080`）并以原生窗口承载 GUI；通过 preload 桥与本地 API 服务把桌面能力
（托盘/通知/对话框/剪贴板/截屏/全局快捷键）注入页面与 **agent 工具**；内置开发工作流工具集
（Git/变更集/语义索引/检查点/记忆/审批/测试/用量）与客户端插件机制。

## 2. 功能清单

### 2.1 桌面壳（Electron 主进程）

| 功能 | 说明 |
|---|---|
| 免系统 Node | dsh 由 Electron 内置 Node 拉起（`ELECTRON_RUN_AS_NODE`），打包产物无需安装 Node.js |
| 托盘常驻 | 关窗最小化到托盘；托盘菜单：显示/隐藏/退出；真退出前弹窗确认（防误杀后台任务） |
| 全局快捷键 | `Ctrl+Shift+D` 任意应用下唤出主窗口（`DSH_SUMMON_SHORTCUT` 可覆盖） |
| 单实例锁 | 重复启动时聚焦已有窗口 |
| 启动画面 | 状态提示 + 失败日志指引（`%APPDATA%\DeepSeek Harness\dsh.log`） |
| 端口管理 | 启动前清理端口占用；退出时回收 dsh 进程树 |
| 后台不节流 | `backgroundThrottling: false`，隐藏时 agent 流式输出与长任务稳定 |
| 原生菜单 | 应用 / 编辑（撤销/剪切/复制/粘贴/全选）/ 视图（缩放/全屏） |
| 桌面桥 IPC | preload + 白名单 channel + sender 校验（见 2.2） |
| 本地 API 服务 | agent 工具后端（仅 127.0.0.1 + token 鉴权），见 2.3 |
| 客户端插件物化 | 启动时把 `electron/plugins/<name>/` 同步到 profile，解锁客户端插件（见 5） |
| Windows 打包 | NSIS 安装包 + portable 绿色版（`npm run dist`） |

### 2.2 桌面桥 API（页面 window.dshDesktop）

| API | 说明 |
|---|---|
| `notify(title, body)` | 系统通知（Windows Toast / macOS 通知中心） |
| `pickFile` / `pickFolder` / `saveFile` | 原生对话框，返回真实路径或 `null` |
| `getPathForFile(file)` | 拖放进窗口的 File → 真实磁盘路径（拖拽不丢路径） |
| `clipboard.readText` / `writeText` | 剪贴板读写 |
| `window.show/hide/minimize/setAlwaysOnTop` | 窗口控制（钉置顶迷你窗） |
| `setProgressBar(0..1)` | 任务栏进度（-1 清除） |
| `quit()` | 请求退出（走确认） |
| `isDesktop` / `platform` / `versions` | 环境识别 |

### 2.3 Agent 工具（35 个 host 工具 + 1 个客户端插件）

桌面壳随 `--patch` 注入，作用于会话工作目录；会话内直接调用。

**桌面能力 desktop.\***（11，经本地 API 服务 + token 鉴权）：
`desktop_notify` · `desktop_pick_folder` · `desktop_pick_file` · `desktop_save_file` ·
`desktop_clipboard_write` · `desktop_clipboard_read` · `desktop_window_show` · `desktop_window_hide` ·
`desktop_window_always_on_top` · `desktop_progress` · `desktop_screenshot`（截屏喂多模态模型）

**Git 工作流 git.\***（10，数组传参无 shell 注入）：
`git_status` · `git_diff` · `git_log` · `git_commit` · `git_push` · `git_pull` · `git_branch` ·
`git_stash` · `git_remote` · `git_pr_create`（GitHub PR，REST API 免 gh CLI，需 `GITHUB_TOKEN`）

**变更集 changeset.\***（2）：`changeset_review`（交互式多选审批：保留→暂存、未选→还原，可提交）· `changeset_status`

**语义索引 semantic.\***（2）：`semantic_build` · `semantic_search`（本地 TF-IDF 向量，免外部 embedding API，按工作区持久化）

**检查点 checkpoint.\***（4）：`checkpoint_create`（git stash create 快照 + 未跟踪备份）· `checkpoint_list` ·
`checkpoint_restore`（回滚，分支历史不受影响）· `checkpoint_drop`

**项目记忆 memory.\***（3）：`memory_read` · `memory_write`（分区段管理 AGENTS.md/CLAUDE.md）· `memory_path`；
**每轮模型上下文自动注入项目记忆**

**审批策略**（1）：`permission_mode`（ask 交互确认 / never 严格拒绝 / status）

**测试闭环**（1）：`test_run`（探测 npm/pytest/cargo/go 并运行，超时杀进程树）

**用量报告**（1）：`usage_report`（聚合 cost-tracker：费用/Token 按模型/天/会话；今日超阈值告警）

**客户端插件**（1）：`@dsh-runner/meta`（POC，验证客户端插件链路，见 5）

### 2.4 主题与外观

| 功能 | 说明 |
|---|---|
| 护眼模式 | 设置 → 外观 主题第 4 选项（浅色/深色/跟随系统/**护眼**）；深绿护眼配色，无扫描线/动画；持久化 `~/.dsh/settings.yaml` |
| 主题补丁 | `scripts/patch-theme-eye-care.cjs`（postinstall 自动打 dsh 主题补丁，幂等 + 严格校验） |

### 2.5 设置分区

| 分区 | 配置项 | 说明 |
|---|---|---|
| dsh-runner | `usageAlertThreshold`（默认 ¥10） | 每日费用告警阈值，`usage_report` 据此告警 |

### 2.6 编程 Skills（11 个，内置）

随应用启动物化到 `~/.agents/skills/`（与 lark-\* 同根，dsh 自动扫描并注入 agent 上下文），
针对本环境工具（git_*/test_run/semantic_search/changeset/checkpoint/memory）定制：

| Skill | 用途 |
|---|---|
| `code-review` | 系统化代码审查（正确性/安全/风格/测试），输出结构化报告 |
| `debugging` | 复现→定位→修复→验证的调试闭环 |
| `tdd` | 红-绿-重构测试驱动开发 |
| `refactoring` | 检查点保护下小步安全重构 |
| `git-workflow` | 整理/审查/提交/推送/建 PR 规范流程 |
| `commit-message` | Conventional Commits 提交信息 |
| `security-audit` | 依赖与代码安全审计（注入/密钥/权限/供应链） |
| `codebase-navigation` | 探索陌生代码库（semantic_search + 记忆沉淀） |
| `dependency-management` | 安全添加/升级/审计依赖 |
| `api-design` | REST/OpenAPI 接口设计 |
| `performance` | 先测量后优化的性能分析 |

源码在仓库 `skills/`；新增 skill 需同时更新本清单与变更记录。

### 2.7 构建 / 测试 / 安装

| 项 | 说明 |
|---|---|
| `npm install` | postinstall 自动打补丁：node-pty（Spectre 关闭）+ 主题（eye-care 选项） |
| `npm test` | node:test，**65 例**，覆盖全部工具核心逻辑（git/changeset/semantic/checkpoint/memory/test/usage/materialize/pr） |
| `npm start` | 开发运行 |
| `npm run dist` | Windows 打包（NSIS + portable，产物在 `release/`） |

## 3. 配置（环境变量）

| 变量 | 默认 | 说明 |
|---|---|---|
| `DSH_PORT` | `3080` | dsh web 监听端口 |
| `DSH_WORKSPACE` | 项目根目录 | dsh 工作区 |
| `DSH_READY_TIMEOUT_MS` | `180000` | 就绪等待超时 |
| `DSH_NODE` | Electron 内置 Node | 指定 Node 可执行文件 |
| `DSH_CLOSE_TO_TRAY` | `1` | 关窗最小化到托盘（`0` 关闭） |
| `DSH_SUMMON_SHORTCUT` | `CommandOrControl+Shift+D` | 全局唤出快捷键 |
| `GITHUB_TOKEN` / `GH_TOKEN` | — | `git_pr_create` 所需 |
| `DSH_HOME` | `~/.dsh` | dsh 数据目录（物化/索引/检查点/成本数据存放处） |

## 4. 数据与持久化

| 数据 | 位置 |
|---|---|
| dsh 配置/会话/工作区 | `~/.dsh/`（profiles/storages/settings.yaml 等） |
| 语义索引 | `~/.dsh/indexes/<workspace-hash>.json` |
| 检查点 | `~/.dsh/checkpoints/<workspace-hash>/` |
| 成本记录 | `~/.dsh/cost-tracker.json` |
| 应用日志 | `%APPDATA%\DeepSeek Harness\dsh.log` |

## 5. 客户端插件机制

仓库内 `electron/plugins/<name>/`（含 `package.json` 的 `dsh.client` 声明 + 浏览器面）在应用启动时
物化到 `$DSH_HOME/profiles/web/node_modules/@dsh-runner/<name>/`，patch 按包名引用，使 dsh 的
client-modules 识别并服务其客户端 bundle。

**浏览器面契约**：文件执行时调用 `window.__ModuleLoader__.load({ id, factory })`，`factory(require)` 的
**返回值**作为模块导出（CJS factory 形式，不能用 ESM `export`）。参考实现：`electron/plugins/meta/`。

## 6. 变更记录

| 日期 | 版本/提交 | 变更 |
|---|---|---|
| 2026-08 | （待提交） | 内置 11 个编程 Skills（物化到 ~/.agents/skills）+ 文档体系（FEATURES.md/AGENTS.md） |
| 2026-08 | `c14822a` | 设置分区（dsh-runner）+ 用量阈值告警 + **客户端插件物化机制**（@dsh-runner/meta POC） |
| 2026-08 | `00e1304` | git_pr_create（GitHub PR）/ git_remote + 全局唤出快捷键 |
| 2026-08 | `c33ecfd` | usage_report 成本/用量报告 |
| 2026-08 | `46b2dda` | AGENTS.md 项目记忆（+动态注入）/ permission_mode / test_run |
| 2026-08 | `f0f4469` | checkpoint 检查点/回滚（4 工具） |
| 2026-08 | `ceed1d4` | semantic 语义索引（2 工具） |
| 2026-08 | `7756370` | changeset 变更集审查/应用（2 工具） |
| 2026-08 | `194b97e` | Git 工作流工具集（8 工具）+ 单测体系 |
| 2026-08 | `3320f57` | 护眼模式成为主题第 4 选项（patch 机制） |
| 2026-08 | `82953a6` | 内置护眼模式（eye-care.css） |
| 2026-08 | `3329ad6` | M3：desktop.\* agent 工具集（11 工具 + 本地 API 服务） |
| 2026-08 | `9f25d00` | M1+M2：桌面桥 + 托盘/通知/免系统 Node |
| 2026-08 | `3e7f608` | 初始版本：Electron 桌面壳 + dsh web |
