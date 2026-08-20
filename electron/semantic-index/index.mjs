// dsh 代码库语义索引工具：semantic_build（构建/重建索引）+ semantic_search（语义检索）。
// 索引为本地 TF-IDF 向量（见 index-core.mjs），按工作区持久化到 $DSH_HOME/indexes/。
// semantic_search 在无索引时自动构建（会注明耗时）；大仓库可先 semantic_build。
import { defineTool } from "@deepseek-ai/dsh-tools";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import { GitError } from "../git-tools/git-core.mjs";
import * as core from "./index-core.mjs";

const name = "tool-semantic-index";
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

// 进程内索引缓存：workspacePath -> index
const cache = new Map();

function getOrBuild(workspace, opts) {
  const key = path.resolve(workspace);
  if (cache.has(key)) return { index: cache.get(key), built: false };
  const file = core.indexFileFor(dshHome(), key);
  const persisted = core.loadIndex(file);
  if (persisted && persisted.root === key) {
    cache.set(key, persisted);
    return { index: persisted, built: false };
  }
  const started = Date.now();
  const index = core.buildIndex(key, opts);
  core.saveIndex(index, file);
  cache.set(key, index);
  return { index, built: true, elapsedMs: Date.now() - started };
}

function apply(ctx) {
  const tools = [
    tool({
      name: "semantic_build",
      description:
        "构建/重建当前工作区的语义索引（本地 TF-IDF 向量，自动忽略 node_modules/.git/构建产物等）。" +
        "索引持久化在 $DSH_HOME/indexes/，大仓库建议先构建再搜索。",
      parameters: {
        workdir: { type: "string", description: "工作目录（默认会话 cwd）" },
        rebuild: { type: "boolean", description: "true 强制重建（忽略缓存）" },
        include: { type: "array", description: "可选：只索引这些相对路径（目录或文件）" },
      },
      action: async (args, exec) => {
        const workspace = resolveCwd(exec, args.workdir);
        if (args.rebuild === true) {
          const key = path.resolve(workspace);
          cache.delete(key);
          const file = core.indexFileFor(dshHome(), key);
          fs.rmSync(file, { force: true });
        }
        const { index, built, elapsedMs } = getOrBuild(workspace, {
          opts: { extraIgnore: undefined },
          files: Array.isArray(args.include) && args.include.length > 0 ? args.include : undefined,
        });
        return {
          ok: true,
          rebuilt: built || args.rebuild === true,
          workspace,
          files: index.fileCount,
          chunks: index.chunkCount,
          elapsedMs,
          indexFile: core.indexFileFor(dshHome(), path.resolve(workspace)),
        };
      },
    }),

    tool({
      name: "semantic_search",
      description:
        "在工作区语义索引中检索与查询最相关的代码片段（按相关性分数排序）。" +
        "返回 { path, startLine, endLine, score, snippet }。无索引时自动构建。",
      parameters: {
        query: { type: "string", required: true, description: "自然语言或关键词查询，如 '配置文件加载逻辑'" },
        topK: { type: "number", description: "返回条数（默认 8）" },
        workdir: { type: "string", description: "工作目录（默认会话 cwd）" },
      },
      action: async (args, exec) => {
        const workspace = resolveCwd(exec, args.workdir);
        const query = String(args.query ?? "").trim();
        if (query === "") throw new GitError("semantic_search 需要 query");
        const topK = Number.isInteger(args.topK) && args.topK > 0 ? Math.min(args.topK, 50) : 8;
        const { index, built, elapsedMs } = getOrBuild(workspace, {});
        const results = core.search(index, query, { topK });
        return { ok: true, query, built, buildElapsedMs: elapsedMs, totalChunks: index.chunkCount, results };
      },
    }),
  ];

  for (const entry of tools) ctx.tools.register(defineTool(entry));
  console.log(`[semantic-index] registered ${tools.length} semantic index tools`);
}

export { apply, inject, name, Config };
