// dsh 用量/成本报告工具：usage_report（读取 dsh-cost-tracker 数据并聚合）。
import { defineTool } from "@deepseek-ai/dsh-tools";
import { z } from "zod";
import path from "node:path";
import * as core from "./usage-core.mjs";

const name = "tool-usage";
const inject = ["tools"];

const Config = z.object({});

const genericOutput = { schema: { type: "object", additionalProperties: true } };

function apply(ctx) {
  ctx.tools.register(defineTool({
    name: "usage_report",
    description:
      "查看 LLM 用量与费用报告：聚合 dsh-cost-tracker 数据（按模型/按天/按会话），" +
      "返回总费用、Token 用量（输入/输出/缓存读取/推理）。scope 支持 all（全部）/ today（今天）/ session（当前或指定会话）。",
    parameters: {
      scope: { type: "string", enum: ["all", "today", "session"], description: "统计范围（默认 all）" },
      sessionId: { type: "string", description: "scope=session 时指定会话 id（默认当前会话）" },
    },
    output: genericOutput,
    execute: async (args, exec) => {
      const scope = args.scope ?? "all";
      let sessionId = args.sessionId;
      if (scope === "session" && !sessionId) {
        sessionId = exec?.agent?.session?.id;
      }
      const dshHome = process.env.DSH_HOME || path.join(process.env.USERPROFILE || process.env.HOME || ".", ".dsh");
      const { entries, titles, pricing } = core.loadCostTracker(dshHome);
      const summary = core.aggregate(entries, { scope, sessionId });
      const currency = pricing?.currency ?? "¥";
      const title = scope === "session" && sessionId ? titles?.[sessionId] : undefined;
      return {
        ok: true,
        summary,
        text: core.formatReport(summary, { currency, title }),
        dataFile: core.costTrackerFile(dshHome),
      };
    },
    presentCall: (args) => ({
      card: "generic",
      title: "usage_report",
      kind: "execute",
      rawInput: JSON.stringify(args ?? {}),
      content: [{ type: "text", text: JSON.stringify(args ?? {}) }],
    }),
    presentResult: (_args, result) => ({
      card: "generic",
      content: [{ type: "text", text: result.text ?? JSON.stringify(result, null, 2) }],
    }),
  }));
  console.log("[usage-tools] registered usage_report tool");
}

export { apply, inject, name, Config };
