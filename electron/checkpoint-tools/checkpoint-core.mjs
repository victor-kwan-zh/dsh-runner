// 检查点核心：快照工作区状态 + 回滚（基于 git stash create + 未跟踪文件备份）。
// 纯函数，可单测。注册表持久化在 $DSH_HOME/checkpoints/<workspace-hash>/。
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import {
  GitError,
  isGitRepo,
  gitStatus,
  runGit,
} from "../git-tools/git-core.mjs";

const MAX_ENTRIES = 50;

/** 检查点注册表根目录。 */
export function checkpointsRoot(dshHome) {
  return path.join(dshHome ?? path.join(os.homedir(), ".dsh"), "checkpoints");
}

/** 工作区检查点目录（按工作区哈希）。 */
export function checkpointDirFor(dshHome, workspace) {
  const hash = crypto.createHash("sha1").update(path.resolve(workspace)).digest("hex").slice(0, 16);
  return path.join(checkpointsRoot(dshHome), hash);
}

function registryFile(dir) {
  return path.join(dir, "registry.json");
}

function loadRegistry(dir) {
  try {
    const data = JSON.parse(fs.readFileSync(registryFile(dir), "utf8"));
    if (data?.workspace && Array.isArray(data.entries)) return data;
    return null;
  } catch {
    return null;
  }
}

function saveRegistry(dir, registry) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(registryFile(dir), JSON.stringify(registry, null, 2), "utf8");
}

/** 列出工作区检查点。 */
export function listCheckpoints(cwd, dshHome) {
  const dir = checkpointDirFor(dshHome, cwd);
  const registry = loadRegistry(dir);
  if (!registry) return [];
  return registry.entries.map(({ id, message, createdAt, headCommit, snapshotCommit, untracked }) => ({
    id, message, createdAt, headCommit, snapshotCommit, untrackedCount: untracked.length,
  }));
}

/**
 * 创建检查点：记录 HEAD，用 git stash create 快照跟踪文件的暂存+工作区状态
 * （不改变工作区），并把未跟踪文件复制到备份目录。
 * @returns {Promise<{id: string, message: string, headCommit: string, snapshotCommit: string, untracked: string[]}>}
 */
export async function createCheckpoint(cwd, dshHome, opts = {}) {
  if (!(await isGitRepo(cwd))) throw new GitError(`不是 git 仓库：${cwd}`);
  const message = typeof opts.message === "string" && opts.message.trim() !== "" ? opts.message.trim() : `dsh checkpoint ${new Date().toISOString()}`;
  let headCommit;
  try {
    headCommit = (await runGit(cwd, ["rev-parse", "HEAD"])).stdout.trim();
  } catch {
    throw new GitError("仓库没有提交记录，无法创建检查点（请先做一次提交）");
  }
  const stashOut = await runGit(cwd, ["stash", "create", message]);
  const snapshotCommit = stashOut.stdout.trim();
  const { lines } = await gitStatus(cwd);
  const untracked = lines.filter((l) => l.index === "??").map((l) => l.path);

  const id = crypto.randomUUID();
  const dir = checkpointDirFor(dshHome, cwd);
  const backupDir = path.join(dir, id, "untracked");
  for (const rel of untracked) {
    const src = path.join(cwd, rel);
    const dst = path.join(backupDir, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }

  const registry = loadRegistry(dir) ?? { workspace: path.resolve(cwd), entries: [] };
  const entry = { id, message, createdAt: new Date().toISOString(), headCommit, snapshotCommit, untracked };
  registry.entries.unshift(entry);
  if (registry.entries.length > MAX_ENTRIES) registry.entries.length = MAX_ENTRIES;
  saveRegistry(dir, registry);
  return entry;
}

/**
 * 恢复检查点：丢弃当前未提交改动，把工作区（含未跟踪文件）恢复到快照状态。
 * 分支历史不受影响（恢复内容以未提交改动的形态回到工作区）。
 * @returns {Promise<{ok: true, restored: string[], note: string}>}
 */
export async function restoreCheckpoint(cwd, dshHome, { id }) {
  if (!(await isGitRepo(cwd))) throw new GitError(`不是 git 仓库：${cwd}`);
  if (!id) throw new GitError("restore 需要 id");
  const dir = checkpointDirFor(dshHome, cwd);
  const registry = loadRegistry(dir);
  const entry = registry?.entries.find((e) => e.id === id);
  if (!entry) throw new GitError(`检查点不存在：${id}`);

  await runGit(cwd, ["reset", "--hard", "HEAD"]); // 丢弃当前未提交改动
  const restored = new Set();
  if (entry.snapshotCommit) {
    await runGit(cwd, ["checkout", entry.snapshotCommit, "--", "."]);
    await runGit(cwd, ["reset"]); // 取消暂存，快照内容以未提交改动呈现
    const { stdout } = await runGit(cwd, ["diff", "--name-status", entry.headCommit, entry.snapshotCommit]);
    for (const line of stdout.split(/\r?\n/)) {
      const m = line.match(/^([A-Z])\s+(.+)$/);
      if (m) restored.add(m[2]);
    }
  }
  // 恢复未跟踪文件备份
  const backupDir = path.join(dir, id, "untracked");
  for (const rel of entry.untracked) {
    const src = path.join(backupDir, rel);
    if (fs.existsSync(src)) {
      const dst = path.join(cwd, rel);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
      restored.add(rel);
    }
  }
  return { ok: true, restored: [...restored], note: "工作区已恢复到检查点状态（分支历史未变）" };
}

/** 删除检查点（含备份文件）。 */
export function dropCheckpoint(cwd, dshHome, { id }) {
  const dir = checkpointDirFor(dshHome, cwd);
  const registry = loadRegistry(dir);
  if (!registry) throw new GitError(`检查点不存在：${id}`);
  const idx = registry.entries.findIndex((e) => e.id === id);
  if (idx < 0) throw new GitError(`检查点不存在：${id}`);
  registry.entries.splice(idx, 1);
  saveRegistry(dir, registry);
  fs.rmSync(path.join(dir, id), { recursive: true, force: true });
  return { ok: true };
}

export { GitError };
