// memory-core 单元测试：记忆文件读写（替换/追加/分区段替换）/ 定位 / 同步根解析。
// 每个用例使用独立子目录，避免文件状态互相干扰。
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runGit } from "../../electron/git-tools/git-core.mjs";
import {
  workspaceRoot, syncWorkspaceRoot, memoryFilePath, readMemory, writeMemory, upsertSection, listMemoryFiles,
} from "../../electron/memory-tools/memory-core.mjs";

let base;
let seq = 0;

before(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-mem-test-"));
});

after(() => fs.rmSync(base, { recursive: true, force: true }));

/** 新建一个隔离的临时目录（可含 git 仓库）。 */
async function freshDir({ git = false } = {}) {
  const d = path.join(base, `t${seq++}`);
  fs.mkdirSync(d, { recursive: true });
  if (git) {
    await runGit(d, ["init", "-b", "main"]);
    fs.writeFileSync(path.join(d, "base.txt"), "x\n");
    await runGit(d, ["add", "--", "base.txt"]);
    await runGit(d, ["config", "user.email", "t@t.local"]);
    await runGit(d, ["config", "user.name", "t"]);
    await runGit(d, ["commit", "-m", "init"]);
  }
  return d;
}

const norm = (p) => path.normalize(p).toLowerCase();

test("workspaceRoot / syncWorkspaceRoot 解析 git 根，无 git 回退 cwd", async () => {
  const dir = await freshDir({ git: true });
  const nested = path.join(dir, "src", "deep");
  fs.mkdirSync(nested, { recursive: true });
  // Windows 上 git 返回长路径而 fs.realpathSync 保留 8.3 短名，用 basename 比较
  const sameDir = (a, b) => path.basename(a) === path.basename(b);
  assert.ok(sameDir(await workspaceRoot(nested), dir), `workspaceRoot 应定位到 git 根 ${dir}`);
  assert.ok(sameDir(syncWorkspaceRoot(nested), dir), `syncWorkspaceRoot 应定位到 git 根 ${dir}`);
  const plain = await freshDir();
  assert.ok(sameDir(syncWorkspaceRoot(plain), plain), "无 git 时回退 cwd");
});

test("memoryFilePath 默认 AGENTS.md，已存在 CLAUDE.md 优先", () => {
  const dir = freshDirSync();
  assert.equal(path.basename(memoryFilePath(dir)), "AGENTS.md");
  fs.writeFileSync(path.join(dir, "CLAUDE.md"), "claude\n");
  assert.equal(path.basename(memoryFilePath(dir)), "CLAUDE.md");
});

test("writeMemory replace 创建/替换/删除", async () => {
  const dir = await freshDir();
  await writeMemory(dir, { content: "first\n", mode: "replace" });
  assert.equal(fs.readFileSync(path.join(dir, "AGENTS.md"), "utf8"), "first\n");
  await writeMemory(dir, { content: "second", mode: "replace" });
  assert.equal(fs.readFileSync(path.join(dir, "AGENTS.md"), "utf8"), "second\n");
  await writeMemory(dir, { content: "", mode: "replace" });
  assert.ok(!fs.existsSync(path.join(dir, "AGENTS.md")));
});

test("writeMemory append + section 追加/替换", async () => {
  const dir = await freshDir();
  await writeMemory(dir, { content: "## 架构\nlayers\n" });
  await writeMemory(dir, { content: "## 约定\nuse strict\n" });
  let content = fs.readFileSync(path.join(dir, "AGENTS.md"), "utf8");
  assert.match(content, /## 架构/);
  assert.match(content, /## 约定/);
  // 同一 section 再次写入 → 替换该 section 内容（不重复标题）
  await writeMemory(dir, { content: "prefer tabs\n", section: "约定" });
  content = fs.readFileSync(path.join(dir, "AGENTS.md"), "utf8");
  assert.match(content, /prefer tabs/);
  assert.doesNotMatch(content, /use strict/);
  assert.equal((content.match(/## 约定/g) || []).length, 1, "section 不重复");
});

test("readMemory 读取与缺失", async () => {
  const dir = await freshDir();
  await writeMemory(dir, { content: "## 约定\nprefer tabs\n", section: "约定" });
  const r = await readMemory(dir);
  assert.equal(r.exists, true);
  assert.match(r.content, /prefer tabs/);
  const missing = await freshDir();
  const m = await readMemory(missing);
  assert.equal(m.exists, false);
  assert.equal(m.content, "");
});

test("upsertSection 纯函数行为", () => {
  const out = upsertSection("## A\nx\n", "B", "y");
  assert.match(out, /## B\ny/);
  const replaced = upsertSection("## A\nx\n## B\nold\n## C\nz\n", "B", "new");
  assert.match(replaced, /## B\nnew/);
  assert.doesNotMatch(replaced, /old/);
});

test("listMemoryFiles 列出存在的记忆文件", async () => {
  const dir = await freshDir();
  fs.writeFileSync(path.join(dir, "CLAUDE.md"), "c\n");
  const files = listMemoryFiles(dir);
  assert.ok(files.some((f) => f.endsWith("CLAUDE.md")));
  assert.equal(files.length, 1);
});

function freshDirSync() {
  const d = path.join(base, `t${seq++}`);
  fs.mkdirSync(d, { recursive: true });
  return d;
}
