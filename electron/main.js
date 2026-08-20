const { app, BrowserWindow, Menu, Tray, Notification, clipboard, dialog, ipcMain, nativeImage, shell } = require("electron");
const { spawn, execFile } = require("node:child_process");
const { promisify } = require("node:util");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const { startDesktopApi } = require("./desktop-api");

const execFileAsync = promisify(execFile);

const PORT = Number(process.env.DSH_PORT || 3080);
const HOST = "127.0.0.1";
const WEB_URL = `http://${HOST}:${PORT}`;
const READY_TIMEOUT_MS = Number(process.env.DSH_READY_TIMEOUT_MS || 180_000);
/** 关窗是否最小化到托盘（0 关闭该行为） */
const CLOSE_TO_TRAY = process.env.DSH_CLOSE_TO_TRAY !== "0";

app.setAppUserModelId("ai.deepseek.harness.desktop");
app.setName("DeepSeek Harness");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const ICON_PNG = path.join(PROJECT_ROOT, "assets", "icon.png");
const ICON_ICO = path.join(PROJECT_ROOT, "assets", "icon.ico");
const ICON_PATH = process.platform === "win32" && fs.existsSync(ICON_ICO) ? ICON_ICO : ICON_PNG;

/** @type {BrowserWindow | null} */
let mainWindow = null;
/** @type {import("electron").Tray | null} */
let tray = null;
/** @type {import("node:child_process").ChildProcess | null} */
let dshProcess = null;
/** 桌面 API 服务（agent 工具的后端），随应用启动/退出 */
let desktopApi = null;
let shuttingDown = false;
/** 用户确认过退出（或系统在退出中）：此时关窗不再拦为托盘 */
let quitting = false;

function workspaceDir() {
  return process.env.DSH_WORKSPACE || PROJECT_ROOT;
}

function iconForWindow() {
  return fs.existsSync(ICON_PATH) ? ICON_PATH : undefined;
}

function spawnEnv() {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith("ELECTRON")) continue;
    env[key] = value;
  }
  env.BROWSER = "none";
  env.DSH_WEB_NO_OPEN = "1";
  // 用 Electron 自带的 Node 跑 dsh，打包后不再依赖系统 Node。
  // 若 DSH_NODE 指向普通 node，该变量会被忽略，无害。
  env.ELECTRON_RUN_AS_NODE = "1";
  // 桌面桥（agent 工具）后端地址与鉴权 token
  if (desktopApi) {
    env.DSH_DESKTOP_URL = desktopApi.url;
    env.DSH_DESKTOP_TOKEN = desktopApi.token;
  }
  return env;
}

function resolveNodeBinary() {
  if (process.env.DSH_NODE && fs.existsSync(process.env.DSH_NODE)) {
    return process.env.DSH_NODE;
  }
  // Electron 内置 Node（22.x，经 ELECTRON_RUN_AS_NODE 生效），
  // 运行/打包产物均无需系统安装 Node.js。
  return process.execPath;
}

function resolveDshBin() {
  const bin = path.join(PROJECT_ROOT, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");
  if (!fs.existsSync(bin)) {
    throw new Error("未找到本地 @deepseek-ai/dsh。请在项目根目录执行 npm install。");
  }
  return bin;
}

function parseListeningPids(netstatOutput, port) {
  const pids = new Set();
  const re = new RegExp(`[:\\[]${port}(?:\\]|\\s).+LISTENING\\s+(\\d+)`, "i");
  for (const line of netstatOutput.split(/\r?\n/)) {
    const match = line.match(re) || line.match(new RegExp(`:${port}\\s+\\S+\\s+LISTENING\\s+(\\d+)`, "i"));
    if (match) pids.add(Number(match[1]));
  }
  return [...pids].filter((pid) => pid > 0);
}

async function pidsOnPort(port) {
  if (process.platform === "win32") {
    try {
      const { stdout } = await execFileAsync("netstat", ["-ano", "-p", "TCP"], { windowsHide: true });
      return parseListeningPids(stdout, port);
    } catch {
      return [];
    }
  }

  try {
    const { stdout } = await execFileAsync("lsof", ["-i", `TCP:${port}`, "-sTCP:LISTEN", "-t"]);
    return stdout
      .split(/\s+/)
      .map((value) => Number(value))
      .filter((pid) => pid > 0);
  } catch {
    return [];
  }
}

async function killPidTree(pid) {
  if (!pid || pid === process.pid) return;
  if (process.platform === "win32") {
    await execFileAsync("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true }).catch(() => {});
    return;
  }
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      /* already gone */
    }
  }
}

