// 变更集核心：收集工作区变更、按审查结果保留/还原（纯函数，可单测）。
import fs from "node:fs";
import path from "node:path";
import {
  GitError,
  isGitRepo,
  gitStatus,
  runGit,
  gitAdd,
  gitCommit,
} from "../git-tools/git-core.mjs";

/**
 * 收集当前变更集。
 * @param {string} cwd
 * @returns {Promise<Array<{path: string, untracked: boolean, staged: boolean, unstaged: boolean, added: number, deleted: number}>>}
 */
export async function collectChangeset(cwd) {
  if (!(await isGitRepo(cwd))) throw new GitError(`不是 git 仓库：${cwd}`);
  const { lines } = await gitStatus(cwd);
  const changes = [];
  for (const line of lines) {
    const raw = line.path;
    // 重命名/拷贝："old -> new"，取 new
    const p = raw.includes(" -> ") ? raw.split(" -> ").pop() : raw;
    const untracked = line.index === "??";
    const staged = !untracked && line.index !== "  " && line.index.trim() !== "";
    const unstaged = !untracked && line.worktree !== " ";
    let added = 0;
    let deleted = 0;
    if (!untracked && (staged || unstaged)) {
      const { stdout } = await runGit(cwd, ["diff", "--numstat", "--", p]);
      const { stdout: stagedOut } = await runGit(cwd, ["diff", "--cached", "--numstat", "--", p]);
      for (const out of [stdout, stagedOut]) {
        for (const row of out.split(/\r?\n/)) {
          const m = row.match(/^(\d+|-)\s+(\d+|-)\s/);
          if (m) {
            added += m[1] === "-" ? 0 : Number(m[1]);
            deleted += m[2] === "-" ? 0 : Number(m[2]);
          }
        }
      }
    } else if (untracked) {
      // 未跟踪文件的行数统计（近似：新文件行数计入 added）
      try {
        const abs = path.isAbsolute(p) ? p : path.join(cwd, p);
        added = countLines(abs);
      } catch {
        added = 0;
      }
    }
    changes.push({ path: p, untracked, staged, unstaged, added, deleted });
  }
  return changes;
}

function countLines(file) {
  const content = fs.readFileSync(file, "utf8");
  return content.split(/\r?\n/).length - 1;
}

/**
 * 按审查结果应用变更集：keep 中的文件暂存保留，其余还原到 HEAD。
 * 未跟踪文件默认不动（除非 deleteUntracked）。
 * @param {string} cwd
 * @param {string[]} keep 保留（暂存）的文件路径
 * @param {{deleteUntracked?: boolean}} [opts]
 * @returns {Promise<{kept: string[], reverted: string[], untouchedUntracked: string[]}>}
 */
export async function applyReview(cwd, keep, opts = {}) {
  if (!(await isGitRepo(cwd))) throw new GitError(`不是 git 仓库：${cwd}`);
  const keepSet = new Set((Array.isArray(keep) ? keep : []).map((p) => p.replace(/[\\/]+$/, "")));
  const changes = await collectChangeset(cwd);
  const kept = [];
  const reverted = [];
  const untouchedUntracked = [];
  for (const c of changes) {
    if (keepSet.has(c.path)) {
      await gitAdd(cwd, [c.path]);
      kept.push(c.path);
    } else if (c.untracked) {
      if (opts.deleteUntracked === true) {
        fs.rmSync(path.isAbsolute(c.path) ? c.path : path.join(cwd, c.path), { force: true });
        reverted.push(c.path);
      } else {
        untouchedUntracked.push(c.path);
      }
    } else {
      await runGit(cwd, ["restore", "--source=HEAD", "--staged", "--worktree", "--", c.path]);
      reverted.push(c.path);
    }
  }
  return { kept, reverted, untouchedUntracked };
}

/**
 * 提交已暂存的变更（审查保留的部分）。
 * @param {string} cwd
 * @param {string} message
 * @param {{allowEmpty?: boolean}} [opts]
 */
export async function commitKept(cwd, message, opts = {}) {
  return gitCommit(cwd, { message, allowEmpty: opts.allowEmpty });
}

/** 变更集摘要文本（供工具返回/展示）。 */
export function summarize(changes) {
  return changes.map((c) => {
    const tag = c.untracked ? "新文件" : c.staged && c.unstaged ? "已暂存+未暂存" : c.staged ? "已暂存" : "未暂存";
    return `${c.path}\t${tag}\t+${c.added} -${c.deleted}`;
  });
}

export { GitError };
