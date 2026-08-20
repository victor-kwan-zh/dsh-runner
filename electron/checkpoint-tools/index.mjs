// dsh 检查点工具：checkpoint_create / checkpoint_list / checkpoint_restore / checkpoint_drop。
// 用于高风险操作前快照工作区，随时一键回滚。
import { defineTool } from "@deepseek-ai/dsh-tools";
import { z } from "zod";
import path from "node:path";
import { GitError } from "../git-tools/git-core.mjs";
import * as core from "./checkpoint-core.mjs";

const name = "tool-checkpoint";
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

function dshHome() {
  return process.env.DSH_HOME || path.join(process.env.USERPROFILE || process.env.HOME || ".", ".dsh");
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

function apply(ctx) {
  const tools = [
    tool({
      name: "checkpoint_create",
      description:
        "创建检查点：快照当前工作区状态（已提交 HEAD + 未提交改动 + 未跟踪文件）。" +
        "不改变任何文件。用于执行高风险重构/批量修改前留后路。返回检查点 id。",
      parameters: {
        workdir: { type: "string", description: "工作目录（默认会话 cwd）" },
        message: { type: "string", description: "检查点备注" },
      },
      action: async (args, exec) => {
        const entry = await core.createCheckpoint(resolveCwd(exec, args.workdir), dshHome(), args);
        return { ok: true, id: entry.id, message: entry.message, headCommit: entry.headCommit, snapshotCommit: entry.snapshotCommit || null, untrackedCount: entry.untracked.length };
      },
    }),

    tool({
      name: "checkpoint_list",
      description: "列出当前工作区的检查点（按创建时间倒序）。",
      parameters: {
        workdir: { type: "string", description: "工作目录（默认会话 cwd）" },
      },
      action: async (args, exec) => {
        const list = core.listCheckpoints(resolveCwd(exec, args.workdir), dshHome());
        return { ok: true, checkpoints: list };
      },
    }),

    tool({
      name: "checkpoint_restore",
      description:
        "回滚到指定检查点：丢弃当前未提交改动，把工作区（含未跟踪文件）恢复到快照状态。" +
        "分支历史不受影响。注意：当前未提交改动会被丢弃。",
      parameters: {
        id: { type: "string", required: true, description: "检查点 id（checkpoint_list 获取）" },
        workdir: { type: "string", description: "工作目录（默认会话 cwd）" },
      },
      action: async (args, exec) => {
        const result = await core.restoreCheckpoint(resolveCwd(exec, args.workdir), dshHome(), args);
        return { ok: true, ...result };
      },
    }),

    tool({
      name: "checkpoint_drop",
      description: "删除一个检查点（含备份文件）。",
      parameters: {
        id: { type: "string", required: true, description: "检查点 id" },
        workdir: { type: "string", description: "工作目录（默认会话 cwd）" },
      },
      action: async (args, exec) => {
        const result = await core.dropCheckpoint(resolveCwd(exec, args.workdir), dshHome(), args);
        return { ok: true, ...result };
      },
    }),
  ];

  for (const entry of tools) ctx.tools.register(defineTool(entry));
  console.log(`[checkpoint-tools] registered ${tools.length} checkpoint tools`);
}

export { apply, inject, name, Config };