function canBind(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen(port, HOST, () => {
      server.close(() => resolve(true));
    });
  });
}

async function killPort(port) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const pids = await pidsOnPort(port);
    if (pids.length > 0) {
      await Promise.all(pids.map((pid) => killPidTree(pid)));
      await wait(250);
      continue;
    }
    if (await canBind(port)) return;
    await wait(250);
  }
  throw new Error(`无法释放端口 ${port}，请手动结束后再试`);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function probeWeb(url) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: 1500 }, (res) => {
      res.resume();
      resolve(res.statusCode !== undefined && res.statusCode < 500);
    });
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.on("error", () => resolve(false));
  });
}

async function waitUntilReady(url, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (shuttingDown) throw new Error("已取消启动");
    if (dshProcess && dshProcess.exitCode !== null) {
      throw new Error(`dsh web 提前退出，退出码 ${dshProcess.exitCode}`);
    }
    if (await probeWeb(url)) return;
    await wait(400);
  }
  throw new Error(`等待 ${url} 超时（${Math.round(timeoutMs / 1000)}s）`);
}

function appendLog(chunk) {
  const logFile = path.join(app.getPath("userData"), "dsh.log");
  try {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.appendFileSync(logFile, chunk);
  } catch {
    /* ignore log IO errors */
  }
}

function setSplashStatus(message, isError = false) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const script = `
    (() => {
      const status = document.getElementById("status");
      const hint = document.getElementById("hint");
      if (status) {
        status.textContent = ${JSON.stringify(message)};
        status.classList.toggle("error", ${isError ? "true" : "false"});
      }
      const spinner = document.querySelector(".spinner");
      if (spinner) spinner.style.visibility = ${isError ? '"hidden"' : '"visible"'};
      if (hint && ${isError ? "true" : "false"}) {
        hint.textContent = "日志：%APPDATA%\\\\DeepSeek Harness\\\\dsh.log";
      }
    })()
  `;
  mainWindow.webContents.executeJavaScript(script).catch(() => {});
}

// ── 桌面桥：页面（window.dshDesktop）→ IPC → 主进程 ────────────────────────

function isTrustedSender(event) {
  const url = event.senderFrame?.url ?? "";
  return (
    url.startsWith(WEB_URL) ||
    url.startsWith(`http://localhost:${PORT}`) ||
    url.startsWith("file:")
  );
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

async function requestQuit() {
  if (quitting || shuttingDown) return;
  const options = {
    type: "question",
    buttons: ["退出", "取消"],
    defaultId: 1,
    cancelId: 1,
    title: "退出 DeepSeek Harness",
    message: "确定要退出吗？",
    detail: "退出将停止 dsh web 服务与正在运行的后台任务。",
  };
  const result =
    mainWindow && !mainWindow.isDestroyed()
      ? await dialog.showMessageBox(mainWindow, options)
      : await dialog.showMessageBox(options);
  if (result.response === 0) app.quit();
}

function registerDesktopIpc() {
  const handlers = {
    "desktop:notify": (_event, payload = {}) => {
      if (!Notification.isSupported()) return false;
      new Notification({
        title: String(payload.title ?? "DeepSeek Harness"),
        body: String(payload.body ?? ""),
        silent: Boolean(payload.silent),
      }).show();
      return true;
    },

    "desktop:pickFile": async (_event, opts = {}) => {
      const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
      const result = win
        ? await dialog.showOpenDialog(win, { properties: ["openFile"], ...opts })
        : await dialog.showOpenDialog({ properties: ["openFile"], ...opts });
      return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];
    },

    "desktop:pickFolder": async (_event, opts = {}) => {
      const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
      const result = win
        ? await dialog.showOpenDialog(win, { properties: ["openDirectory"], ...opts })
        : await dialog.showOpenDialog({ properties: ["openDirectory"], ...opts });
      return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];
    },

    "desktop:saveFile": async (_event, opts = {}) => {
      const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
      const result = win
        ? await dialog.showSaveDialog(win, opts)
        : await dialog.showSaveDialog(opts);
      return result.canceled || !result.filePath ? null : result.filePath;
    },

    "desktop:clipboard:readText": () => clipboard.readText(),
    "desktop:clipboard:writeText": (_event, text) => {
      clipboard.writeText(String(text ?? ""));
      return true;
    },

    "desktop:window:show": () => {
      showMainWindow();
      return true;
    },
    "desktop:window:hide": () => {
      mainWindow?.hide();
      return true;
    },
    "desktop:window:minimize": () => {
      mainWindow?.minimize();
      return true;
    },
    "desktop:window:setAlwaysOnTop": (_event, flag) => {
      mainWindow?.setAlwaysOnTop(Boolean(flag));
      return true;
    },

    "desktop:setProgressBar": (_event, progress) => {
      if (typeof progress === "number") {
        mainWindow?.setProgressBar(progress < 0 ? -1 : Math.min(1, progress));
      }
      return true;
    },

    "desktop:quit": () => {
      void requestQuit();
      return true;
    },

    "desktop:eye-care:css": () => {
      // 返回内置护眼模式样式表（preload 注入页面）
      try {
        return fs.readFileSync(path.join(__dirname, "eye-care.css"), "utf8");
      } catch {
        return "";
      }
    },
  };

  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, async (event, payload) => {
      if (!isTrustedSender(event)) return undefined;
      return handler(event, payload);
    });
  }
}

