// checkpoint-core 单元测试：创建/列出/恢复/删除检查点。
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runGit, gitStatus, GitError } from "../../electron/git-tools/git-core.mjs";
import {
  createCheckpoint, listCheckpoints, restoreCheckpoint, dropCheckpoint, checkpointDirFor,
} from "../../electron/checkpoint-tools/checkpoint-core.mjs";

let dir;
let home;

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-cp-test-"));
  home = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-cp-home-"));
  await runGit(dir, ["init", "-b", "main"]);
  await runGit(dir, ["config", "user.email", "test@dsh.local"]);
  await runGit(dir, ["config", "user.name", "dsh test"]);
  await runGit(dir, ["config", "core.autocrlf", "false"]);
  fs.writeFileSync(path.join(dir, "a.txt"), "one\n");
  await runGit(dir, ["add", "--", "a.txt"]);
  await runGit(dir, ["commit", "-m", "base"]);
});

after(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(home, { recursive: true, force: true });
});

test("createCheckpoint 快照未提交改动 + 未跟踪文件，且不改变工作区", async () => {
  fs.writeFileSync(path.join(dir, "a.txt"), "one modified\n");
  fs.writeFileSync(path.join(dir, "new.txt"), "untracked\n");
  const entry = await createCheckpoint(dir, home, { message: "before refactor" });
  assert.ok(entry.id);
  assert.ok(entry.headCommit);
  assert.ok(entry.snapshotCommit, "应有 stash create 快照");
  assert.deepEqual(entry.untracked, ["new.txt"]);
  // 工作区未被改动
  assert.equal(fs.readFileSync(path.join(dir, "a.txt"), "utf8"), "one modified\n");
  assert.equal(fs.readFileSync(path.join(dir, "new.txt"), "utf8"), "untracked\n");
  // 备份文件存在
  assert.ok(fs.existsSync(path.join(checkpointDirFor(home, dir), entry.id, "untracked", "new.txt")));
});

test("listCheckpoints 列出条目", () => {
  const list = listCheckpoints(dir, home);
  assert.equal(list.length, 1);
  assert.equal(list[0].message, "before refactor");
  assert.equal(list[0].untrackedCount, 1);
});

test("restoreCheckpoint 恢复到快照状态", async () => {
  // 继续破坏：修改 a.txt + 修改 new.txt + 新增 junk.txt
  fs.writeFileSync(path.join(dir, "a.txt"), "corrupted\n");
  fs.writeFileSync(path.join(dir, "new.txt"), "corrupted untracked\n");
  fs.writeFileSync(path.join(dir, "junk.txt"), "junk\n");
  const list = listCheckpoints(dir, home);
  const result = await restoreCheckpoint(dir, home, { id: list[0].id });
  assert.ok(result.ok);
  assert.ok(result.restored.includes("a.txt"));
  assert.ok(result.restored.includes("new.txt"));
  // a.txt 回到快照内容（"one modified"）
  assert.equal(fs.readFileSync(path.join(dir, "a.txt"), "utf8"), "one modified\n");
  // new.txt 未跟踪文件恢复
  assert.equal(fs.readFileSync(path.join(dir, "new.txt"), "utf8"), "untracked\n");
  // 分支历史未变
  assert.equal((await gitStatus(dir)).branch, "main");
});

test("restoreCheckpoint 对不存在 id 抛错", async () => {
  await assert.rejects(() => restoreCheckpoint(dir, home, { id: "nope" }), /检查点不存在/);
});

test("dropCheckpoint 删除条目与备份", async () => {
  const list = listCheckpoints(dir, home);
  assert.equal(list.length, 1);
  dropCheckpoint(dir, home, { id: list[0].id });
  assert.equal(listCheckpoints(dir, home).length, 0);
  assert.ok(!fs.existsSync(path.join(checkpointDirFor(home, dir), list[0].id)));
});

test("非 git 仓库 create 抛 GitError", async () => {
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-cp-plain-"));
  try {
    await assert.rejects(() => createCheckpoint(plain, home, {}), (e) => e instanceof GitError);
  } finally {
    fs.rmSync(plain, { recursive: true, force: true });
  }
});
