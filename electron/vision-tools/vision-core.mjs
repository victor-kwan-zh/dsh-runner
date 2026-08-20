// 视觉分析核心：图片 → OpenAI 兼容视觉接口（/chat/completions）→ 分析文本。
// 纯函数 + 可注入 fetch，便于单测。支持多家 provider 预设（均走 OpenAI 兼容协议）。
import fs from "node:fs";
import path from "node:path";

/** 内置 provider 预设（OpenAI 兼容）。 */
export const PROVIDER_PRESETS = {
  qwen: {
    label: "通义千问 Qwen-VL（DashScope）",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen-vl-max",
    envKey: "DASHSCOPE_API_KEY",
  },
  doubao: {
    label: "豆包 Doubao-Vision（火山方舟）",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    model: "doubao-seed-1-6-vision-pro",
    envKey: "ARK_API_KEY",
  },
  glm: {
    label: "智谱 GLM-4V",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    model: "glm-4v-plus",
    envKey: "ZHIPU_API_KEY",
  },
  openai: {
    label: "OpenAI GPT-4o",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    envKey: "OPENAI_API_KEY",
  },
  gemini: {
    label: "Google Gemini（OpenAI 兼容端点）",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    model: "gemini-2.5-flash",
    envKey: "GEMINI_API_KEY",
  },
};

const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

/** 按扩展名推断 MIME。 */
export function mimeFor(file) {
  const ext = path.extname(file).toLowerCase();
  switch (ext) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    default:
      return "image/png";
  }
}

/** 读取图片为 data URL（体积守卫）。 */
export function imageToDataUrl(file) {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    throw new Error(`图片不是文件或无法读取：${file}`);
  }
  if (!stat.isFile()) throw new Error(`不是文件：${file}`);
  if (stat.size > MAX_IMAGE_BYTES) {
    throw new Error(`图片过大（${Math.round(stat.size / 1024 / 1024)}MB > 15MB），请压缩或裁剪后重试`);
  }
  const buf = fs.readFileSync(file);
  return `data:${mimeFor(file)};base64,${buf.toString("base64")}`;
}

/**
 * 构造 OpenAI 兼容的 messages 请求体。
 * @param {string} prompt 分析指令
 * @param {string} dataUrl 图片 data URL
 * @param {{maxTokens?: number}} [opts]
 */
export function buildMessages(prompt, dataUrl, opts = {}) {
  return {
    model: opts.model ?? "qwen-vl-max",
    max_tokens: Number.isInteger(opts.maxTokens) && opts.maxTokens > 0 ? opts.maxTokens : 1024,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
  };
}

/**
 * 解析 provider 配置（settings 优先，其次环境变量，其次预设默认）。
 * @param {string} provider preset 名（qwen/doubao/glm/openai/gemini）或自定义 baseURL
 * @param {object} cfg { provider, model, baseUrl, apiKey }
 * @returns {{baseUrl: string, model: string, apiKey: string, label: string}}
 */
export function resolveProvider(provider, cfg = {}) {
  const preset = PROVIDER_PRESETS[provider];
  const env = globalThis.process?.env ?? {};
  const baseUrl = (cfg.baseUrl || preset?.baseUrl || provider).replace(/\/+$/, "");
  const model = cfg.model || preset?.model || "gpt-4o-mini";
  const apiKey = cfg.apiKey || (preset?.envKey ? env[preset.envKey] : undefined) || env.VISION_API_KEY;
  return { baseUrl, model, apiKey, label: preset?.label ?? provider };
}

/**
 * 调用视觉接口分析图片。
 * @param {string} imagePath 图片绝对路径
 * @param {string} prompt 分析指令
 * @param {object} opts { provider, model, baseUrl, apiKey, maxTokens, fetchImpl? }
 * @returns {Promise<{provider: string, model: string, text: string}>}
 */
export async function analyzeImage(imagePath, prompt, opts = {}) {
  if (typeof prompt !== "string" || prompt.trim() === "") {
    throw new Error("analyze 需要 prompt（分析指令）");
  }
  const { baseUrl, model, apiKey, label } = resolveProvider(opts.provider, opts);
  if (!apiKey) {
    throw new Error(
      `缺少 ${label} 的 API Key：请在设置 → dsh-runner 配置，或设置环境变量 VISION_API_KEY（或对应 provider 的 *_API_KEY）`,
    );
  }
  const dataUrl = imageToDataUrl(imagePath);
  const body = buildMessages(prompt, dataUrl, { model, maxTokens: opts.maxTokens });
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new Error("当前环境没有 fetch（Node 18+ 应有）");

  const url = `${baseUrl}/chat/completions`;
  let res;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new Error(`视觉接口请求失败：${error.message}`);
  }
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    /* non-JSON */
  }
  if (!res.ok) {
    const detail = data?.error?.message ?? data?.message ?? text.slice(0, 300);
    throw new Error(`视觉接口错误 ${res.status}：${detail}`);
  }
  const content = data?.choices?.[0]?.message?.content;
  const result = typeof content === "string" ? content : Array.isArray(content) ? content.map((c) => c.text ?? "").join("") : "";
  if (!result) throw new Error("视觉接口返回为空");
  return { provider: label, model, text: result };
}
