const { app, BrowserWindow, Menu, shell, dialog } = require("electron");
const { spawn, execFile } = require("node:child_process");
const { promisify } = require("node:util");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");

const execFileAsync = promisify(execFile);

const PORT = Number(process.env.DSH_PORT || 3080);
const HOST = "127.0.0.1";
const WEB_URL = `http://${HOST}:${PORT}`;
const READY_TIMEOUT_MS = Number(process.env.DSH_READY_TIMEOUT_MS || 180_000);

app.setAppUserModelId("ai.deepseek.harness.desktop");
app.setName("DeepSeek Harness");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const ICON_PNG = path.join(PROJECT_ROOT, "assets", "icon.png");
const ICON_ICO = path.join(PROJECT_ROOT, "assets", "icon.ico");
const ICON_PATH = process.platform === "win32" && fs.existsSync(ICON_ICO) ? ICON_ICO : ICON_PNG;

/** @type {BrowserWindow | null} */
let mainWindow = null;
/** @type {import("node:child_process").ChildProcess | null} */
let dshProcess = null;
let shuttingDown = false;

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
  return env;
}

function resolveNodeBinary() {
  if (process.env.DSH_NODE && fs.existsSync(process.env.DSH_NODE)) {
    return process.env.DSH_NODE;
  }

  const which = process.platform === "win32" ? "where" : "which";
  try {
    const stdout = require("node:child_process").execFileSync(which, ["node"], {
      encoding: "utf8",
      windowsHide: true,
    });
    const first = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line && !line.toLowerCase().includes("windowsapps"));
    if (first && fs.existsSync(first)) return first;
  } catch {
    /* fall through */
  }

  const fallbacks =
    process.platform === "win32"
      ? ["C:\\Program Files\\nodejs\\node.exe", "C:\\Program Files (x86)\\nodejs\\node.exe"]
      : ["/usr/local/bin/node", "/usr/bin/node"];
  const found = fallbacks.find((candidate) => fs.existsSync(candidate));
  if (found) return found;

  throw new Error("未找到 Node.js。请安装 Node.js 20+ 并确保 node 在 PATH 中。");
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

async function startDsh() {
  setSplashStatus(`正在释放 ${PORT} 端口…`);
  await killPort(PORT);

  const nodeBin = resolveNodeBinary();
  const dshBin = resolveDshBin();
  const cwd = workspaceDir();

  setSplashStatus("正在启动 dsh web…");
  appendLog(`\n[${new Date().toISOString()}] ${nodeBin} ${dshBin} web --host ${HOST} --port ${PORT}\ncwd=${cwd}\n`);

  dshProcess = spawn(nodeBin, [dshBin, "web", "--host", HOST, "--port", String(PORT)], {
    cwd,
    env: spawnEnv(),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    detached: process.platform !== "win32",
  });

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
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
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
          { role: "reload", label: "刷新" },
          { role: "toggleDevTools", label: "开发者工具" },
          { type: "separator" },
          { role: "quit", label: "退出" },
        ],
      },
    ]),
  );

  return mainWindow.loadFile(path.join(__dirname, "splash.html"));
}

async function boot() {
  await createWindow();
  try {
    await startDsh();
    if (!mainWindow || mainWindow.isDestroyed()) return;
    setSplashStatus("正在打开界面…");
    await mainWindow.loadURL(WEB_URL);
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
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(boot);

  app.on("window-all-closed", () => {
    app.quit();
  });

  app.on("before-quit", (event) => {
    if (shuttingDown) return;
    event.preventDefault();
    shuttingDown = true;
    stopDsh()
      .catch((error) => appendLog(`\nstop failed: ${error instanceof Error ? error.stack : error}\n`))
      .finally(() => app.exit(0));
  });
}
