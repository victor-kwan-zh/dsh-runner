// Git 工具核心：封装 git CLI 为纯函数（无 dsh 依赖，便于单元测试）。
// 所有函数接受 cwd + 参数，返回结构化结果；git 命令失败抛 GitError。
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";

const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 60_000;

/** git 调用失败（非零退出 / git 缺失 / 参数错误）。 */
export class GitError extends Error {
  constructor(message, { exitCode, stdout, stderr, command } = {}) {
    super(message);
    this.name = "GitError";
    this.exitCode = exitCode;
    this.stdout = stdout;
    this.stderr = stderr;
    this.command = command;
  }
}

/**
 * 执行一条 git 命令。
 * @param {string} cwd 工作目录（必须是存在的绝对路径）
 * @param {string[]} args git 参数（数组传参，无 shell 注入）
 * @param {{timeoutMs?: number}} [opts]
 * @returns {Promise<{stdout: string, stderr: string, exitCode: number}>}
 * @throws {GitError}
 */
export async function runGit(cwd, args, opts = {}) {
  const command = `git ${args.join(" ")}`;
  try {
    const { stdout, stderr } = await execFileAsync("git", args, {
      cwd,
      windowsHide: true,
      timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024,
    });
    return { stdout: stdout.trimEnd(), stderr: stderr.trimEnd(), exitCode: 0 };
  } catch (error) {
    if (error.code === "ENOENT") throw new GitError("git 未安装或不在 PATH 中", { command });
    const exitCode = typeof error.code === "number" ? error.code : 1;
    const stderr = String(error.stderr ?? "").trimEnd();
    const stdout = String(error.stdout ?? "").trimEnd();
    const reason = stderr || stdout || error.message;
    throw new GitError(`git 命令失败：${command}\n${reason}`, { exitCode, stdout, stderr, command });
  }
}

/** 校验 cwd 存在且为绝对路径。 */
export function assertCwd(cwd) {
  if (typeof cwd !== "string" || !path.isAbsolute(cwd)) {
    throw new GitError(`无效的工作目录：${JSON.stringify(cwd)}（需要绝对路径）`);
  }
  if (!fs.existsSync(cwd)) throw new GitError(`工作目录不存在：${cwd}`);
}

/** 是否在 git 仓库内（沿目录向上查找）。 */
export async function isGitRepo(cwd) {
  assertCwd(cwd);
  try {
    const { stdout } = await runGit(cwd, ["rev-parse", "--is-inside-work-tree"]);
    return stdout.trim() === "true";
  } catch {
    return false;
  }
}

/** git 仓库根目录（--show-toplevel）。 */
export async function gitRoot(cwd) {
  const { stdout } = await runGit(cwd, ["rev-parse", "--show-toplevel"]);
  return stdout.trim();
}

/** 当前分支名（detached 时为空字符串）。 */
export async function currentBranch(cwd) {
  const { stdout } = await runGit(cwd, ["branch", "--show-current"]);
  return stdout.trim();
}

/** git status：分支 + porcelain 输出。 */
export async function gitStatus(cwd) {
  if (!(await isGitRepo(cwd))) throw new GitError(`不是 git 仓库：${cwd}`);
  const branch = await currentBranch(cwd);
  const { stdout } = await runGit(cwd, ["status", "--porcelain=v1", "--branch"]);
  const lines = stdout
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("##")) // 跳过 --branch 的 "## main" 头部
    .map((line) => {
      const index = line.slice(0, 2);
      const worktree = line.slice(2, 3);
      const rest = line.slice(3).trim();
      return { index, worktree, path: rest };
    });
  return { branch, lines, porcelain: stdout };
}

/**
 * git diff（未暂存或已暂存）。
 * @param {string} cwd
 * @param {{staged?: boolean, stat?: boolean, paths?: string[], context?: number}} [opts]
 */
export async function gitDiff(cwd, opts = {}) {
  if (!(await isGitRepo(cwd))) throw new GitError(`不是 git 仓库：${cwd}`);
  const args = ["diff"];
  if (opts.staged) args.push("--cached");
  if (opts.stat) args.push("--stat");
  if (typeof opts.context === "number" && opts.context >= 0) args.push(`-U${opts.context}`);
  const paths = Array.isArray(opts.paths) ? opts.paths.filter(Boolean) : [];
  if (paths.length > 0) args.push("--", ...paths);
  const { stdout } = await runGit(cwd, args);
  return stdout;
}

/** git log（最近提交，oneline）。 */
export async function gitLog(cwd, opts = {}) {
  if (!(await isGitRepo(cwd))) throw new GitError(`不是 git 仓库：${cwd}`);
  const count = Number.isInteger(opts.count) && opts.count > 0 ? Math.min(opts.count, 100) : 15;
  const { stdout } = await runGit(cwd, ["log", `-n ${count}`, "--oneline"]);
  return stdout;
}

/** git add：暂存文件（默认全部）。 */
export async function gitAdd(cwd, files = []) {
  if (!(await isGitRepo(cwd))) throw new GitError(`不是 git 仓库：${cwd}`);
  const args = ["add", "--"];
  if (Array.isArray(files) && files.length > 0) args.push(...files);
  else args.pop(); // 空列表 → git add 全部
  await runGit(cwd, args);
  return true;
}

