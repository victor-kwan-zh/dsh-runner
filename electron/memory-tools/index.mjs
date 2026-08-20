// dsh 项目记忆协议：memory_read / memory_write / memory_path。
// 记忆文件 = 工作区 git 根目录的 AGENTS.md（回退 CLAUDE.md）。
// 同时注册动态 systemPrompt section：每轮模型上下文自动注入 AGENTS.md 内容。
import { defineTool } from "@deepseek-ai/dsh-tools";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import { GitError } from "../git-tools/git-core.mjs";
import * as core from "./memory-core.mjs";

const name = "tool-memory";
const inject = ["tools", "systemPrompt"];

const Config = z.object({
  /** 注入的最大字符数（防大文件撑爆上下文）。 */
  injectMaxChars: z.number().default(8000),
});

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

function tool({ name, description, parameters, action }) {
  return {
    name,
    description,
    parameters,
    output: genericOutput,
    execute: async (args, exec) => action(args ?? {}, exec),
    presentCall: (args) => ({
      card: "generic",
      title: name,
      kind: "execute",
      rawInput: JSON.stringify(args ?? {}),
      content: [{ type: "text", text: JSON.stringify(args ?? {}) }],
    }),
    presentResult: (_args, result) => ({
      card: "generic",
      content: [{ type: "text", text: typeof result === "string" ? result : JSON.stringify(result, null, 2) }],
    }),
  };
}

function apply(ctx, config = {}) {
  const injectMaxChars = config.injectMaxChars ?? 8000;
  const tools = [
    tool({
      name: "memory_read",
      description:
        "读取项目记忆文件（工作区 git 根目录的 AGENTS.md，回退 CLAUDE.md）。" +
        "用于会话开始时了解项目的约定/架构/注意事项。返回 { path, exists, content }。",
      parameters: {
        workdir: { type: "string", description: "工作目录（默认会话 cwd）" },
        fileName: { type: "string", description: "指定记忆文件名（默认自动探测）" },
      },
      action: async (args, exec) => {
        const root = await core.workspaceRoot(resolveCwd(exec, args.workdir));
        const r = core.readMemory(root, { fileName: args.fileName });
        return { ok: true, root, path: r.path, exists: r.exists, content: r.content, truncated: r.truncated ?? false };
      },
    }),

    tool({
      name: "memory_write",
      description:
        "写入项目记忆文件（AGENTS.md，不存在则创建）。mode=replace 整体替换（content 为空则删除文件）；" +
        "mode=append 追加到末尾；提供 section 时按 '## <section>' 分区追加或替换该分区。",
      parameters: {
        content: { type: "string", required: true, description: "要写入的内容" },
        mode: { type: "string", enum: ["append", "replace"], description: "写入模式（默认 append）" },
        section: { type: "string", description: "分区名（append 模式按二级标题管理分区）" },
        fileName: { type: "string", description: "指定记忆文件名" },
        workdir: { type: "string", description: "工作目录（默认会话 cwd）" },
      },
      action: async (args, exec) => {
        const root = await core.workspaceRoot(resolveCwd(exec, args.workdir));
        const r = await core.writeMemory(root, args);
        return { ok: true, root, ...r };
      },
    }),

    tool({
      name: "memory_path",
      description: "定位项目记忆文件路径（工作区 git 根目录）。",
      parameters: {
        workdir: { type: "string", description: "工作目录（默认会话 cwd）" },
      },
      action: async (args, exec) => {
        const root = await core.workspaceRoot(resolveCwd(exec, args.workdir));
        const files = core.listMemoryFiles(root);
        return { ok: true, root, memoryFiles: files, defaultPath: core.memoryFilePath(root) };
      },
    }),
  ];

  for (const entry of tools) ctx.tools.register(defineTool(entry));

  // 动态注入：每轮模型上下文自动附带 AGENTS.md 内容（同步读取，出错静默）
  try {
    ctx.systemPrompt.section({
      name: "memory:project",
      order: 900,
      text: (context) => {
        try {
          const cwd = context?.agent?.session?.header?.cwd;
          if (!cwd) return "";
          const root = core.syncWorkspaceRoot(cwd);
          const file = core.memoryFilePath(root, undefined);
          if (!fs.existsSync(file)) return "";
          let content;
          try {
            content = fs.readFileSync(file, "utf8");
          } catch {
            return "";
          }
          const capped = content.length > injectMaxChars ? content.slice(0, injectMaxChars) + "\n…(截断)" : content;
          if (capped.trim() === "") return "";
          return `## 项目记忆（${path.basename(file)}）\n${capped}`;
        } catch {
          return "";
        }
      },
    });
  } catch {
    /* systemPrompt 服务不可用时跳过注入（工具仍可用） */
  }

  console.log(`[memory-tools] registered ${tools.length} memory tools + 动态记忆注入`);
}

export { apply, inject, name, Config };
