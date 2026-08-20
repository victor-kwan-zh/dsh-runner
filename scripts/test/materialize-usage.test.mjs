// materialize + usage 阈值 单元测试。
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { checkThreshold } from "../../electron/usage-tools/usage-core.mjs";

let home;
let src;

before(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-mat-home-"));
  src = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-mat-src-"));
  // 构造一个客户端包目录
  fs.writeFileSync(path.join(src, "package.json"), JSON.stringify({
    name: "@dsh-runner/foo", version: "0.1.0", type: "module", main: "index.js",
    exports: { "./client": "./client.js", "./package.json": "./package.json" },
    dsh: { client: { platform: "web" } },
  }));
  fs.writeFileSync(path.join(src, "index.js"), "export const apply = () => {};\n");
  fs.writeFileSync(path.join(src, "client.js"), "console.log('foo client');\n");
});

after(() => {
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(src, { recursive: true, force: true });
});

test("materializeClientPlugin 复制包到 profile 且可解析", async () => {
  const { resolveDshHome, clientPluginDest, materializeClientPlugin } = await import("../../electron/plugins/materialize.cjs");
  const dest = materializeClientPlugin(home, src, "foo");
  assert.equal(dest, clientPluginDest(home, "foo"));
  assert.ok(fs.existsSync(path.join(dest, "package.json")));
  assert.ok(fs.existsSync(path.join(dest, "client.js")));
  // 从 profile 目录能 require.resolve 该包（模拟 client-modules 解析）
  const profileDir = path.join(home, "profiles", "web");
  const req = createRequire(path.join(profileDir, "noop.js"));
  const pkgJson = req.resolve("@dsh-runner/foo/package.json");
  assert.ok(pkgJson.endsWith(path.join("foo", "package.json")));
});

test("materializeClientPlugin 缺少 package.json 抛错", async () => {
  const { materializeClientPlugin } = await import("../../electron/plugins/materialize.cjs");
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-mat-empty-"));
  try {
    assert.throws(() => materializeClientPlugin(home, empty, "bad"), /缺少 package\.json/);
  } finally {
    fs.rmSync(empty, { recursive: true, force: true });
  }
});

test("listLocalClientPlugins 只列有 package.json 的目录", async () => {
  const { listLocalClientPlugins } = await import("../../electron/plugins/materialize.cjs");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-mat-list-"));
  try {
    fs.mkdirSync(path.join(dir, "a"));
    fs.writeFileSync(path.join(dir, "a", "package.json"), "{}");
    fs.mkdirSync(path.join(dir, "b"));
    fs.writeFileSync(path.join(dir, "b", "index.js"), "x");
    assert.deepEqual(listLocalClientPlugins(dir), ["a"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("checkThreshold 阈值判断", () => {
  assert.deepEqual(checkThreshold({ totalCost: 5 }, 10), { threshold: 10, exceeded: false, totalCost: 5 });
  assert.deepEqual(checkThreshold({ totalCost: 12 }, 10), { threshold: 10, exceeded: true, totalCost: 12 });
  assert.deepEqual(checkThreshold({ totalCost: 12 }, undefined), { threshold: null, exceeded: false, totalCost: 12 });
});
