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

  /** 护眼模式：内置深绿护眼主题（默认开启），样式见 electron/eye-care.css */
  eyeCare: {
    isActive: () => localStorage.getItem(EYE_CARE_KEY) !== "0",
    setActive: (flag) => {
      localStorage.setItem(EYE_CARE_KEY, flag ? "1" : "0");
      document.documentElement.setAttribute("data-dsh-eye-care", flag ? "1" : "0");
      return flag;
    },
  },
});

// ── 护眼模式：从主进程取样式表注入页面（作用域 html[data-dsh-eye-care]）────

const EYE_CARE_KEY = "dsh.eyeCare";

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
    // 默认开启（localStorage 未设置时视为开启）
    const active = localStorage.getItem(EYE_CARE_KEY) !== "0";
    document.documentElement.setAttribute("data-dsh-eye-care", active ? "1" : "0");
  } catch {
    /* 桥不可用时静默降级（如直接浏览器访问） */
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", applyEyeCare);
} else {
  void applyEyeCare();
}
