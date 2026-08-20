// dsh 变更集审查工具：收集工作区变更 → 交互式问用户保留哪些 → 应用。
// changeset_review：默认向用户发起多选审批（保留的暂存，未选还原）；
//   传 keep 可跳过提问直接应用；传 commit_message 应用后提交。
// changeset_status：查看当前变更集（每文件 已暂存/未暂存/新增 + 行数）。
import { defineTool } from "@deepseek-ai/dsh-tools";
import { z } from "zod";
import path from "node:path";
import { GitError } from "./changeset-core.mjs";
import * as core from "./changeset-core.mjs";

const name = "tool-changeset";
const inject = ["tools", "userQuestions"];

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
      name: "changeset_status",
      description:
        "查看当前变更集：每个变更文件的 已暂存/未暂存/新增 状态与增删行数。用于审查前先了解改动范围。",
      parameters: {
        workdir: { type: "string", description: "工作目录（默认会话 cwd）" },
      },
      action: async (args, exec) => {
        const changes = await core.collectChangeset(resolveCwd(exec, args.workdir));
        return { changes, summary: core.summarize(changes) };
      },
    }),

    tool({
      name: "changeset_review",
      description:
        "变更集审查与应用：收集当前未提交变更，向用户发起多选审批（保留哪些文件的改动），" +
        "保留的文件被暂存，未选中的还原到 HEAD（未跟踪文件默认不动，除非 deleteUntracked）。" +
        "不传 keep 时发起交互式提问；传 keep 则跳过提问直接应用。传 commit_message 在应用后提交。",
      parameters: {
        workdir: { type: "string", description: "工作目录（默认会话 cwd）" },
        keep: {
          type: "array",
          description: "要保留（暂存）的文件路径列表；省略则向用户发起多选审批",
        },
        commit_message: { type: "string", description: "应用后以此信息提交保留的改动" },
        deleteUntracked: { type: "boolean", description: "true 时未选中且未跟踪的文件将被删除（默认不动）" },
      },
      action: async (args, exec) => {
        const cwd = resolveCwd(exec, args.workdir);
        const changes = await core.collectChangeset(cwd);
        if (changes.length === 0) return { ok: true, message: "没有待审查的变更", kept: [], reverted: [] };

        let keep = args.keep;
        if (!Array.isArray(keep) || keep.length === 0) {
          const { answers } = await ctx.userQuestions.ask({
            questions: [
              {
                id: "changeset-keep",
                header: "变更集审查",
                question: `保留以下哪些文件的改动？未选中的将被还原到 HEAD（${changes.length} 个文件）。`,
                options: changes.map((c) => ({
                  label: c.path,
                  description: `${c.untracked ? "新增文件（未跟踪）" : c.staged && c.unstaged ? "已暂存+未暂存" : c.staged ? "已暂存" : "未暂存"}，+${c.added} -${c.deleted}`,
                })),
                multiSelect: true,
              },
            ],
            ...exec.agent !== void 0 ? { agent: exec.agent } : {},
            signal: exec.signal,
          });
          keep = answers[0]?.selected ?? [];
        }

        const result = await core.applyReview(cwd, keep, { deleteUntracked: args.deleteUntracked === true });
        let commit = null;
        if (typeof args.commit_message === "string" && args.commit_message.trim() !== "") {
          commit = await core.commitKept(cwd, args.commit_message.trim());
        }
        return { ok: true, ...result, commit };
      },
    }),
  ];

  for (const entry of tools) ctx.tools.register(defineTool(entry));
  console.log(`[changeset-tools] registered ${tools.length} changeset tools`);
}

export { apply, inject, name, Config };
