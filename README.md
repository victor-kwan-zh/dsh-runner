# dsh-runner — DeepSeek Harness 桌面版

用 Electron 将 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）的本地 Web 界面封装为桌面应用：应用启动时自动拉起 `dsh web` 服务（默认 `http://127.0.0.1:3080`），并在原生窗口内渲染。项目同时承载桌面能力扩展（托盘、通知、原生对话框等）的演进路线。

## 特性

- 一键启动：自动拉起 `dsh web`，等待就绪后加载界面，无需手动开浏览器
- 端口管理：启动前自动清理端口占用；退出时回收本次拉起的进程树
- 单实例锁：重复启动时聚焦已有窗口
- 启动画面：带状态提示与错误日志指引（`%APPDATA%\DeepSeek Harness\dsh.log`）
- 启动失败兜底：弹窗提示原因
- 内置 dsh 运行时：`@deepseek-ai/dsh` 作为 npm 依赖随项目安装
- 免系统 Node：dsh 由 Electron 内置 Node 拉起（`ELECTRON_RUN_AS_NODE`），打包产物运行时无需安装 Node.js
- 托盘常驻：关窗最小化到托盘，后台继续运行；退出前弹窗确认，防止误杀后台任务
- 后台不节流：`backgroundThrottling: false`，窗口隐藏时 agent 流式输出与长任务依然稳定
- 桌面桥：页面可调用 `window.dshDesktop.*`（原生通知 / 文件选择 / 剪贴板 / 窗口控制等，见下文）
- Agent 桌面工具：dsh 的 agent 获得 `desktop.*` 工具集（系统通知、选文件夹、截屏等，见下文）
- Windows 打包：NSIS 安装包 + portable 绿色版（`npm run dist`）

## 环境要求

- **Node.js 20+**：仅开发与构建需要（`npm install` / `npm start` / `npm run dist`）；**运行打包后的应用无需安装 Node.js**——dsh 由 Electron 内置 Node（`ELECTRON_RUN_AS_NODE`）拉起
- npm

## 快速开始

```bash
npm install
npm start
```

## 打包（Windows）

```bash
npm run dist
```

产物输出到 `release/`：`DeepSeek Harness Setup <version>.exe`（NSIS 安装包）与 portable 版本。

> **原生模块构建说明**：node-pty 的 `binding.gyp` 默认请求 Spectre 缓解（MSB8040），
> 若本机 VS 工具链未安装 "Spectre-mitigated libraries" 组件会编译失败。
> 项目通过 `postinstall`（`scripts/patch-node-pty.cjs`）自动把该选项关闭，`npm install` 后即可直接打包。

## 配置（环境变量）

| 变量 | 默认 | 说明 |
|---|---|---|
| `DSH_PORT` | `3080` | dsh web 监听端口 |
| `DSH_WORKSPACE` | 项目根目录 | dsh 的工作区目录 |
| `DSH_READY_TIMEOUT_MS` | `180000` | 等待 dsh web 就绪的超时（毫秒） |
| `DSH_NODE` | 自动探测 | 指定用于拉起 dsh 的 Node 可执行文件路径（默认用 Electron 内置 Node） |
| `DSH_WEB_NO_OPEN` | `1`（由壳设置） | 禁止 dsh 自动打开浏览器 |
| `DSH_CLOSE_TO_TRAY` | `1` | 关窗是否最小化到托盘；设为 `0` 则关窗直接退出 |

## 桌面桥 API（window.dshDesktop）

页面（dsh Web 界面）通过 preload 注入的 `window.dshDesktop` 调用桌面能力——Electron 能力的唯一入口，白名单 IPC channel + sender 校验，渲染进程仍保持 `sandbox + contextIsolation`：

| API | 说明 |
|---|---|
| `notify(title, body)` | 弹系统通知（Windows Toast / macOS 通知中心） |
| `pickFile(opts)` / `pickFolder(opts)` / `saveFile(opts)` | 原生对话框，返回真实路径或 `null` |
| `getPathForFile(file)` | 拖放进窗口的 `File` → 真实磁盘路径（拖拽不丢路径） |
| `clipboard.readText()` / `writeText(text)` | 剪贴板读写 |
| `window.show()` / `hide()` / `minimize()` / `setAlwaysOnTop(flag)` | 窗口控制（钉置顶迷你窗） |
| `setProgressBar(0..1)` | 任务栏进度（`-1` 清除） |
| `quit()` | 请求退出（走退出确认） |
| `isDesktop` / `platform` / `versions` | 桌面环境识别 |

实现：`electron/preload.js`（`contextBridge` 暴露）+ `electron/main.js`（`ipcMain.handle` 白名单通道）。

## Agent 桌面工具（desktop.*）

桌面壳启动 dsh 时通过 `--patch` 注入桌面插件（`electron/desktop-plugin/`），把 Electron 主进程的桌面能力注册为 **agent 工具**——agent 自己也能用桌面功能（纯 Web 版做不到）。工具经本地桌面 API 服务（`electron/desktop-api.js`，仅 127.0.0.1 + token 鉴权）调用：

| 工具 | 说明 |
|---|---|
| `desktop_notify` | 弹系统通知（任务完成提醒） |
| `desktop_pick_folder` / `desktop_pick_file` / `desktop_save_file` | 原生对话框，返回用户选择的真实路径 |
| `desktop_clipboard_read` / `desktop_clipboard_write` | 剪贴板读写 |
| `desktop_window_show` / `hide` / `always_on_top` | 窗口控制（从托盘唤出 / 钉置顶） |
| `desktop_progress` | 任务栏进度（0~1，-1 清除） |
| `desktop_screenshot` | 截屏保存为 PNG 并返回路径（配合多模态模型让 agent"看"屏幕） |

手动直接运行 `dsh web`（不经桌面壳）时这些工具不可用，调用会提示"桌面桥不可用"，不影响其他功能。

## 日志

- Windows：`%APPDATA%\DeepSeek Harness\dsh.log`
- 包含 dsh 子进程的 stdout/stderr 与启动/退出记录

## 目录结构

```
├── electron/
│   ├── main.js               # Electron 主进程：进程管理、窗口、托盘、IPC、生命周期
│   ├── preload.js            # 桌面桥：contextBridge 暴露 window.dshDesktop
│   ├── desktop-api.js        # 本地 API 服务（agent 工具后端，token 鉴权）
│   ├── desktop-plugin/       # dsh 桌面插件：注册 desktop.* agent 工具（--patch 注入）
│   └── splash.html           # 启动画面
├── assets/             # 应用图标（icon.ico 由 scripts/png-to-ico.js 从 icon-256.png 生成）
├── scripts/
│   └── png-to-ico.js   # PNG → ICO 生成脚本
├── package.json        # 桌面壳依赖与打包配置
├── DESKTOP-CAPABILITIES.md  # 桌面能力蓝图：纯 Web 限制 → Electron 解锁的功能清单与路线
└── README.md
```

## 桌面能力路线图

当前桌面版是"浏览器壳"形态；Electron 可解锁的托盘常驻、原生通知、真实文件路径、安全凭证存储、屏幕捕获、全局快捷键等能力清单与落地路径，见 [DESKTOP-CAPABILITIES.md](./DESKTOP-CAPABILITIES.md)。

## License

[MIT](./LICENSE)
