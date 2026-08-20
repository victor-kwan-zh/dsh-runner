// dsh 测试闭环工具：test_run（探测并运行项目测试，返回结果供 agent 修复后重跑）。
import { defineTool } from "@deepseek-ai/dsh-tools";
import { z } from "zod";
import path from "node:path";
import { GitError } from "../git-tools/git-core.mjs";
import * as core from "./test-core.mjs";

const name = "tool-test";
const inject = ["tools"];

const Config = z.object({});

function resolveCwd(exec, workdir) {
  const headerCwd = exec?.agent?.session?.header?.cwd;
  if (typeof workdir === "string" && workdir !== "") {
    if (!headerCwd || workdir.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(workdir)) return workdir;
    return path.resolve(headerCwd, workdir);
  }
  if (!headerCwd) throw new GitError("无法确定工作目录（会话缺少 cwd）");
  return headerCwd;
}

const genericOutput = { schema: { type: "object", additionalProperties: true } };

function apply(ctx) {
  const tools = [
    {
      name: "test_run",
      description:
        "运行项目测试并返回结果（退出码 + 输出尾部）。自动探测测试命令" +
        "（package.json scripts.test / pytest / cargo test / go test）；也可显式传 command。" +
        "失败时 agent 应修复后重跑（测试闭环）。",
      parameters: {
        workdir: { type: "string", description: "工作目录（默认会话 cwd）" },
        command: { type: "string", description: "显式测试命令（覆盖自动探测），如 'npm test' 或 'pytest -x'" },
        timeoutMs: { type: "number", description: "超时（毫秒，默认 120000）" },
      },
      output: genericOutput,
      execute: async (args, exec) => {
        const cwd = resolveCwd(exec, args.workdir);
        const result = await core.runTest(cwd, {
          command: args.command,
          timeoutMs: args.timeoutMs,
        });
        return { ok: true, cwd, ...result };
      },
      presentCall: (args) => ({
        card: "terminal",
        title: (args?.command ?? "npm test"),
        description: "运行测试",
      }),
      presentResult: (_args, result) => ({
        card: "terminal",
        output: [result.stdout, result.stderr].filter(Boolean).join("\n"),
        exitCode: result.exitCode,
      }),
    },
  ];

  for (const entry of tools) ctx.tools.register(defineTool(entry));
  console.log(`[test-tools] registered ${tools.length} test tool`);
}

export { apply, inject, name, Config };
