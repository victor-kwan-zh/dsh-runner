// test-core 单元测试：测试命令探测 + 运行（成功/失败/超时/显式命令）。
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { detectTestCommand, runTest } from "../../electron/test-tools/test-core.mjs";

let dir;
let dirFail;

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-tt-ok-"));
  dirFail = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-tt-fail-"));
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({
    name: "tt-ok", version: "1.0.0", scripts: { test: 'node -e "console.log(\'ALL TESTS PASSED\')"' },
  }));
  fs.writeFileSync(path.join(dirFail, "package.json"), JSON.stringify({
    name: "tt-fail", version: "1.0.0", scripts: { test: 'node -e "console.error(\'boom\'); process.exit(1)"' },
  }));
  fs.writeFileSync(path.join(dir, "pyproject.toml"), "[tool.pytest.ini_options]\n");
});

after(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(dirFail, { recursive: true, force: true });
});

test("detectTestCommand 优先 npm test", async () => {
  const d = await detectTestCommand(dir);
  assert.equal(d.type, "npm");
  assert.match(d.label, /ALL TESTS PASSED/);
});

test("detectTestCommand 探测 pytest 标记", async () => {
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-tt-py-"));
  try {
    fs.writeFileSync(path.join(plain, "pytest.ini"), "[pytest]\n");
    const d = await detectTestCommand(plain);
    assert.equal(d.type, "pytest");
  } finally {
    fs.rmSync(plain, { recursive: true, force: true });
  }
});

test("detectTestCommand 无测试命令返回 null", async () => {
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-tt-none-"));
  try {
    assert.equal(await detectTestCommand(plain), null);
  } finally {
    fs.rmSync(plain, { recursive: true, force: true });
  }
});

test("runTest 自动探测运行成功", async () => {
  const r = await runTest(dir, {});
  assert.equal(r.exitCode, 0);
  assert.match(r.stdout, /ALL TESTS PASSED/);
});

test("runTest 失败返回非零退出码", async () => {
  const r = await runTest(dirFail, {});
  assert.notEqual(r.exitCode, 0);
  assert.match(r.stderr, /boom/);
});

test("runTest 显式命令覆盖探测", async () => {
  const r = await runTest(dir, { command: 'node -e "console.log(\'explicit\')"' });
  assert.equal(r.exitCode, 0);
  assert.match(r.stdout, /explicit/);
});

test("runTest 超时终止", async () => {
  const r = await runTest(dir, { command: 'node -e "setTimeout(()=>{}, 60000)"', timeoutMs: 800 });
  assert.equal(r.timedOut, true);
  assert.notEqual(r.exitCode, 0);
});

test("runTest 无探测命令时返回说明", async () => {
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-tt-nodetect-"));
  try {
    const r = await runTest(plain, {});
    assert.equal(r.exitCode, null);
    assert.match(r.stderr, /未探测到测试命令/);
  } finally {
    fs.rmSync(plain, { recursive: true, force: true });
  }
});
