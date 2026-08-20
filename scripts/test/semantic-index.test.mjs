// 语义索引单元测试：分词/分块/忽略规则/构建/检索/持久化。
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  shouldIgnore, tokenize, chunkLines, chunkFile, listFiles,
  buildIndex, search, saveIndex, loadIndex, indexFileFor, indexDir,
} from "../../electron/semantic-index/index-core.mjs";

let dir;
let index;

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-si-test-"));
  fs.writeFileSync(path.join(dir, "auth.js"), [
    "// 用户登录鉴权模块",
    "export function login(username, password) {",
    "  const token = verifyCredentials(username, password);",
    "  return token;",
    "}",
    "export function logout() {",
    "  session.destroy();",
    "}",
    "",
  ].join("\n"));
  fs.writeFileSync(path.join(dir, "payment.js"), [
    "// 支付结算",
    "export function charge(userId, amount) {",
    "  const order = createOrder(userId, amount);",
    "  return order.id;",
    "}",
    "",
  ].join("\n"));
  fs.writeFileSync(path.join(dir, "README.md"), "项目说明文档 login session\n");
  fs.mkdirSync(path.join(dir, "node_modules"));
  fs.writeFileSync(path.join(dir, "node_modules", "junk.js"), "should be ignored\n");
  fs.writeFileSync(path.join(dir, "dist"), "binary\x00data", "binary"); // 二进制跳过
});

after(() => fs.rmSync(dir, { recursive: true, force: true }));

test("shouldIgnore 忽略常见目录与二进制", () => {
  assert.equal(shouldIgnore("node_modules/x.js"), true);
  assert.equal(shouldIgnore("src/node_modules/a.js"), true);
  assert.equal(shouldIgnore("a.min.js"), true);
  assert.equal(shouldIgnore("src/auth.js"), false);
});

test("tokenize 提取并小写化", () => {
  assert.deepEqual(tokenize("LoginUser verifyCredentials 123"), ["loginuser", "verifycredentials", "123"]);
});

test("chunkLines 分块带重叠", () => {
  const lines = Array.from({ length: 100 }, (_, i) => `line ${i}`);
  const chunks = chunkLines(lines, { chunkLines: 40, overlap: 10 });
  assert.equal(chunks.length, 3);
  assert.equal(chunks[1].startLine, 31);
});

test("listFiles 递归并忽略黑名单", () => {
  const files = listFiles(dir);
  assert.ok(files.includes("auth.js"));
  assert.ok(files.includes("README.md"));
  assert.ok(!files.some((f) => f.includes("node_modules")));
  assert.ok(!files.some((f) => f.endsWith("dist")));
});

test("buildIndex + search 命中相关文件", () => {
  index = buildIndex(dir);
  assert.ok(index.fileCount >= 3);
  const hits = search(index, "用户登录 login token", { topK: 5 });
  assert.ok(hits.length > 0, "应返回结果");
  assert.equal(hits[0].path, "auth.js", "登录查询应命中 auth.js");
  assert.ok(hits[0].score > 0);
  assert.match(hits[0].snippet, /login/);
});

test("search 支付查询命中 payment.js", () => {
  const hits = search(index, "charge amount 支付", { topK: 5 });
  assert.equal(hits[0].path, "payment.js");
});

test("saveIndex/loadIndex 持久化往返", () => {
  const file = path.join(dir, "idx.json");
  saveIndex(index, file);
  const loaded = loadIndex(file);
  assert.equal(loaded.chunkCount, index.chunkCount);
  assert.deepEqual(loaded.chunks[0], index.chunks[0]);
  // 损坏文件返回 null
  fs.writeFileSync(file, "not json");
  assert.equal(loadIndex(file), null);
});

test("indexFileFor 按工作区哈希命名", () => {
  const file = indexFileFor(dir, path.join(dir, "..", "ws"));
  assert.ok(file.startsWith(indexDir(dir)));
  assert.match(path.basename(file), /^[0-9a-f]{16}\.json$/);
});
