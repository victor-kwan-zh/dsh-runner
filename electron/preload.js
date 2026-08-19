// Preload: 把受控的桌面能力桥暴露给页面（window.dshDesktop）。
// 渲染进程保持 sandbox + contextIsolation，只通过白名单 IPC channel 与主进程通信。
const { contextBridge, ipcRenderer, webUtils } = require("electron");

const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);

contextBridge.exposeInMainWorld("dshDesktop", {
  /** 恒为 true，页面可据此识别桌面环境 */
  isDesktop: true,
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
  },

  /** 弹系统通知（Windows Toast / macOS 通知中心） */
  notify: (title, body, opts) =>
    invoke("desktop:notify", { title, body, ...(opts ?? {}) }),

  /** 原生打开文件选择框，返回真实路径或 null */
  pickFile: (opts) => invoke("desktop:pickFile", opts),
  /** 原生打开文件夹选择框，返回真实路径或 null */
  pickFolder: (opts) => invoke("desktop:pickFolder", opts),
  /** 原生保存对话框，返回目标路径或 null */
  saveFile: (opts) => invoke("desktop:saveFile", opts),
  /** 拖放进窗口的 File 对象 → 真实磁盘路径（拖拽不丢路径的关键） */
  getPathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return "";
    }
  },

  clipboard: {
    readText: () => invoke("desktop:clipboard:readText"),
    writeText: (text) => invoke("desktop:clipboard:writeText", text),
  },

  window: {
    show: () => invoke("desktop:window:show"),
    hide: () => invoke("desktop:window:hide"),
    minimize: () => invoke("desktop:window:minimize"),
    /** 钉置顶（迷你窗） */
    setAlwaysOnTop: (flag) => invoke("desktop:window:setAlwaysOnTop", !!flag),
  },

  /** 任务栏进度：0..1，-1 清除 */
  setProgressBar: (progress) => invoke("desktop:setProgressBar", progress),

  /** 请求退出应用（会走退出确认） */
  quit: () => invoke("desktop:quit"),
});

// ── 护眼模式：注入样式表（作用域 html[data-dsh-eye-care]）─────────────────
// 开关由 dsh 设置「外观 → 护眼」驱动（ui-theme.preference = "eye-care"，
// 见 scripts/patch-theme-eye-care.cjs）。host 的 boot 脚本会把
// data-dsh-eye-care 盖在 <body> 上，这里在 DOM 就绪后镜像到 <html>，
// 激活本 preload 注入的样式（覆盖客户端主题激活前的启动区间）。

async function applyEyeCare() {
  try {
    const css = await invoke("desktop:eye-care:css");
    if (!css) return;
    let style = document.getElementById("dsh-eye-care-style");
    if (!style) {
      style = document.createElement("style");
      style.id = "dsh-eye-care-style";
      document.head.appendChild(style);
    }
    style.textContent = css;
    document.documentElement.setAttribute(
      "data-dsh-eye-care",
      document.body.hasAttribute("data-dsh-eye-care") ? "1" : "0",
    );
  } catch {
    /* 桥不可用时静默降级（如直接浏览器访问） */
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", applyEyeCare);
} else {
  void applyEyeCare();
}
