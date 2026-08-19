# 桌面版扩展空间路线图（dsh + Electron）

> 前置阅读：[DESKTOP-CAPABILITIES.md](./DESKTOP-CAPABILITIES.md)（能力清单：纯 Web 限制 → Electron 解锁）。
> 本文档回答"**接下来怎么扩**"：扩展空间的层次、可落地的集成缝（已对 dsh 源码核实）、分阶段里程碑。

## 0. 本次调研确认的关键集成缝（dsh 侧机制）

这些是"零侵入 dsh 包"就能扩展的依据，均已读源码核实：

| 机制 | 位置 | 对我们的意义 |
|---|---|---|
| `dsh web --patch <file>`（可重复） | `@deepseek-ai/dsh/lib/bin.js`（web 子命令的 `--patch`） | **Electron 壳不用改 dsh 包**，启动时追加一个 patch 层即可注入桌面插件行 |
| Profile/patch 组合语义 | `@deepseek-ai/dsh-app-boot/lib/index.js` `applyEntryPatches` | patch 行可按 `id` 覆盖配置或 `insert` 新插件行；后层覆盖前层；`!!js` 表达式可用 |
| 插件按名解析 | profile 的 `node_modules` fallback（`$DSH_HOME/profiles/node_modules` 符号链接 dsh 依赖闭包） | 新插件可按 npm 包名引用，也可用**绝对路径/文件 URL** 引用本地插件文件 |
| 工具注册 | `@deepseek-ai/dsh-tool-pwsh/lib/index.js`：`ctx.tools.register(defineTool({...}))` | 桌面能力 = 一个新 Cordis 插件，对每个能力 `register` 一个工具即可 |
| 客户端双面插件（node 半 + browser 半） | `dsh-web-app/cordis.patch.yml` 的 `dsh-client-*` 行 | 桌面插件也可带 UI 面（设置卡片、会话内视图） |
| `dsh-tool-cordis` 工具集 | 运行中树可被 agent 自读写 | 桌面插件甚至可以由 agent 在运行时启停/热装 |

## 1. 扩展空间的四个层次

```
┌────────────────────────────────────────────────────────────┐
│ L4 产品形态：多窗口/工作区切换/深链/自启/自动更新/分发       │
├────────────────────────────────────────────────────────────┤
│ L3 agent 层：desktop.* 工具集（桌面能力喂给 agent）          │  ← 纯 Web 彻底做不到
├────────────────────────────────────────────────────────────┤
│ L2 桥层：preload + IPC（window.dshDesktop.* 给 UI 用）      │
├────────────────────────────────────────────────────────────┤
│ L1 壳层：Electron main（生命周期/OS 集成/进程管理）          │
└────────────────────────────────────────────────────────────┘
```

**L1 壳层** —— 现在是"浏览器壳"，先补齐桌面应用的底子：
- `ELECTRON_RUN_AS_NODE` 消除系统 Node 依赖（已实测可行，Electron 37 自带 Node 22.21.1）
- 托盘 + close-to-tray + 退出保护（运行中有任务时确认）
- `backgroundThrottling: false`（后台不节流）
- 原生菜单（macOS 复制粘贴快捷键依赖它）、单实例深链唤醒

**L2 桥层** —— 让页面拿到原生能力，安全模型不变：
- 新增 `electron/preload.js`：`contextBridge.exposeInMainWorld('dshDesktop', {...})`
- `ipcMain.handle` 实现：通知、对话框（文件/文件夹选择）、拖放真实路径（`webUtils.getPathForFile`）、剪贴板、窗口控制、任务栏进度
- 渲染进程保持 `sandbox: true + contextIsolation: true`，只暴露白名单 channel

**L3 agent 层** —— 把桌面能力注册成 agent 工具（最核心的差异化）：
- 一个桌面插件（`electron/desktop-plugin/` 本地文件，或独立 npm 包 `dsh-desktop`）
- 启动时由壳追加 patch：`dsh web --patch <desktop.patch.yml>`
- 插件内 `ctx.tools.register(defineTool({...}))` 注册：
  - `desktop.notify`（任务完成弹系统通知）
  - `desktop.openFolder` / `desktop.pickFile` / `desktop.pickFolder`（原生对话框，返回真实路径）
  - `desktop.screenshot`（截屏喂多模态模型 → 桌面自动化）
  - `desktop.clipboard` / `desktop.tray` / `desktop.window`（钉置顶/最小化/唤起）
- 工具按会话授权：敏感能力需用户确认（复用 `ui-permission` 机制）