// ── 托盘 ───────────────────────────────────────────────────────────────────

function createTray() {
  if (!fs.existsSync(ICON_PATH)) return;
  const icon = nativeImage.createFromPath(ICON_PATH);
  tray = new Tray(icon);
  tray.setToolTip("DeepSeek Harness");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "显示主窗口", click: showMainWindow },
      { label: "隐藏主窗口", click: () => mainWindow?.hide() },
      { type: "separator" },
      { label: "退出", click: () => void requestQuit() },
    ]),
  );
  tray.on("click", showMainWindow);
  tray.on("double-click", showMainWindow);
}

// ── dsh 子进程 ─────────────────────────────────────────────────────────────

async function startDsh() {
  setSplashStatus(`正在释放 ${PORT} 端口…`);
  await killPort(PORT);

  const nodeBin = resolveNodeBinary();
  const dshBin = resolveDshBin();
  const cwd = workspaceDir();

  // 生成注入插件的 patch 层（file:// URL 引用本地插件，dsh 无需改动）
  const patchArgs = [];
  try {
    const { pathToFileURL } = require("node:url");
    const pluginUrl = pathToFileURL(path.join(__dirname, "desktop-plugin", "index.mjs")).href;
    const gitPluginUrl = pathToFileURL(path.join(__dirname, "git-tools", "index.mjs")).href;
    const patchFile = path.join(app.getPath("userData"), "desktop.patch.yml");
    fs.writeFileSync(
      patchFile,
      [
        "- insert:",
        `    - id: desktop-tools`,
        `      name: '${pluginUrl}'`,
        `      config: {}`,
        `    - id: git-tools`,
        `      name: '${gitPluginUrl}'`,
        `      config: {}`,
        "",
      ].join("\n"),
      "utf8",
    );
    patchArgs.push("--patch", patchFile);
  } catch (error) {
    appendLog(`\n[desktop-plugin] patch 写入失败：${error.message}\n`);
  }

  setSplashStatus("正在启动 dsh web…");
  appendLog(`\n[${new Date().toISOString()}] ${nodeBin} ${dshBin} web --host ${HOST} --port ${PORT} ${patchArgs.join(" ")}\ncwd=${cwd}\n`);

  dshProcess = spawn(
    nodeBin,
    // --patch 必须排在 --host/--port 之前：launcher 的 web 子命令
    // enablePositionalOptions，遇到位置参数后不再识别选项；而 web 应用
    // 自身的解析器不认识 --patch，所以它必须在启动器层被消费。
    [dshBin, "web", ...patchArgs, "--host", HOST, "--port", String(PORT)],
    {
      cwd,
      env: spawnEnv(),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      detached: process.platform !== "win32",
    },
  );

  dshProcess.stdout?.on("data", (buf) => appendLog(buf.toString("utf8")));
  dshProcess.stderr?.on("data", (buf) => appendLog(buf.toString("utf8")));
  dshProcess.on("error", (error) => appendLog(`\nspawn error: ${error.stack || error.message}\n`));
  dshProcess.on("exit", (code, signal) => {
    appendLog(`\n[${new Date().toISOString()}] dsh exit code=${code} signal=${signal}\n`);
    if (!shuttingDown && mainWindow && !mainWindow.isDestroyed()) {
      setSplashStatus(`dsh web 已退出（code=${code ?? "null"}）`, true);
    }
  });

  await waitUntilReady(WEB_URL, READY_TIMEOUT_MS);
}

