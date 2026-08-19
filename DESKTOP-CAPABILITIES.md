# 桌面版能力蓝图：纯 Web 限制 → Electron 解锁

> 一句话现状：`electron/main.js` 目前只是「进程管理器 + 浏览器壳」——spawn 系统 `node` 跑 `dsh web`，
> 窗口加载 `http://127.0.0.1:3080`。渲染进程 `sandbox: true + contextIsolation: true` 且**没有 preload / IPC 桥**，
> 所以页面里的 dsh Web 应用拿不到任何 Electron 能力。本文档分析纯 Web 版做不到、桌面版能做的功能，
> 并给出落地路径与优先级。

## 0. 现状核对（代码依据）

| 位置 | 现状 | 影响 |
|---|---|---|
| `electron/main.js` L272-276 | `webPreferences` 无 `preload`，渲染进程被 sandbox 隔离 | 页面与主进程零通信，Electron 能力全部闲置 |
| L233 / L49-77 | 用**系统** `node` 拉起 `@deepseek-ai/dsh` | 打包后 exe 仍要求本机装 Node.js 20+ |
| L350-357 `before-quit` | 关窗口 → `stopDsh()` 强杀进程树 | 运行中的 goal rounds / 定时任务随窗口陪葬 |
| L300-312 | 仅一个"应用"菜单（刷新/DevTools/退出） | 无原生编辑菜单，macOS 上复制粘贴快捷键缺失 |
| L38-47 `spawnEnv` | 剥掉 `ELECTRON*` 环境变量再传给 dsh | 若改用 `ELECTRON_RUN_AS_NODE` 需保留该变量 |

**已验证**：Electron 37.10.3 内置 Node 22.21.1；`ELECTRON_RUN_AS_NODE=1 electron.exe node_modules/@deepseek-ai/dsh/lib/bin.js --version` → `0.1.0-rc.7` ✓
→ "免系统 Node 依赖"今天就能落地（`resolveNodeBinary` 换成 `process.execPath` + `ELECTRON_RUN_AS_NODE`，Windows/macOS/Linux 通吃）。

## 1. 能力对照表（纯 Web 限制 → Electron 方案）

优先级：**P0** = 建议先做（痛点最直接、收益最大）；P1 = 高价值；P2 = 锦上添花。

| # | 能力 | 纯 Web 版的限制 | Electron 方案 | 优先级 |
|---|---|---|---|---|
| 1 | **系统托盘常驻** | 标签页关了 UI 就没了；服务在跑但不可见、难找回 | `Tray` + close-to-tray；后台继续跑 goal rounds / 任务看板；托盘菜单：显示/新建会话/暂停/退出 | **P0** |
| 2 | **后台不被节流** | 后台标签页被 Chromium timer/渲染节流，SSE 流不稳定 | `webPreferences.backgroundThrottling: false`，窗口隐藏/最小化也全速 | **P0** |
| 3 | **原生通知** | `Notification` API 需权限、后台被抑制 | `Notification`（Windows Toast / macOS 通知中心），最小化也弹：任务完成、cron 触发、审批请求 | **P0** |
| 4 | **真实文件路径（拖放 + 原生对话框）** | 拖文件进网页只能拿到 Blob，**丢路径**；无法选文件夹 | `webUtils.getPathForFile` + `dialog.showOpenDialog`（文件/文件夹选择、保存框）→ 真实路径交给 agent 工具 | **P0** |
| 5 | **退出保护** | 关标签 = 丢弃视图，服务还在但你管不到 | 关窗最小化到托盘；真退出前检查运行中任务并确认 | **P0** |
| 6 | **免系统 Node 依赖** | ——（桌面壳自身硬伤） | `ELECTRON_RUN_AS_NODE` 用 Electron 内置 Node 跑 dsh（已实测可行） | **P0** |
| 7 | **原生菜单** | 无 | `Menu` 完整菜单（编辑/粘贴快捷键、最近会话、开发者工具） | P1 |
| 8 | **安全凭证存储** | API key / SSH 密码只能明文 config 或 localStorage | `safeStorage`：Windows DPAPI / macOS Keychain 加密存储 | P1 |
| 9 | **全局快捷键** | 浏览器无法注册系统级热键 | `globalShortcut`：唤出窗口、一键截图、PTT 式快捷指令 | P1 |
| 10 | **剪贴板全格式** | `navigator.clipboard` 权限受限、无图片/自定义格式 | `clipboard` 完整读写（文本/图片/RTF/HTML） | P1 |
| 11 | **屏幕捕获（agent 看屏幕）** | 浏览器无法截取其他应用窗口 | `desktopCapturer` 截屏 → 喂给多模态模型 → 桌面自动化、UI 巡检、远程协助 | P1 |
| 12 | **任务栏进度/角标** | 不可能 | `setProgressBar`（agent 运行中显示进度）/ `setBadgeCount` | P2 |
| 13 | **电源/锁屏事件** | 不可能 | `powerMonitor` sleep/lock 事件 → 挂起/恢复长任务与调度，配合"错过的 cron 不补跑"语义 | P2 |
| 14 | **开机自启 + 自动更新** | 不可能 | `setLoginItemSettings` + `electron-updater`（推送新版本 harness） | P2 |
| 15 | **深链 / 协议注册 / 文件关联** | 不可能 | `setAsDefaultProtocolClient('dsh')` → `dsh://session/<id>` 从浏览器/命令行直达会话；`.dshsession` 文件双击打开 | P2 |
| 16 | **多窗口 / 钉置顶迷你窗** | 单标签 | 多 `BrowserWindow` 并排多会话；`alwaysOnTop` 迷你窗钉住会话/进度 | P2 |
| 17 | **工作区切换器** | 启动参数固定，切工作区要重启服务 | 托盘菜单切换 `DSH_WORKSPACE` 并热重启 dsh | P2 |