/**
 * git commit：仅提交已暂存内容；传 files 时先 add 这些文件。
 * @returns {Promise<{commitHash: string}>}
 */
export async function gitCommit(cwd, opts = {}) {
  if (!(await isGitRepo(cwd))) throw new GitError(`不是 git 仓库：${cwd}`);
  const message = typeof opts.message === "string" && opts.message.trim() !== "" ? opts.message.trim() : null;
  if (message === null) throw new GitError("commit 需要 message");
  if (Array.isArray(opts.files) && opts.files.length > 0) await gitAdd(cwd, opts.files);
  const args = ["commit", "-m", message];
  if (opts.amend === true) args.push("--amend");
  if (opts.allowEmpty === true) args.push("--allow-empty");
  const { stdout, stderr } = await runGit(cwd, args);
  const hashMatch = stdout.match(/\[[^\]]+ ([0-9a-f]+)/) ?? stderr.match(/\[[^\]]+ ([0-9a-f]+)/);
  return { commitHash: hashMatch ? hashMatch[1] : "" };
}

/** git push（不传 branch 时推送当前分支到默认上游）。 */
export async function gitPush(cwd, opts = {}) {
  if (!(await isGitRepo(cwd))) throw new GitError(`不是 git 仓库：${cwd}`);
  const args = ["push"];
  if (opts.remote) args.push(opts.remote);
  if (opts.branch) args.push(opts.branch);
  if (opts.force === true) args.push("--force");
  const { stdout, stderr } = await runGit(cwd, args);
  return { stdout, stderr };
}

/** git pull。 */
export async function gitPull(cwd, opts = {}) {
  if (!(await isGitRepo(cwd))) throw new GitError(`不是 git 仓库：${cwd}`);
  const args = ["pull"];
  if (opts.rebase === true) args.push("--rebase");
  if (opts.remote) args.push(opts.remote);
  if (opts.branch) args.push(opts.branch);
  const { stdout, stderr } = await runGit(cwd, args);
  return { stdout, stderr };
}

/**
 * git branch 管理。
 * @param {string} cwd
 * @param {{action: "list"|"create"|"switch"|"delete", name?: string}} opts
 */
export async function gitBranch(cwd, opts = {}) {
  if (!(await isGitRepo(cwd))) throw new GitError(`不是 git 仓库：${cwd}`);
  const action = opts.action ?? "list";
  switch (action) {
    case "list": {
      const { stdout } = await runGit(cwd, ["branch", "-a"]);
      return stdout;
    }
    case "create": {
      if (!opts.name) throw new GitError("create 需要 name");
      await runGit(cwd, ["branch", opts.name]);
      return `已创建分支 ${opts.name}`;
    }
    case "switch": {
      if (!opts.name) throw new GitError("switch 需要 name");
      await runGit(cwd, ["switch", opts.name]);
      return `已切换到分支 ${opts.name}`;
    }
    case "delete": {
      if (!opts.name) throw new GitError("delete 需要 name");
      await runGit(cwd, ["branch", "-d", opts.name]);
      return `已删除分支 ${opts.name}`;
    }
    default:
      throw new GitError(`未知 branch action：${action}`);
  }
}

/** git stash 管理。 */
export async function gitStash(cwd, opts = {}) {
  if (!(await isGitRepo(cwd))) throw new GitError(`不是 git 仓库：${cwd}`);
  const action = opts.action ?? "list";
  switch (action) {
    case "list": {
      const { stdout } = await runGit(cwd, ["stash", "list"]);
      return stdout;
    }
    case "push": {
      const args = ["stash", "push", "-m", typeof opts.message === "string" && opts.message !== "" ? opts.message : `dsh stash ${new Date().toISOString()}`];
      const { stdout, stderr } = await runGit(cwd, args);
      return { stdout, stderr };
    }
    case "pop": {
      const args = ["stash", "pop"];
      if (opts.index !== undefined) args.push(String(opts.index));
      const { stdout, stderr } = await runGit(cwd, args);
      return { stdout, stderr };
    }
    case "drop": {
      const args = ["stash", "drop"];
      if (opts.index !== undefined) args.push(String(opts.index));
      const { stdout, stderr } = await runGit(cwd, args);
      return { stdout, stderr };
    }
    default:
      throw new GitError(`未知 stash action：${action}`);
  }
}

/** git remote -v 解析。 */
export async function gitRemotes(cwd) {
  if (!(await isGitRepo(cwd))) throw new GitError(`不是 git 仓库：${cwd}`);
  const { stdout } = await runGit(cwd, ["remote", "-v"]);
  const remotes = {};
  for (const line of stdout.split(/\r?\n/)) {
    const m = line.match(/^(\S+)\s+(\S+)/);
    if (m && !remotes[m[1]]) remotes[m[1]] = m[2];
  }
  return remotes;
}

export default {
  runGit,
  assertCwd,
  isGitRepo,
  gitRoot,
  currentBranch,
  gitStatus,
  gitDiff,
  gitLog,
  gitAdd,
  gitCommit,
  gitPush,
  gitPull,
  gitBranch,
  gitStash,
  gitRemotes,
  GitError,
};
