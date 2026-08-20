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
});

/** 设置 schema（schemastery）。 */
export const Schema = z.object({
  usageAlertThreshold: z.number().default(DEFAULT_CONFIG.usageAlertThreshold).description("每日费用告警阈值（¥）"),
});

function apply(ctx) {
  let source = { ...DEFAULT_CONFIG };
  installSettingsSection(ctx, DSH_RUNNER_NS, Schema, source, {
    setSource: (current) => {
      source = current ?? { ...DEFAULT_CONFIG };
    },
    onChange: () => {},
  });
  // 供其他插件读取配置（可选服务，未加载时 get 返回 undefined）
  ctx.provide("dshRunnerConfig", {
    get: () => source,
  });
  console.log("[settings-dsh-runner] 设置分区已注册（usageAlertThreshold 默认 ¥10）");
}

export { apply, inject, name, Config };
