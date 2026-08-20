// dsh 审批策略工具：permission_mode（ask / never / status）。
// 会话级切换审批策略（经 ApprovalService.setPolicy，会向模型注入切换通知）。
import { defineTool } from "@deepseek-ai/dsh-tools";
import { z } from "zod";

const name = "tool-permission";
const inject = ["tools", "approval"];

const Config = z.object({});

const genericOutput = { schema: { type: "object", additionalProperties: true } };

function apply(ctx) {
  ctx.tools.register(defineTool({
    name: "permission_mode",
    description:
      "切换当前会话的审批策略：ask = 每步需用户交互确认（默认，fail-closed）；" +
      "never = 拒绝所有需审批的操作（严格/只读模式，适合自动化或审查场景）；" +
      "status = 查询当前策略。切换即时生效并持久化到会话（注入模型通知）。",
    parameters: {
      mode: {
        type: "string",
        required: true,
        enum: ["ask", "never", "status"],
        description: "ask / never / status",
      },
    },
    output: genericOutput,
    execute: async (args, exec) => {
      const mode = String(args?.mode ?? "");
      if (mode === "status") {
        const policy = ctx.approval.effectivePolicy(exec?.agent?.session);
        return { ok: true, mode: policy };
      }
      if (mode !== "ask" && mode !== "never") {
        throw new Error(`未知权限模式：${mode}（支持 ask / never / status）`);
      }
      if (!exec?.agent) throw new Error("permission_mode 需要运行中的 agent 会话");
      ctx.approval.setPolicy(exec.agent, mode);
      return {
        ok: true,
        mode,
        note: mode === "never" ? "严格模式：后续需审批的操作将被拒绝" : "交互确认模式：需审批的操作会询问用户",
      };
    },
    presentCall: (args) => ({
      card: "generic",
      title: "permission_mode",
      kind: "execute",
      rawInput: JSON.stringify(args ?? {}),
      content: [{ type: "text", text: JSON.stringify(args ?? {}) }],
    }),
    presentResult: (_args, result) => ({
      card: "generic",
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    }),
  }));
  console.log("[permission-tools] registered permission_mode tool");
}

export { apply, inject, name, Config };
