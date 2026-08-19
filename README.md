# dsh-runner — DeepSeek Harness 桌面版

用 Electron 将 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）的本地 Web 界面封装为桌面应用：应用启动时自动拉起 `dsh web` 服务（默认 `http://127.0.0.1:3080`），并在原生窗口内渲染。项目同时承载桌面能力扩展（托盘、通知、原生对话框等）的演进路线。

## 特性

- 一键启动：自动拉起 `dsh web`，等待就绪后加载界面，无需手动开浏览器
- 端口管理：启动前自动清理端口占用；退出时回收本次拉起的进程树
- 单实例锁：重复启动时聚焦已有窗口
- 启动画面：带状态提示与错误日志指引（`%APPDATA%\DeepSeek Harness\dsh.log`）
- 启动失败兜底：弹窗提示原因
- 内置 dsh 运行时：`@deepseek-ai/dsh` 作为 npm 依赖随项目安装
- Windows 打包：NSIS 安装包 + portable 绿色版（`npm run dist`）

## 环境要求

- **Node.js 20+**（当前运行与打包均通过系统 `node` 拉起 dsh；后续计划改用 Electron 内置 Node，消除该依赖，见 `DESKTOP-CAPABILITIES.md`）
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

## 配置（环境变量）

| 变量 | 默认 | 说明 |
|---|---|---|
| `DSH_PORT` | `3080` | dsh web 监听端口 |
| `DSH_WORKSPACE` | 项目根目录 | dsh 的工作区目录 |
| `DSH_READY_TIMEOUT_MS` | `180000` | 等待 dsh web 就绪的超时（毫秒） |
| `DSH_NODE` | 自动探测 | 指定用于拉起 dsh 的 Node 可执行文件路径 |
| `DSH_WEB_NO_OPEN` | `1`（由壳设置） | 禁止 dsh 自动打开浏览器 |

## 日志

- Windows：`%APPDATA%\DeepSeek Harness\dsh.log`
- 包含 dsh 子进程的 stdout/stderr 与启动/退出记录

## 目录结构

```
├── electron/
│   ├── main.js         # Electron 主进程：进程管理、窗口、生命周期
│   └── splash.html     # 启动画面
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