async function stopDsh() {
  const child = dshProcess;
  dshProcess = null;
  if (child?.pid) await killPidTree(child.pid);
  await killPort(PORT);
}

// ── 窗口 ───────────────────────────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    title: "DeepSeek Harness",
    icon: iconForWindow(),
    backgroundColor: "#000000",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // 后台/隐藏时不做 timer 与渲染节流，agent 流式输出与长任务更稳
      backgroundThrottling: false,
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // 关窗 → 最小化到托盘（用户确认退出时不再拦截）
  mainWindow.on("close", (event) => {
    if (quitting || shuttingDown || !CLOSE_TO_TRAY) return;
    event.preventDefault();
    mainWindow.hide();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(WEB_URL) || url.startsWith(`http://localhost:${PORT}`)) {
      return { action: "allow" };
    }
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    const allowed = url.startsWith(WEB_URL) || url.startsWith(`http://localhost:${PORT}`) || url.startsWith("file:");
    if (!allowed) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "应用",
        submenu: [
          { label: "刷新", role: "reload" },
          { label: "开发者工具", role: "toggleDevTools" },
          { type: "separator" },
          { label: "退出", click: () => void requestQuit() },
        ],
      },
      {
        label: "编辑",
        submenu: [
          { label: "撤销", role: "undo" },
          { label: "重做", role: "redo" },
          { type: "separator" },
          { label: "剪切", role: "cut" },
          { label: "复制", role: "copy" },
          { label: "粘贴", role: "paste" },
          { label: "全选", role: "selectAll" },
        ],
      },
      {
        label: "视图",
        submenu: [
          { label: "实际大小", role: "resetZoom" },
          { label: "放大", role: "zoomIn" },
          { label: "缩小", role: "zoomOut" },
          { type: "separator" },
          { label: "全屏", role: "togglefullscreen" },
        ],
      },
    ]),
  );

  return mainWindow.loadFile(path.join(__dirname, "splash.html"));
}

// ── 启动 ───────────────────────────────────────────────────────────────────

async function boot() {
  registerDesktopIpc();
  createTray();
  await createWindow();
  try {
    desktopApi = await startDesktopApi({
      getWindow: () => mainWindow,
      logger: appendLog,
      screenshotsDir: path.join(app.getPath("userData"), "screenshots"),
    });
    await startDsh();
    if (!mainWindow || mainWindow.isDestroyed()) return;
    setSplashStatus("正在打开界面…");
    await mainWindow.loadURL(WEB_URL);

    // 冒烟自检：桥是否注入成功（结果写入日志）
    try {
      const hasBridge = await mainWindow.webContents.executeJavaScript("typeof window.dshDesktop");
      appendLog(`\n[bridge] window.dshDesktop: ${hasBridge}\n`);
    } catch (error) {
      appendLog(`\n[bridge] check failed: ${error instanceof Error ? error.message : String(error)}\n`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    appendLog(`\nboot failed: ${message}\n`);
    setSplashStatus(message, true);
    if (mainWindow && !mainWindow.isDestroyed()) {
      dialog.showErrorBox("DeepSeek Harness 启动失败", message);
    }
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    showMainWindow();
  });

  app.whenReady().then(boot);

  app.on("window-all-closed", () => {
    // 托盘常驻：所有窗口关闭后应用继续在后台运行（退出时 quitting=true 才真正退出）
    if (quitting) app.quit();
  });

  app.on("before-quit", (event) => {
    if (shuttingDown) return;
    event.preventDefault();
    quitting = true;
    shuttingDown = true;
    stopDsh()
      .catch((error) => appendLog(`\nstop failed: ${error instanceof Error ? error.stack : error}\n`))
      .finally(async () => {
        if (desktopApi) {
          await desktopApi.close().catch(() => {});
          desktopApi = null;
        }
        app.exit(0);
      });
  });
}