## 2. 技术路径：把能力给到 UI 和 agent

三层，缺一不可：

```
┌─ 渲染进程（dsh Web 应用，sandbox）────────────┐
│  window.dshDesktop.*（contextBridge 暴露）      │
│  + dsh 插件注册的新 agent 工具                  │
└──────────────┬─────────────────────────────────┘
               │ IPC (ipcRenderer.invoke / ipcMain.handle)
┌──────────────▼─────────────────────────────────┐
│  Electron 主进程（electron/main.js 扩展）         │
│  Tray / Notification / dialog / clipboard /      │
│  globalShortcut / desktopCapturer / safeStorage  │
└──────────────┬─────────────────────────────────┘
               │ 子进程（可选：ELECTRON_RUN_AS_NODE）
┌──────────────▼─────────────────────────────────┐
│  dsh web（agent 运行时，端口 3080）              │
└────────────────────────────────────────────────┘
```

1. **新增 `electron/preload.js`**：`contextBridge.exposeInMainWorld('dshDesktop', {...})`。
   sandbox 化 preload 仍可用 `require('electron')` 的子集（`contextBridge` / `ipcRenderer` / `webUtils`），不破坏现有安全模型。
2. **主进程 `ipcMain.handle`**：实现各能力，`event.senderFrame` 校验只接受本窗口调用。
3. **dsh 插件**（web profile 的 patch 层加一个 plugin 包）：把桥能力注册为 agent 新工具（`desktop.notify` / `desktop.pickFolder` / `desktop.screenshot` / `desktop.tray` …），让 **agent 自己**也能用这些能力——这是纯 Web 版彻底做不到的（浏览器沙箱外没有这些 API）。

**最小起步组合拳（P0）**：preload 桥（notify / pickFolder / pickFile / getPathForFile / showWindow / quit）+
托盘常驻 + 退出保护 + `backgroundThrottling: false` + `ELECTRON_RUN_AS_NODE` 去系统 Node 依赖。

## 3. 安全边界（桥是双刃剑）

- IPC handler 一律校验调用来源（仅本窗口、仅白名单 channel）；不要把主进程能力无差别暴露。
- `screenshot` / `clipboard` / `dialog` 等敏感能力：agent 工具需用户确认或单独开关。
- 凭证用 `safeStorage` 加密后再落盘，替代明文 config。
- 保持 `contextIsolation: true`、`sandbox: true` 不变，preload 只暴露窄接口。

## 4. 备注：不改架构也能立刻做的两件事

- 关窗杀进程 → 改为"关窗最小化到托盘"（改 `window-all-closed` / `before-quit` 逻辑即可）。
- 打包体积：目前 `files` 只含 `electron/**`、`assets/**`、`package.json`，dsh 运行时靠 npm 依赖带入；若走 `ELECTRON_RUN_AS_NODE` 可考虑把 dsh 依赖打进 asar，实现真正的绿色单文件体验。
