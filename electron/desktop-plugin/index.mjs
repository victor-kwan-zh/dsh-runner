// dsh 桌面插件：把 Electron 主进程的桌面能力（经 desktop-api 服务）注册为
// agent 工具集 desktop.*。由 Electron 壳通过 `dsh web --patch <file>` 注入；
// 直接手动运行 `dsh web`（无 DSH_DESKTOP_URL）时插件仍可加载，工具调用会
// 报"桌面桥不可用"，不影响其余功能。
import { defineTool } from "@deepseek-ai/dsh-tools";
import { z } from "zod";

const name = "tool-desktop";
const inject = ["tools"];

const Config = z.object({});

const API_URL = process.env.DSH_DESKTOP_URL ?? "";
const API_TOKEN = process.env.DSH_DESKTOP_TOKEN ?? "";

async function callDesktop(method, pathname, body) {
  if (!API_URL) {
    throw new Error("desktop bridge 不可用：当前 dsh 不是由桌面壳启动的（缺少 DSH_DESKTOP_URL）");
  }
  const res = await fetch(`${API_URL}${pathname}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-dsh-token": API_TOKEN,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`desktop bridge 调用失败 ${res.status}: ${text}`);
  }
  return res.json();
}

const genericOutput = { schema: { type: "object", additionalProperties: true } };

function tool({ name, description, parameters, action }) {
  return {
    name,
    description,
    parameters,
    output: genericOutput,
    execute: async (args) => action(args ?? {}),
    presentCall: (args) => ({
      card: "generic",
      title: name,
      kind: "execute",
      rawInput: JSON.stringify(args ?? {}),
      content: [{ type: "text", text: JSON.stringify(args ?? {}) }],
    }),
    presentResult: (_args, result) => ({
      card: "generic",
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    }),
  };
}

function apply(ctx) {
  const tools = [
    tool({
      name: "desktop_notify",
      description:
        "通过桌面系统通知弹出一条消息（Windows Toast / macOS 通知中心）。适合任务完成、长步骤结束、需要提醒用户关注时使用。",
      parameters: {
        title: { type: "string", description: "通知标题（默认 DeepSeek Harness）" },
        body: { type: "string", required: true, description: "通知正文" },
        silent: { type: "boolean", description: "静默通知（不响铃）" },
      },
      action: (args) => callDesktop("POST", "/notify", args),
    }),

    tool({
      name: "desktop_pick_folder",
      description:
        "弹出原生文件夹选择框，返回用户选择的目录真实路径（用户取消时返回 null）。用于让用户指定一个目录交给任务处理。",
      parameters: {},
      action: () => callDesktop("POST", "/pick-folder", {}),
    }),

    tool({
      name: "desktop_pick_file",
      description:
        "弹出原生文件选择框，返回用户选择的文件真实路径（用户取消时返回 null）。",
      parameters: {
        filters: {
          type: "array",
          description: "可选的文件类型过滤，如 [{name:'Images', extensions:['png','jpg']}]",
        },
      },
      action: (args) => callDesktop("POST", "/pick-file", args),
    }),

    tool({
      name: "desktop_save_file",
      description:
        "弹出原生保存对话框，返回用户确认的保存路径（用户取消时返回 null）。",
      parameters: {
        defaultName: { type: "string", description: "建议的文件名或完整路径" },
        filters: { type: "array", description: "可选的文件类型过滤" },
      },
      action: (args) => callDesktop("POST", "/save-file", args),
    }),

    tool({
      name: "desktop_clipboard_write",
      description: "把文本写入系统剪贴板。",
      parameters: {
        text: { type: "string", required: true, description: "要写入的文本" },
      },
      action: (args) => callDesktop("POST", "/clipboard/write", args),
    }),

    tool({
      name: "desktop_clipboard_read",
      description: "读取系统剪贴板当前文本。",
      parameters: {},
      action: () => callDesktop("GET", "/clipboard/read"),
    }),

    tool({
      name: "desktop_window_show",
      description: "显示并聚焦主窗口（从托盘/后台唤出应用）。",
      parameters: {},
      action: () => callDesktop("POST", "/window/show", {}),
    }),

    tool({
      name: "desktop_window_hide",
      description: "隐藏主窗口到托盘。",
      parameters: {},
      action: () => callDesktop("POST", "/window/hide", {}),
    }),

    tool({
      name: "desktop_window_always_on_top",
      description: "设置主窗口是否钉置顶（alwaysOnTop，迷你窗/悬浮窗场景）。",
      parameters: {
        flag: { type: "boolean", required: true, description: "true 钉置顶，false 取消" },
      },
      action: (args) => callDesktop("POST", "/window/set-always-on-top", args),
    }),

    tool({
      name: "desktop_progress",
      description: "在任务栏图标上显示进度（0~1；传 -1 清除）。适合长任务运行中持续更新进度。",
      parameters: {
        value: { type: "number", required: true, description: "0~1，-1 清除" },
      },
      action: (args) => callDesktop("POST", "/progress", args),
    }),

    tool({
      name: "desktop_screenshot",
      description:
        "截取当前屏幕，保存为 PNG 文件并返回文件路径。可配合多模态模型让 agent 看到屏幕内容（桌面自动化、UI 巡检、远程协助）。",
      parameters: {},
      action: () => callDesktop("POST", "/screenshot", {}),
    }),
  ];

  for (const entry of tools) {
    ctx.tools.register(defineTool(entry));
  }
  console.log(`[desktop-plugin] registered ${tools.length} desktop tools (api=${API_URL || "none"})`);
}

export { apply, inject, name, Config };
