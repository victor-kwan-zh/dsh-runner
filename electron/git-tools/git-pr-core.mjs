// Git PR 核心：解析远程仓库、构造 GitHub PR 请求（REST API，无需 gh CLI）。
// 纯函数 + 可注入 fetch，便于单测。
import { GitError, isGitRepo, runGit } from "../git-tools/git-core.mjs";

const API_BASE = "https://api.github.com";

/**
 * 解析 GitHub 远程地址为 { owner, repo }。
 * 支持 ssh（git@github.com:owner/repo.git）与 https（https://github.com/owner/repo.git）。
 * 非 GitHub 远程返回 null。
 */
export function parseGitHubRemote(remoteUrl) {
  if (typeof remoteUrl !== "string") return null;
  const trimmed = remoteUrl.trim().replace(/\/+$/, "");
  let m = trimmed.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (m) return { owner: m[1], repo: m[2] };
  m = trimmed.match(/^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (m) return { owner: m[1], repo: m[2] };
  return null;
}

/** 构造 GitHub PR 请求体。 */
export function buildPullPayload({ title, head, base = "main", body = "" }) {
  if (!title || !head) throw new GitError("创建 PR 需要 title 与 head 分支");
  return { title, head, base, body: body ?? "" };
}

/**
 * 调用 GitHub REST API 创建 PR。
 * @param {object} repo { owner, repo }
 * @param {object} payload buildPullPayload 的结果
 * @param {object} opts { token, fetchImpl?, apiBase? }
 * @returns {Promise<{number: number, url: string}>}
 */
export async function createPull(repo, payload, opts = {}) {
  const token = opts.token;
  if (!token) throw new GitError("创建 PR 需要 GITHUB_TOKEN 环境变量（或传 token）");
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new GitError("当前环境没有 fetch（Node 18+ 应有）");
  const apiBase = opts.apiBase ?? API_BASE;
  const url = `${apiBase}/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/pulls`;
  let res;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        "user-agent": "dsh-runner",
        accept: "application/vnd.github+json",
      },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    throw new GitError(`GitHub API 请求失败：${error.message}`);
  }
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    /* non-JSON response */
  }
  if (!res.ok) {
    const detail = data?.message ?? text.slice(0, 300);
    throw new GitError(`GitHub API 错误 ${res.status}：${detail}`);
  }
  return { number: data.number, url: data.html_url ?? data.url ?? url };
}

/**
 * 完整流程：确认是 git 仓库 → 取 origin 远程 → 推送 head → 建 PR。
 * @returns {Promise<{owner: string, repo: string, number: number, url: string}>}
 */
export async function createPullFromRepo(cwd, { title, body, base = "main", head, remote = "origin", token }, opts = {}) {
  if (!(await isGitRepo(cwd))) throw new GitError(`不是 git 仓库：${cwd}`);
  const { stdout } = await runGit(cwd, ["remote", "get-url", remote]);
  const remoteUrl = stdout.trim();
  const parsed = parseGitHubRemote(remoteUrl);
  if (!parsed) throw new GitError(`远程 ${remote}（${remoteUrl}）不是 GitHub 仓库，无法创建 PR`);
  const headBranch = head ?? (await runGit(cwd, ["branch", "--show-current"])).stdout.trim();
  if (!headBranch) throw new GitError("无法确定当前分支（detached HEAD），请指定 head");
  // 推送 head 分支（若无上游）
  await runGit(cwd, ["push", "-u", remote, headBranch]).catch(() => {
    /* 已推送过时忽略 */
  });
  const payload = buildPullPayload({ title, head: headBranch, base, body });
  const result = await createPull(parsed, payload, { token, ...opts });
  return { ...parsed, ...result, head: headBranch, base };
}
