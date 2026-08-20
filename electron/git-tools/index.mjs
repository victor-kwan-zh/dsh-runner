// dsh Git 工作流工具集：把 git 操作注册为 agent 工具 git_*。
// 由 Electron 壳通过 `dsh web --patch` 注入（见 electron/main.js）。
// 工具在会话工作目录（session.header.cwd）执行；非 git 仓库时给出明确错误。
import { defineTool } from "@deepseek-ai/dsh-tools";
import { z } from "zod";
import path from "node:path";
import * as git from "./git-core.mjs";
import * as pr from "./git-pr-core.mjs";

const name = "tool-git";
const inject = ["tools"];

const Config = z.object({});

/** 解析工具调用的工作目录：显式 workdir（相对会话 cwd）优先，否则会话 cwd。 */
function resolveCwd(exec, workdir) {
  const headerCwd = exec?.agent?.session?.header?.cwd;
  if (typeof workdir === "string" && workdir !== "") {
    if (!headerCwd || workdir.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(workdir)) return workdir;
    return path.resolve(headerCwd, workdir);
  }
  if (!headerCwd) throw new git.GitError("无法确定工作目录（会话缺少 cwd）");
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
      name: "git_status",
      description:
        "查看 git 仓库状态：当前分支 + 变更清单（每个文件的暂存/工作区状态）。返回 { branch, lines: [{index, worktree, path}], porcelain }。",
      parameters: {
        workdir: { type: "string", description: "工作目录（默认会话 cwd；相对路径按会话 cwd 解析）" },
      },
      action: async (args, exec) => git.gitStatus(resolveCwd(exec, args.workdir)),
    }),

    tool({
      name: "git_diff",
      description:
        "查看 git diff：未暂存（默认）或已暂存（--cached）。可指定 stat 汇总或具体文件路径。返回 diff 文本。",
      parameters: {
        workdir: { type: "string", description: "工作目录" },
        staged: { type: "boolean", description: "true 查看已暂存改动（--cached）" },
        stat: { type: "boolean", description: "true 只输出 --stat 汇总" },
        paths: { type: "array", description: "限定文件路径列表" },
        context: { type: "number", description: "diff 上下文行数（-U）" },
      },
      action: async (args, exec) => git.gitDiff(resolveCwd(exec, args.workdir), args),
    }),

    tool({
      name: "git_log",
      description: "查看最近提交（oneline 格式）。",
      parameters: {
        workdir: { type: "string", description: "工作目录" },
        count: { type: "number", description: "条数（默认 15，最多 100）" },
      },
      action: async (args, exec) => git.gitLog(resolveCwd(exec, args.workdir), args),
    }),

    tool({
      name: "git_commit",
      description:
        "提交已暂存的改动；传 files 时先 add 这些文件再提交。返回提交哈希。注意：不传 files 时不会自动暂存所有改动。",
      parameters: {
        message: { type: "string", required: true, description: "提交信息" },
        files: { type: "array", description: "要暂存并提交的文件路径（可省略以提交已暂存内容）" },
        amend: { type: "boolean", description: "true 追加到上一次提交（--amend）" },
        allowEmpty: { type: "boolean", description: "true 允许空提交（--allow-empty）" },
        workdir: { type: "string", description: "工作目录" },
      },
      action: async (args, exec) => git.gitCommit(resolveCwd(exec, args.workdir), args),
    }),

    tool({
      name: "git_push",
      description: "推送提交到远程（默认推送当前分支到上游）。",
      parameters: {
        remote: { type: "string", description: "远程名（默认上游）" },
        branch: { type: "string", description: "分支名（默认当前分支）" },
        force: { type: "boolean", description: "true 强制推送" },
        workdir: { type: "string", description: "工作目录" },
      },
      action: async (args, exec) => git.gitPush(resolveCwd(exec, args.workdir), args),
    }),

    tool({
      name: "git_pull",
      description: "拉取远程更新（可选 --rebase）。",
      parameters: {
        rebase: { type: "boolean", description: "true 用 rebase 拉取" },
        remote: { type: "string", description: "远程名" },
        branch: { type: "string", description: "分支名" },
        workdir: { type: "string", description: "工作目录" },
      },
      action: async (args, exec) => git.gitPull(resolveCwd(exec, args.workdir), args),
    }),

    tool({
      name: "git_branch",
      description: "分支管理：list（默认）/ create / switch / delete。",
      parameters: {
        action: { type: "string", enum: ["list", "create", "switch", "delete"], description: "操作类型" },
        name: { type: "string", description: "分支名（create/switch/delete 必填）" },
        workdir: { type: "string", description: "工作目录" },
      },
      action: async (args, exec) => git.gitBranch(resolveCwd(exec, args.workdir), args),
    }),

    tool({
      name: "git_stash",
      description: "暂存管理：list（默认）/ push / pop / drop。用于临时保存工作区改动。",
      parameters: {
        action: { type: "string", enum: ["list", "push", "pop", "drop"], description: "操作类型" },
        message: { type: "string", description: "push 时的备注" },
        index: { type: "number", description: "pop/drop 时的 stash 序号（默认最近一条）" },
        workdir: { type: "string", description: "工作目录" },
      },
      action: async (args, exec) => git.gitStash(resolveCwd(exec, args.workdir), args),
    }),

    tool({
      name: "git_remote",
      description: "查看远程仓库信息（remote -v 解析结果）。",
      parameters: {
        workdir: { type: "string", description: "工作目录" },
      },
      action: async (args, exec) => {
        const remotes = await git.gitRemotes(resolveCwd(exec, args.workdir));
        return { ok: true, remotes };
      },
    }),

    tool({
      name: "git_pr_create",
      description:
        "创建 GitHub Pull Request（REST API，无需 gh CLI）。会先推送当前分支，然后调用" +
        "GitHub API 建 PR。需要 GITHUB_TOKEN 环境变量。返回 PR 编号与链接。",
      parameters: {
        title: { type: "string", required: true, description: "PR 标题" },
        body: { type: "string", description: "PR 描述" },
        base: { type: "string", description: "目标分支（默认 main）" },
        head: { type: "string", description: "源分支（默认当前分支）" },
        remote: { type: "string", description: "远程名（默认 origin）" },
        workdir: { type: "string", description: "工作目录" },
      },
      action: async (args, exec) => {
        const cwd = resolveCwd(exec, args.workdir);
        const result = await pr.createPullFromRepo(cwd, {
          title: args.title,
          body: args.body,
          base: args.base,
          head: args.head,
          remote: args.remote,
          token: process.env.GITHUB_TOKEN || process.env.GH_TOKEN,
        });
        return { ok: true, ...result };
      },
    }),
  ];

  for (const entry of tools) ctx.tools.register(defineTool(entry));
  console.log(`[git-tools] registered ${tools.length} git tools`);
}

export { apply, inject, name, Config };
