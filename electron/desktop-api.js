// 桌面 API 服务：运行在 Electron 主进程内的本地 HTTP 服务（仅 127.0.0.1），
// 供 dsh 子进程里的 desktop 插件（agent 工具）调用托盘/通知/对话框/剪贴板/
// 窗口控制/截屏等桌面能力。带 token 鉴权（x-dsh-token 头）。
const http = require("node:http");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { dialog, clipboard, Notification, desktopCapturer } = require("electron");

function readJson(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1e6) req.destroy();
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        resolve({});
      }
    });
    req.on("error", () => resolve({}));
  });
}

async function captureScreenTo(screenshotsDir) {
  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: { width: 1920, height: 1080 },
  });
  const source = sources[0];
  if (!source) throw new Error("未找到可截取的屏幕");
  fs.mkdirSync(screenshotsDir, { recursive: true });
  const file = path.join(screenshotsDir, `screenshot-${Date.now()}.png`);
  fs.writeFileSync(file, source.thumbnail.toPNG());
  return file;
}

/**
 * 启动桌面 API 服务。
 * @param {object} options
 * @param {() => import("electron").BrowserWindow | null | undefined} options.getWindow 主窗口获取器
 * @param {(line: string) => void} [options.logger] 日志回调
 * @param {string} [options.screenshotsDir] 截屏保存目录（默认系统临时目录）
 * @returns {Promise<{url: string, token: string, close: () => Promise<void>}>}
 */
function startDesktopApi({ getWindow, logger, screenshotsDir }) {
  const token = crypto.randomBytes(16).toString("hex");
  const shotsDir = screenshotsDir || path.join(os.tmpdir(), "dsh-desktop");
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const send = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };

    // 健康检查免鉴权（供壳与插件探活）
    if (url.pathname === "/health" && req.method === "GET") {
      return send(200, { ok: true });
    }
    if (req.headers["x-dsh-token"] !== token) {
      return send(401, { error: "unauthorized" });
    }

    try {
      const payload = req.method === "GET" ? {} : await readJson(req);
      const win = getWindow?.() ?? null;
      const pick = async (opts) => {
        const result = win
          ? await dialog.showOpenDialog(win, opts)
          : await dialog.showOpenDialog(opts);
        return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];
      };

      switch (`${req.method} ${url.pathname}`) {
        case "POST /notify": {
          if (Notification.isSupported()) {
            new Notification({
              title: String(payload.title ?? "DeepSeek Harness"),
              body: String(payload.body ?? ""),
              silent: Boolean(payload.silent),
            }).show();
          }
          return send(200, { ok: true });
        }

        case "POST /pick-file":
          return send(200, {
            path: await pick({
              properties: ["openFile"],
              ...(payload.filters ? { filters: payload.filters } : {}),
            }),
          });

        case "POST /pick-folder":
          return send(200, { path: await pick({ properties: ["openDirectory"] }) });

        case "POST /save-file": {
          const opts = {};
          if (payload.defaultName) {
            const name = String(payload.defaultName);
            opts.defaultPath = path.isAbsolute(name) ? name : path.join(os.homedir(), name);
          }
          if (payload.filters) opts.filters = payload.filters;
          const result = win
            ? await dialog.showSaveDialog(win, opts)
            : await dialog.showSaveDialog(opts);
          return send(200, { path: result.canceled || !result.filePath ? null : result.filePath });
        }

        case "GET /clipboard/read":
          return send(200, { text: clipboard.readText() });

        case "POST /clipboard/write":
          clipboard.writeText(String(payload.text ?? ""));
          return send(200, { ok: true });

        case "POST /window/show":
          if (win) {
            if (win.isMinimized()) win.restore();
            win.show();
            win.focus();
          }
          return send(200, { ok: true });

        case "POST /window/hide":
          win?.hide();
          return send(200, { ok: true });

        case "POST /window/minimize":
          win?.minimize();
          return send(200, { ok: true });

        case "POST /window/set-always-on-top":
          win?.setAlwaysOnTop(Boolean(payload.flag));
          return send(200, { ok: true });

        case "POST /progress":
          if (win && typeof payload.value === "number") {
            win.setProgressBar(payload.value < 0 ? -1 : Math.min(1, payload.value));
          }
          return send(200, { ok: true });

        case "POST /screenshot": {
          const file = await captureScreenTo(shotsDir);
          return send(200, { path: file });
        }

        default:
          return send(404, { error: "not found" });
      }
    } catch (error) {
      return send(500, { error: error instanceof Error ? error.message : String(error) });
    }
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      const base = `http://127.0.0.1:${port}`;
      logger?.(`\n[desktop-api] listening on ${base}\n`);
      // 调试模式才打印 token（默认不落盘敏感信息）
      if (process.env.DSH_DESKTOP_DEBUG === "1") {
        logger?.(`[desktop-api] token=${token}\n`);
      }
      resolve({
        url: base,
        token,
        close: () =>
          new Promise((done) => {
            server.close(() => done());
          }),
      });
    });
  });
}

module.exports = { startDesktopApi };
