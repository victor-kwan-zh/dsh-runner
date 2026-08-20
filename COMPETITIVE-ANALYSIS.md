# DeepSeek Harness 客户端 · 竞品差距分析（2026）

> 对照 2026 年主流 AI agent 软件（Cursor / Claude Code / Cline / Windsurf / Copilot / OpenHands / Aider 等），
> 盘点 dsh-runner（桌面壳 + dsh harness）还缺哪些能力，按"投入产出 × 架构可行性"排优先级。
> 调研参考：[Scrimba 2026 对比](https://scrimba.com/articles/best-ai-coding-assistants-2026/)、
> [AI Comparatives 2026](https://www.edenai.co/post/best-coding-agents-which-ai-writes-the-best-code)、
> [Claude Code 更新日志](https://code.claude.com/docs/en/changelog)、
> [阿里云 2026 五大开源助手实测](https://developer.aliyun.com/article/1734133)。

## 0. 先明确定位：DSH 是什么

DSH 不是"编辑器插件"，也不是"终端工具"，而是**独立的 Agent Harness**：agent 是产品本身，
有 Web GUI + 桌面壳（托盘/通知/对话框/截屏等原生能力已接入 agent 工具）、profile/插件/skill 生态、
多模型多 provider、定时任务、自举工具（agent 能改自己的配置）。这个定位本身是差异化，
以下差距分析以此为前提——**不是照着 Cursor 抄，而是补"用户对 AI agent 软件的基础预期"**。

## 1. 能力差距矩阵

图例：✅ 已有（本仓库/DSH 内置）｜◐ 部分/需强化｜❌ 缺

| 能力 | 竞品代表 | DSH 现状 | 差距 | 优先级 |
|---|---|---|---|---|
| **代码库索引 + 语义搜索** | Cursor codebase indexing / RAG | ◐ 只有正则 fs-search、session 全文检索（opt-in） | 无向量索引/语义检索 | **P0** |
| **Git 工作流**（diff/commit/PR） | Claude Code / Cline | ❌ 无原生工具（只能 bash 手搓） | 缺 `git.diff`/`git.commit`/`git.push`/`git.pr` 工具 + UI | **P0** |
| **变更集审查 + 应用**（多文件 diff 审批） | Cursor / Claude Code / Cline | ◐ 有 DiffBlock 展示，但无"变更集 → 逐文件接受/拒绝 → 应用"流 | 审批式应用流 | **P0** |
| **检查点 / 回滚**（文件快照） | Claude Code checkpoints、Cursor snapshot | ❌ 无 | 快照 + 一键回滚 | **P0** |
| **自动审批细化**（YOLO / 超时放行 / 按工具粒度） | Cline / Claude Code / OpenHands | ◐ 有 permission-presets + 沙箱 + approval，但粒度粗 | 会话级 YOLO、超时自动放行、危险操作强制确认 | P1 |
| **项目记忆文件协议**（AGENTS.md / CLAUDE.md） | Claude Code / Cursor / Aider | ◐ 有 skills，无标准项目记忆文件 | 读写 `AGENTS.md` 并注入上下文 | P1 |
| **@-mention 文件/符号** | Cursor / Claude Code | ◐ ui-skill/ui-subagent 可引用，文件级 @ 弱 | 输入框 @ 文件/符号 → 注入内容 | P1 |
| **测试闭环**（跑测试→修→验证） | 各家 IDE agent | ❌ 无专用工具 | `test.run` + 失败 → 修复 → 重跑编排 | P1 |
| **模型路由/自动选型 + fallback** | Cline / OpenHands | ◐ 多 provider + llm-retry 已有 | 按任务自动选 small/big、成本上限 | P1 |
| **用量/成本仪表盘** | Cline / OpenHands | ◐ token-meter + cost-tracker 插件有 | 内置进设置页 + 会话内展示 | P1 |
| **首次启动引导/模板** | 各家 | ❌ 弱 | onboarding 向导 + 预设场景模板 | P1 |
| **浏览器自动化 / computer use** | OpenHands / Manus | ◐ desktop.screenshot + web 工具已打通 | 完整 browser agent（导航/点击/填表） | P1 |
| **云端沙箱执行**（E2B/Codespaces） | Cline / OpenHands | ❌ 仅本地沙箱 | 隔离执行高风险代码 | P2 |
| **语音输入** | Cursor / Copilot | ❌ 无 | 语音转文字发消息 | P2 |
| **团队协作/会话分享** | Copilot/Cursor 团队版 | ◐ 有 session 导出，无分享/协同 | 分享链接、live 协同 | P2 |
| **多设备同步** | 各家云版 | ❌ 无 | 云会话同步 | P2 |
| **本地模型**（Ollama 等） | OpenHands / Cline | ◐ 有 pi-ai 等 provider | Ollama 直连 | P2 |
| **IDE/编辑器集成** | Cursor / Continue | ❌ 无 | VS Code 扩展或编辑器协议 | P2（定位选择） |

## 2. DSH 独有优势（竞品没有，值得强化）

1. **桌面原生能力 = agent 工具**：托盘常驻、系统通知、原生对话框、剪贴板、**屏幕截屏**都已注册成 `desktop.*` 工具——"让 agent 操作你的电脑"比任何 IDE 插件都贴近真实桌面自动化。建议继续加：全局快捷键、系统音量/媒体控制、多显示器截屏、窗口管理。
2. **自举/自管理**：`dsh-tool-cordis` 让 agent 能直接读改自己的插件树/配置——可以做"agent 自己装插件、改主题、调设置"的杀手级体验。
3. **插件/profile 生态 + 定时任务**：任务看板 cron、schedule、SSH、skills——企业内可定制分发。
4. **多 provider 中立**：不绑定单一模型商（DeepSeek 默认 + 多家），可做"模型路由"差异化。

## 3. 建议路线（按"用户预期 → 架构可行性"）

**P0（先补"AI agent 软件"的基础预期）—— ✅ 已实现（2026-08，见各 commit）**
1. **Git 工作流工具集**：`git_*` 8 个工具（status/diff/log/commit/push/pull/branch/stash），host 插件 `ctx.tools.register`。✅
2. **变更集审查/应用**：`changeset_review`（交互式多选审批保留/还原 + 可选提交）/ `changeset_status`。✅
3. **代码库语义索引**：本地 TF-IDF 稀疏向量索引（免外部 embedding API、可离线），`semantic_build` / `semantic_search`。✅
4. **检查点/回滚**：`checkpoint_create`（git stash create 快照 + 未跟踪备份）/ `list` / `restore` / `drop`。✅
   - 全部配套 `node:test` 单测（`npm test`，32 例），测试抓出过 `--branch` 头部行污染变更列表的真实 bug。

**P1（体验强化）—— ✅ 已实现（2026-08）**
- AGENTS.md 记忆协议：`memory_read/write/path` + 每轮模型上下文动态注入。✅
- 自动审批细化：`permission_mode`（会话级 ask/never 切换；注：dsh 审批策略刻意 fail-closed，无 YOLO 自动放行）。✅
- 测试闭环工具：`test_run`（探测 npm/pytest/cargo/go 并运行，超时杀进程树）。✅
- 待做：@-mention 文件、成本仪表盘内置、onboarding 引导。

**P2（扩展形态）**
- 浏览器 agent、云端沙箱、语音、团队协作、VS Code 集成、本地模型

## 4. 一句话结论

DSH 作为"自带桌面的独立 Agent Harness"在**自动化与生态**上已经领先，但缺的是**开发工作流闭环**
（Git/索引/检查点/审批）——这四项 P0 补齐后，DSH 就从"强大的 agent 演示环境"变成"完整的 AI 编程工作台"。
