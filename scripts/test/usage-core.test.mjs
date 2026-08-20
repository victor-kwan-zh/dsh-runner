// usage-core 单元测试：成本数据加载 + 聚合（按模型/天/会话）。
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadCostTracker, aggregate, formatReport, dayKey } from "../../electron/usage-tools/usage-core.mjs";

let home;

before(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-usage-"));
  // 构造：两天、两个模型、两个会话的调用记录
  const now = Date.now();
  const yesterday = now - 24 * 60 * 60 * 1000;
  const fixture = [
    { key: "a1", t: yesterday, sessionId: "sess-a", provider: "deepseek-official", model: "deepseek-v4-flash", input: 1000, output: 2000, cacheRead: 5000, reasoning: 500, cost: 0.01 },
    { key: "a2", t: yesterday, sessionId: "sess-a", provider: "deepseek-official", model: "deepseek-v4-pro", input: 500, output: 500, cacheRead: 0, reasoning: 300, cost: 0.02 },
    { key: "b1", t: now, sessionId: "sess-b", provider: "deepseek-official", model: "deepseek-v4-flash", input: 200, output: 300, cacheRead: 100, reasoning: 0, cost: 0.005 },
    { key: "b2", t: now, sessionId: "sess-b", provider: "deepseek-official", model: "deepseek-v4-flash", input: 100, output: 100, cacheRead: 50, reasoning: 0, cost: 0.002 },
  ];
  fs.writeFileSync(path.join(home, "cost-tracker.json"), JSON.stringify({
    entries: fixture,
    titles: { "sess-a": "会话A", "sess-b": "会话B" },
    pricing: { currency: "¥" },
  }));
});

after(() => fs.rmSync(home, { recursive: true, force: true }));

test("loadCostTracker 解析数据", () => {
  const { entries, titles, pricing } = loadCostTracker(home);
  assert.equal(entries.length, 4);
  assert.equal(titles["sess-a"], "会话A");
  assert.equal(pricing.currency, "¥");
});

test("loadCostTracker 文件缺失/损坏返回空", () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-usage-empty-"));
  try {
    assert.deepEqual(loadCostTracker(empty), { entries: [], titles: {}, pricing: null });
    fs.writeFileSync(path.join(empty, "cost-tracker.json"), "not json");
    assert.deepEqual(loadCostTracker(empty), { entries: [], titles: {}, pricing: null });
  } finally {
    fs.rmSync(empty, { recursive: true, force: true });
  }
});

test("aggregate all 汇总全部", () => {
  const s = aggregate(loadCostTracker(home).entries, { scope: "all" });
  assert.equal(s.calls, 4);
  assert.equal(s.totalCost, 0.037);
  assert.equal(s.totalTokens.input, 1800);
  assert.equal(s.totalTokens.output, 2900);
  assert.equal(s.byModel.length, 2);
  // 按费用排序：pro 0.02 第一，flash 0.017 第二
  assert.equal(s.byModel[0].key, "deepseek-v4-pro");
  assert.equal(s.byModel[1].cost, 0.017);
});

test("aggregate today 只统计今天", () => {
  const s = aggregate(loadCostTracker(home).entries, { scope: "today" });
  assert.equal(s.calls, 2);
  assert.equal(s.totalCost, 0.007);
});

test("aggregate session 按会话过滤", () => {
  const s = aggregate(loadCostTracker(home).entries, { scope: "session", sessionId: "sess-a" });
  assert.equal(s.calls, 2);
  assert.equal(s.totalCost, 0.03);
  assert.equal(s.sessionId, "sess-a");
});

test("dayKey 生成 yyyy-mm-dd", () => {
  assert.match(dayKey(1787142726000), /^\d{4}-\d{2}-\d{2}$/);
});

test("loadCostTracker 兼容 records 布局", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-usage-records-"));
  try {
    fs.writeFileSync(path.join(d, "cost-tracker.json"), JSON.stringify({
      version: 1,
      records: [{ key: "x1", t: Date.now(), sessionId: "s", provider: "p", model: "m", input: 1, output: 1, cacheRead: 0, reasoning: 0, cost: 0.001 }],
      titles: {},
      pricing: { currency: "¥" },
    }));
    const { entries } = loadCostTracker(d);
    assert.equal(entries.length, 1);
    assert.equal(aggregate(entries, { scope: "all" }).totalCost, 0.001);
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

test("formatReport 生成可读文本", () => {
  const s = aggregate(loadCostTracker(home).entries, { scope: "all" });
  const text = formatReport(s, { currency: "¥", title: "测试报告" });
  assert.match(text, /# 测试报告/);
  assert.match(text, /总费用：¥0\.037/);
  assert.match(text, /按模型：/);
  assert.match(text, /按天：/);
});
