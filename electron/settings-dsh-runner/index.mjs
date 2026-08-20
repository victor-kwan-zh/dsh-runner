// dsh-runner 设置分区（host 插件）：在设置里注册 "dsh-runner" 命名空间。
// 由 dsh 设置 UI 根据 schema 自动渲染表单；其他插件通过 dshRunnerConfig 服务读取。
import { installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings";
import z from "@deepseek-ai/schemastery";

const name = "settings-dsh-runner";
const inject = [];

const Config = z.object({});

/** dsh-runner 设置命名空间。 */
export const DSH_RUNNER_NS = settingsNamespace("dsh-runner");

/** 默认配置。 */
export const DEFAULT_CONFIG = Object.freeze({
  /** 每日费用告警阈值（¥），usage_report 据此返回 exceeded */
  usageAlertThreshold: 10,
  /** 视觉分析配置（vision_analyze 工具） */
  vision: Object.freeze({
    provider: "qwen",
    model: "",
    baseUrl: "",
    apiKey: "",
  }),
});

/** 设置 schema（schemastery）。 */
export const Schema = z.object({
  usageAlertThreshold: z.number().default(DEFAULT_CONFIG.usageAlertThreshold).description("每日费用告警阈值（¥）"),
  vision: z.object({
    provider: z.string().default("qwen").description("视觉 provider：qwen / doubao / glm / openai / gemini"),
    model: z.string().default("").description("覆盖模型名（留空用 provider 默认，如 qwen-vl-max）"),
    baseUrl: z.string().default("").description("自定义 OpenAI 兼容 baseURL（留空用 provider 默认）"),
    apiKey: z.string().default("").description("视觉 API Key（留空则读环境变量 VISION_API_KEY / <PROVIDER>_API_KEY）"),
  }).default({ ...DEFAULT_CONFIG.vision }),
});

function apply(ctx) {
  let source = { ...DEFAULT_CONFIG, vision: { ...DEFAULT_CONFIG.vision } };
  installSettingsSection(ctx, DSH_RUNNER_NS, Schema, source, {
    setSource: (current) => {
      source = current ?? { ...DEFAULT_CONFIG, vision: { ...DEFAULT_CONFIG.vision } };
    },
    onChange: () => {},
  });
  // 供其他插件读取配置（可选服务，未加载时 get 返回 undefined）
  ctx.provide("dshRunnerConfig", {
    get: () => source,
  });
  console.log("[settings-dsh-runner] 设置分区已注册（usageAlertThreshold 默认 ¥10，vision 默认 qwen）");
}

export { apply, inject, name, Config };
