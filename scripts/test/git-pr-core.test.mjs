// git-pr-core 单元测试：远程解析 / PR 请求体 / API 调用（mock fetch）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseGitHubRemote, buildPullPayload, createPull, createPullFromRepo } from "../../electron/git-tools/git-pr-core.mjs";
import { runGit } from "../../electron/git-tools/git-core.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("parseGitHubRemote 支持 ssh 与 https", () => {
  assert.deepEqual(parseGitHubRemote("git@github.com:victor-kwan-zh/dsh-runner.git"), { owner: "victor-kwan-zh", repo: "dsh-runner" });
  assert.deepEqual(parseGitHubRemote("https://github.com/deepseek-ai/deepseek-harness.git"), { owner: "deepseek-ai", repo: "deepseek-harness" });
  assert.deepEqual(parseGitHubRemote("https://github.com/a/b"), { owner: "a", repo: "b" });
  assert.equal(parseGitHubRemote("git@gitlab.com:x/y.git"), null, "非 GitHub 返回 null");
  assert.equal(parseGitHubRemote(""), null);
});

test("buildPullPayload 校验必填", () => {
  const p = buildPullPayload({ title: "t", head: "feat", base: "main", body: "d" });
  assert.equal(p.title, "t");
  assert.equal(p.head, "feat");
  assert.equal(p.base, "main");
  assert.throws(() => buildPullPayload({ title: "", head: "h" }), /title/);
  assert.throws(() => buildPullPayload({ title: "t", head: "" }), /head/);
});

test("createPull 成功（mock fetch）", async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts });
    return {
      ok: true,
      status: 201,
      text: async () => JSON.stringify({ number: 42, html_url: "https://github.com/o/r/pull/42" }),
    };
  };
  const r = await createPull({ owner: "o", repo: "r" }, { title: "t", head: "h", base: "main", body: "" }, {
    token: "tok123",
    fetchImpl,
  });
  assert.deepEqual(r, { number: 42, url: "https://github.com/o/r/pull/42" });
  assert.match(calls[0].url, /\/repos\/o\/r\/pulls$/);
  assert.equal(calls[0].opts.headers.authorization, "Bearer tok123");
  assert.deepEqual(JSON.parse(calls[0].opts.body), { title: "t", head: "h", base: "main", body: "" });
});

test("createPull 无 token 抛错", async () => {
  await assert.rejects(() => createPull({ owner: "o", repo: "r" }, { title: "t", head: "h" }, { fetchImpl: async () => ({ ok: true, text: async () => "{}" }) }), /GITHUB_TOKEN/);
});

test("createPull API 错误解析 message", async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 422,
    text: async () => JSON.stringify({ message: "Validation Failed" }),
  });
  await assert.rejects(
    () => createPull({ owner: "o", repo: "r" }, { title: "t", head: "h", base: "main" }, { token: "t", fetchImpl }),
    /GitHub API 错误 422：Validation Failed/,
  );
});

test("createPullFromRepo 非 GitHub 远程抛错", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-pr-"));
  try {
    await runGit(dir, ["init", "-b", "main"]);
    await runGit(dir, ["config", "user.email", "t@t.local"]);
    await runGit(dir, ["config", "user.name", "t"]);
    fs.writeFileSync(path.join(dir, "a.txt"), "x\n");
    await runGit(dir, ["add", "--", "a.txt"]);
    await runGit(dir, ["commit", "-m", "init"]);
    await runGit(dir, ["remote", "add", "origin", "git@gitlab.com:o/r.git"]);
    await assert.rejects(
      () => createPullFromRepo(dir, { title: "t", base: "main", token: "t" }, { fetchImpl: async () => ({ ok: true, text: async () => "{}" }) }),
      /不是 GitHub 仓库/,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
