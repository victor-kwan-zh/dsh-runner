// vision-core 单元测试：MIME/编码/消息构造/provider 解析/API 调用（mock fetch）。
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { mimeFor, imageToDataUrl, buildMessages, resolveProvider, analyzeImage, PROVIDER_PRESETS } from "../../electron/vision-tools/vision-core.mjs";

let dir;

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-vision-"));
  fs.writeFileSync(path.join(dir, "shot.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]));
  fs.writeFileSync(path.join(dir, "shot.jpg"), Buffer.from([0xff, 0xd8, 0xff, 1, 2]));
});

after(() => fs.rmSync(dir, { recursive: true, force: true }));

test("provider 预设齐全且字段完整", () => {
  for (const name of ["qwen", "doubao", "glm", "openai", "gemini"]) {
    const p = PROVIDER_PRESETS[name];
    assert.ok(p.baseUrl.startsWith("https://"), `${name} baseUrl`);
    assert.ok(p.model, `${name} model`);
    assert.ok(p.envKey, `${name} envKey`);
  }
});

test("mimeFor 按扩展名推断", () => {
  assert.equal(mimeFor("a.png"), "image/png");
  assert.equal(mimeFor("a.jpg"), "image/jpeg");
  assert.equal(mimeFor("a.webp"), "image/webp");
  assert.equal(mimeFor("a.unknown"), "image/png");
});

test("imageToDataUrl 生成 data URL，缺文件/过大抛错", () => {
  const url = imageToDataUrl(path.join(dir, "shot.png"));
  assert.ok(url.startsWith("data:image/png;base64,"));
  assert.throws(() => imageToDataUrl(path.join(dir, "nope.png")), /不是文件/);
});

test("buildMessages 构造 OpenAI 兼容请求体", () => {
  const m = buildMessages("分析这张图", "data:image/png;base64,AAAA", { model: "qwen-vl-max", maxTokens: 512 });
  assert.equal(m.model, "qwen-vl-max");
  assert.equal(m.max_tokens, 512);
  assert.equal(m.messages[0].content[0].text, "分析这张图");
  assert.equal(m.messages[0].content[1].image_url.url, "data:image/png;base64,AAAA");
});

test("resolveProvider 预设默认 + 配置/环境覆盖", () => {
  const p = resolveProvider("qwen", {});
  assert.equal(p.model, "qwen-vl-max");
  assert.ok(p.baseUrl.includes("dashscope"));
  const custom = resolveProvider("qwen", { model: "qwen3-vl-plus", baseUrl: "https://x/v1", apiKey: "k" });
  assert.equal(custom.model, "qwen3-vl-plus");
  assert.equal(custom.apiKey, "k");
});

test("analyzeImage 成功（mock fetch）", async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts });
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ choices: [{ message: { content: "界面分析结果：布局正常" } }] }),
    };
  };
  const r = await analyzeImage(path.join(dir, "shot.png"), "分析界面", {
    provider: "qwen", apiKey: "key", fetchImpl,
  });
  assert.match(r.text, /界面分析结果/);
  assert.equal(r.model, "qwen-vl-max");
  assert.ok(calls[0].url.endsWith("/chat/completions"));
  assert.equal(calls[0].opts.headers.authorization, "Bearer key");
  const body = JSON.parse(calls[0].opts.body);
  assert.equal(body.messages[0].content[1].image_url.url.slice(0, 22), "data:image/png;base64,");
});

test("analyzeImage 无 API key 抛错", async () => {
  await assert.rejects(
    () => analyzeImage(path.join(dir, "shot.png"), "分析", { provider: "qwen", fetchImpl: async () => ({ ok: true, text: async () => "{}" }) }),
    /API Key/,
  );
});

test("analyzeImage API 错误解析 message", async () => {
  const fetchImpl = async () => ({ ok: false, status: 429, text: async () => JSON.stringify({ error: { message: "rate limit" } }) });
  await assert.rejects(
    () => analyzeImage(path.join(dir, "shot.png"), "分析", { provider: "qwen", apiKey: "k", fetchImpl }),
    /视觉接口错误 429：rate limit/,
  );
});

test("analyzeImage 空 prompt 抛错", async () => {
  await assert.rejects(() => analyzeImage(path.join(dir, "shot.png"), "  ", { provider: "qwen", apiKey: "k" }), /需要 prompt/);
});