**L4 产品形态** —— 从"一个窗口"到"一个桌面产品"：
- 多窗口（多会话并排）、alwaysOnTop 迷你窗
- 工作区切换器（托盘菜单切换 `DSH_WORKSPACE` 热重启）
- `dsh://` 深链直达会话、`.dshsession` 文件关联
- 开机自启、`electron-updater` 自动更新
- 多 profile 并存（`--profile desktop` 专用 profile，bundles 里加桌面插件）

## 2. 分阶段里程碑

| 里程碑 | 内容 | 依赖 | 工作量 | 状态 |
|---|---|---|---|---|
| **M1 壳层加固** | ELECTRON_RUN_AS_NODE + 托盘常驻 + 退出保护 + backgroundThrottling + 原生菜单 | 无 | 小 | ✅ 已实现（2026-08） |
| **M2 桥层** | preload + IPC：notify / pickFolder / pickFile / getPathForFile / showWindow / quit | M1 | 小 | ✅ 已实现（2026-08），`window.dshDesktop` 见 README |
| **M3 agent 工具** | desktop-plugin + `--patch` 注入，注册 desktop.* 工具集 | M2（工具内部复用桥） | 中 | ✅ 已实现（2026-08）：11 个工具（notify/选文件选夹/保存/剪贴板/窗口/进度/截屏），经本地 API 服务 + token 鉴权 |
| **M4 产品形态** | 多窗口 / 工作区切换 / 深链 / 自启 / 自动更新 | M1 | 中 | ⏳ 待做 |
| **M5 架构演进** | 探索 in-process hosting（main 进程直接 import dsh boot，省掉子进程与端口）；dsh 打进 asar 做单文件分发 | M1 | 大（实验性） | ⏳ 待做 |

## 3. 建议的起点：M1 + M2（一组改动落地）

> ✅ **M1 + M2 已于 2026-08 落地**，对应改动即当前 `electron/main.js` + `electron/preload.js`：
> `ELECTRON_RUN_AS_NODE` 免系统 Node（已实测：dsh 由 `electron.exe` 内置 Node 22.21.1 拉起）、
> 托盘 + 关窗最小化 + 退出确认、`backgroundThrottling: false`、原生菜单、`window.dshDesktop` 桌面桥。

1. `electron/main.js`：`resolveNodeBinary()` → 用 `process.execPath` + `ELECTRON_RUN_AS_NODE=1`（注意 `spawnEnv` 要保留该变量）✅
2. 新增 `electron/preload.js` + `webPreferences.preload` ✅
3. `ipcMain.handle('desktop:notify'|'desktop:pickFolder'|...)`，通道白名单 + sender 校验 ✅
4. `Tray` + 关窗最小化 + 真退出前检查运行中任务 ✅（当前为退出确认弹窗，后续可接 dsh 任务查询接口做"有任务才确认"）
5. `backgroundThrottling: false` ✅

下一站：**M3 agent 工具**——把桌面能力注册成 `desktop.*` 工具集（`ctx.tools.register` + `--patch` 注入），让 agent 自己也能用托盘/通知/文件选择/截图。

> ✅ **M3 已于 2026-08 落地**：`electron/desktop-plugin/`（Cordis 插件，注册 11 个 `desktop.*` 工具）+ `electron/desktop-api.js`（主进程本地 HTTP 服务，仅 127.0.0.1 + token 鉴权）+ main.js 启动时 `--patch` 注入。实测：插件注册、鉴权（无 token 401）、剪贴板往返、屏幕截图全部通过。
>
> **实现要点（踩坑记录）**：`--patch` 必须排在 `--host/--port` 之前（launcher 的 web 子命令 `enablePositionalOptions`，web 应用自身的解析器不认识 `--patch`）；插件名须用 `file://` URL（profile boot 的 Include 不做 Windows 路径转换）；插入行需显式 `config: {}`（插件导出 Config schema 时，无 config 会校验失败）。

完成后桌面版即可对外宣称：托盘常驻、后台不节流、原生通知与文件选择、无系统 Node 依赖——并以此为基座继续 M3/M4。

## 4. 约束与风险

- **安全**：桥是双刃剑——IPC 白名单 channel、校验 sender；敏感工具（screenshot/clipboard）默认需用户确认；凭证走 `safeStorage`。
- **dsh 升级兼容**：`--patch` / `ctx.tools.register` 是 dsh 的稳定机制，但 patch 行若引用 dsh 内部行 id，升级时需核对；桌面插件应尽量只 `insert` 新行、少覆盖内建行。
- **in-process hosting（M5）**：失去子进程崩溃隔离；dsh 的 fail-loud 退出语义需适配；收益是免端口、免 HTTP hop、main 与 agent 同进程直连。先做 POC 验证再决定。
