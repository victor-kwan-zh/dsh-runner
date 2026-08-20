// changeset-core 单元测试：收集变更集 + 审查应用（保留/还原/提交）。
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runGit, gitStatus, gitLog, GitError } from "../../electron/git-tools/git-core.mjs";
import { collectChangeset, applyReview, commitKept, summarize } from "../../electron/changeset-tools/changeset-core.mjs";

let dir;

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-cs-test-"));
  await runGit(dir, ["init", "-b", "main"]);
  await runGit(dir, ["config", "user.email", "test@dsh.local"]);
  await runGit(dir, ["config", "user.name", "dsh test"]);
  await runGit(dir, ["config", "core.autocrlf", "false"]);
  fs.writeFileSync(path.join(dir, "base.txt"), "base\n");
  await runGit(dir, ["add", "--", "base.txt"]);
  await runGit(dir, ["commit", "-m", "base"]);
});

after(() => fs.rmSync(dir, { recursive: true, force: true }));

test("collectChangeset 收集新增/修改/删除", async () => {
  fs.writeFileSync(path.join(dir, "new.txt"), "new content\n");
  fs.writeFileSync(path.join(dir, "base.txt"), "base modified\n");
  fs.rmSync(path.join(dir, "base.txt")); // 先删再写，保证是修改
  fs.writeFileSync(path.join(dir, "base.txt"), "base modified\n");
  const changes = await collectChangeset(dir);
  const byPath = Object.fromEntries(changes.map((c) => [c.path, c]));
  assert.ok(byPath["new.txt"]?.untracked, "new.txt 应未跟踪");
  assert.ok(byPath["base.txt"]?.unstaged || byPath["base.txt"]?.staged, "base.txt 应有改动");
  assert.equal(byPath["base.txt"].added, 1);
});

test("applyReview 保留+还原+提交", async () => {
  // 状态：new.txt 未跟踪；base.txt 已修改
  const result = await applyReview(dir, ["new.txt"], {});
  assert.deepEqual(result.kept, ["new.txt"]);
  assert.deepEqual(result.reverted, ["base.txt"]);
  assert.deepEqual(result.untouchedUntracked, []);
  // base.txt 已还原
  assert.equal(fs.readFileSync(path.join(dir, "base.txt"), "utf8"), "base\n");
  // new.txt 已暂存
  const status = await gitStatus(dir);
  assert.ok(status.lines.some((l) => l.path === "new.txt" && l.index === "A "), "new.txt 已暂存(A)");
});

test("commitKept 提交保留的变更", async () => {
  const { commitHash } = await commitKept(dir, "add new.txt");
  assert.match(commitHash, /^[0-9a-f]{7,}$/);
  const log = await gitLog(dir, { count: 5 });
  assert.match(log, /add new\.txt/);
  const status = await gitStatus(dir);
  assert.equal(status.lines.length, 0, "提交后工作区干净");
});

test("applyReview 不传 keep 还原全部（未跟踪不动）", async () => {
  fs.writeFileSync(path.join(dir, "junk.txt"), "junk\n");
  fs.writeFileSync(path.join(dir, "base.txt"), "again modified\n");
  const result = await applyReview(dir, [], {});
  assert.deepEqual(result.kept, []);
  assert.deepEqual(result.reverted, ["base.txt"]);
  assert.deepEqual(result.untouchedUntracked, ["junk.txt"]);
  assert.equal(fs.readFileSync(path.join(dir, "base.txt"), "utf8"), "base\n");
  assert.ok(fs.existsSync(path.join(dir, "junk.txt")), "未跟踪文件默认不动");
});

test("applyReview deleteUntracked=true 删除未选中未跟踪文件", async () => {
  const result = await applyReview(dir, [], { deleteUntracked: true });
  assert.deepEqual(result.untouchedUntracked, []);
  assert.ok(!fs.existsSync(path.join(dir, "junk.txt")), "junk.txt 已被删除");
});

test("summarize 输出摘要", async () => {
  fs.writeFileSync(path.join(dir, "sum.txt"), "x\n");
  const changes = await collectChangeset(dir);
  const s = summarize(changes);
  assert.ok(s.some((line) => line.includes("sum.txt")));
});

test("非 git 仓库抛 GitError", async () => {
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-cs-plain-"));
  try {
    await assert.rejects(() => collectChangeset(plain), (e) => e instanceof GitError && /不是 git 仓库/.test(e.message));
  } finally {
    fs.rmSync(plain, { recursive: true, force: true });
  }
});
