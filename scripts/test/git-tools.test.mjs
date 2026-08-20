// git-core 单元测试：在临时 git 仓库上验证各工具函数。
// 运行：npm test（node --test scripts/test/）
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  runGit,
  isGitRepo,
  gitStatus,
  gitDiff,
  gitLog,
  gitAdd,
  gitCommit,
  gitBranch,
  gitStash,
  gitRemotes,
  GitError,
} from "../../electron/git-tools/git-core.mjs";

let dir;

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-git-test-"));
  await runGit(dir, ["init", "-b", "main"]);
  await runGit(dir, ["config", "user.email", "test@dsh.local"]);
  await runGit(dir, ["config", "user.name", "dsh test"]);
  // 关闭行尾自动转换，避免 Windows 全局 autocrlf 干扰断言
  await runGit(dir, ["config", "core.autocrlf", "false"]);
});

after(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const write = (name, content) => fs.writeFileSync(path.join(dir, name), content);
const read = (name) => fs.readFileSync(path.join(dir, name), "utf8");

test("isGitRepo 识别仓库与普通目录", async () => {
  assert.equal(await isGitRepo(dir), true);
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-git-plain-"));
  try {
    assert.equal(await isGitRepo(plain), false);
  } finally {
    fs.rmSync(plain, { recursive: true, force: true });
  }
});

test("isGitRepo 对不存在目录抛错", async () => {
  await assert.rejects(() => isGitRepo(path.join(os.tmpdir(), "dsh-no-such-dir-xyz")), /工作目录不存在/);
});

test("gitStatus 报告未跟踪文件与分支", async () => {
  write("a.txt", "hello\n");
  const s = await gitStatus(dir);
  assert.equal(s.branch, "main");
  assert.ok(s.lines.some((l) => l.path === "a.txt" && l.index === "??"), "应显示未跟踪 a.txt");
});

test("gitCommit 提交并返回哈希", async () => {
  await gitAdd(dir, ["a.txt"]);
  const { commitHash } = await gitCommit(dir, { message: "init a" });
  assert.match(commitHash, /^[0-9a-f]{7,}$/);
  // 提交后状态干净
  const s = await gitStatus(dir);
  assert.equal(s.lines.length, 0);
});

test("gitLog 显示提交", async () => {
  const log = await gitLog(dir, { count: 5 });
  assert.match(log, /init a/);
});

test("gitDiff 显示未暂存改动；staged 显示已暂存", async () => {
  write("a.txt", "hello world\n");
  const unstaged = await gitDiff(dir);
  assert.match(unstaged, /\+hello world/);
  await gitAdd(dir, ["a.txt"]);
  const staged = await gitDiff(dir, { staged: true });
  assert.match(staged, /\+hello world/);
});

test("gitCommit 缺少 message 抛错", async () => {
  await assert.rejects(() => gitCommit(dir, {}), /commit 需要 message/);
});

test("gitBranch create/list/switch/delete", async () => {
  await gitBranch(dir, { action: "create", name: "feature-x" });
  const list = await gitBranch(dir, { action: "list" });
  assert.match(list, /feature-x/);
  await gitBranch(dir, { action: "switch", name: "feature-x" });
  assert.equal((await gitStatus(dir)).branch, "feature-x");
  await gitBranch(dir, { action: "switch", name: "main" });
  await gitBranch(dir, { action: "delete", name: "feature-x" });
  const after = await gitBranch(dir, { action: "list" });
  assert.doesNotMatch(after, /feature-x/);
});

test("gitStash push/pop 保存与恢复改动", async () => {
  write("a.txt", "stashed content\n");
  await gitStash(dir, { action: "push", message: "wip" });
  assert.equal(read("a.txt"), "hello\n", "stash 后工作区回到 HEAD 内容");
  const list = await gitStash(dir, { action: "list" });
  assert.match(list, /wip/);
  await gitStash(dir, { action: "pop" });
  assert.equal(read("a.txt"), "stashed content\n", "pop 后改动恢复");
});

test("非 git 仓库调用抛 GitError", async () => {
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-git-plain2-"));
  try {
    await assert.rejects(() => gitStatus(plain), (e) => e instanceof GitError && /不是 git 仓库/.test(e.message));
  } finally {
    fs.rmSync(plain, { recursive: true, force: true });
  }
});

test("gitRemotes 解析远程（空仓库返回空对象）", async () => {
  const remotes = await gitRemotes(dir);
  assert.deepEqual(remotes, {});
});
