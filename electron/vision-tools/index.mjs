// dsh 视觉分析工具：vision_analyze（截图/设计图/UI 图 → 视觉模型分析）。
// 解决 DeepSeek 无视觉输入的问题；配合 desktop_screenshot 使用。
import { defineTool } from "@deepseek-ai/dsh-tools";
import { z } from "zod";
import path from "node:path";
import { GitError } from "../git-tools/git-core.mjs";
import * as core from "./vision-core.mjs";

const name = "tool-vision";
const inject = ["tools"];

const Config = z.object({});

function resolvePath(exec, imagePath) {
  if (typeof imagePath !== "string" || imagePath === "") throw new GitError("vision_analyze 需要 image_path");
  if (path.isAbsolute(imagePath)) return imagePath;
  const headerCwd = exec?.agent?.session?.header?.cwd;
  return headerCwd ? path.resolve(headerCwd, imagePath) : path.resolve(imagePath);
}

const genericOutput = { schema: { type: "object", additionalProperties: true } };

function apply(ctx) {
  ctx.tools.register(defineTool({
    name: "vision_analyze",
    description:
      "用视觉模型分析本地图片（截图/设计稿/UI 图/图表），返回分析文本。" +
      "解决主模型（DeepSeek）无视觉输入的问题——典型用法：desktop_screenshot 截屏 →" +
      "vision_analyze 分析 UI 问题 → 结合代码修复/优化。支持 provider：qwen（默认，通义千问" +
      "DashScope）/ doubao（豆包）/ glm（智谱）/ openai（GPT-4o）/ gemini（Google）。" +
      "API Key 在 设置 → dsh-runner 配置，或环境变量 VISION_API_KEY / <PROVIDER>_API_KEY。" +
      "prompt 建议明确要求：识别界面元素、描述布局、指出样式/交互问题、给出优化建议。",
    parameters: {
      image_path: { type: "string", required: true, description: "图片绝对路径（或相对会话 cwd）" },
      prompt: { type: "string", required: true, description: "分析指令，如 '识别图中界面并指出布局/样式问题，给出修复建议'" },
      provider: { type: "string", description: "视觉 provider（默认 qwen；可用设置的默认值）" },
      model: { type: "string", description: "覆盖模型名（如 qwen-vl-max / gemini-2.5-flash）" },
      maxTokens: { type: "number", description: "最大输出 token（默认 1024）" },
    },
    output: genericOutput,
    execute: async (args, exec) => {
      const imagePath = resolvePath(exec, args.image_path);
      // 视觉配置来自 dsh-runner 设置分区（可选服务）
      const visionCfg = ctx.get("dshRunnerConfig")?.get()?.vision ?? {};
      const provider = args.provider ?? visionCfg.provider ?? "qwen";
      const result = await core.analyzeImage(imagePath, args.prompt, {
        provider,
        model: args.model ?? visionCfg.model,
        baseUrl: visionCfg.baseUrl,
        apiKey: visionCfg.apiKey,
        maxTokens: args.maxTokens,
      });
      return { ok: true, image_path: imagePath, provider: result.provider, model: result.model, analysis: result.text };
    },
    presentCall: (args) => ({
      card: "generic",
      title: "vision_analyze",
      kind: "execute",
      rawInput: JSON.stringify(args ?? {}),
      content: [{ type: "text", text: `分析图片：${args?.image_path ?? ""}` }],
    }),
    presentResult: (_args, result) => ({
      card: "generic",
      content: [{ type: "text", text: result.analysis ?? JSON.stringify(result, null, 2) }],
    }),
  }));
  console.log("[vision-tools] registered vision_analyze tool");
}

export { apply, inject, name, Config };
