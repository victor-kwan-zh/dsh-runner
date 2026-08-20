// 用量/成本报告核心：解析 ~/.dsh/cost-tracker.json 并聚合（纯函数，可单测）。
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/** 默认成本追踪文件路径（dsh-cost-tracker 插件写入）。 */
export function costTrackerFile(dshHome) {
  return path.join(dshHome ?? path.join(os.homedir(), ".dsh"), "cost-tracker.json");
}

/** 加载成本追踪数据。返回 { entries: [], titles: {}, pricing: {} | null }（文件缺失/损坏时为空）。 */
export function loadCostTracker(dshHome) {
  const file = costTrackerFile(dshHome);
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    // 兼容两种布局：顶层数组，或 { records | entries, titles, pricing }
    const entries = Array.isArray(raw)
      ? raw
      : Array.isArray(raw?.records)
        ? raw.records
        : Array.isArray(raw?.entries)
          ? raw.entries
          : [];
    return {
      entries,
      titles: raw?.titles ?? {},
      pricing: raw?.pricing ?? null,
    };
  } catch {
    return { entries: [], titles: {}, pricing: null };
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** 按天分组键（本地时区 yyyy-mm-dd）。 */
export function dayKey(t) {
  const d = new Date(t);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * 聚合成本/用量。
 * @param {Array} entries cost-tracker 条目（{t, sessionId, provider, model, input, output, cacheRead, reasoning, cost}）
 * @param {{scope?: "all"|"today"|"session", sessionId?: string}} opts
 * @returns 结构化聚合结果
 */
export function aggregate(entries, opts = {}) {
  const scope = opts.scope ?? "all";
  const today = dayKey(Date.now());
  const sessionId = opts.sessionId;
  const filtered = entries.filter((e) => {
    if (scope === "today") return dayKey(e.t ?? 0) === today;
    if (scope === "session") return sessionId !== undefined && e.sessionId === sessionId;
    return true;
  });

  const byModel = {};
  const byDay = {};
  const bySession = {};
  let totalCost = 0;
  let totalInput = 0;
  let totalOutput = 0;
  let totalCacheRead = 0;
  let totalReasoning = 0;

  for (const e of filtered) {
    const model = e.model ?? e.provider ?? "unknown";
    const day = dayKey(e.t ?? 0);
    const sess = e.sessionId ?? "unknown";
    byModel[model] = byModel[model] ?? { calls: 0, cost: 0, input: 0, output: 0 };
    byDay[day] = byDay[day] ?? { calls: 0, cost: 0 };
    bySession[sess] = bySession[sess] ?? { calls: 0, cost: 0 };

    const cost = Number(e.cost) || 0;
    const input = Number(e.input) || 0;
    const output = Number(e.output) || 0;
    const cacheRead = Number(e.cacheRead) || 0;
    const reasoning = Number(e.reasoning) || 0;

    totalCost += cost;
    totalInput += input;
    totalOutput += output;
    totalCacheRead += cacheRead;
    totalReasoning += reasoning;

    byModel[model].calls += 1;
    byModel[model].cost += cost;
    byModel[model].input += input;
    byModel[model].output += output;
    byDay[day].calls += 1;
    byDay[day].cost += cost;
    bySession[sess].calls += 1;
    bySession[sess].cost += cost;
  }

  const round = (x) => Math.round(x * 10000) / 10000;
  const sortDesc = (obj, key) =>
    Object.entries(obj)
      .map(([k, v]) => ({ key: k, ...v }))
      .sort((a, b) => b[key] - a[key]);

  return {
    scope,
    sessionId: scope === "session" ? sessionId : undefined,
    calls: filtered.length,
    totalCost: round(totalCost),
    totalTokens: { input: totalInput, output: totalOutput, cacheRead: totalCacheRead, reasoning: totalReasoning },
    byModel: sortDesc(byModel, "cost"),
    byDay: sortDesc(byDay, "cost"),
    bySession: sortDesc(bySession, "cost").slice(0, 10),
  };
}

/** 生成可读文本摘要。 */
export function formatReport(summary, { currency = "¥", title = null } = {}) {
  const lines = [];
  if (title) lines.push(`# ${title}`);
  lines.push(`范围：${summary.scope}${summary.sessionId ? `（会话 ${summary.sessionId.slice(0, 8)}…）` : ""}`);
  lines.push(`调用次数：${summary.calls}`);
  lines.push(`总费用：${currency}${summary.totalCost.toFixed(4)}`);
  lines.push(
    `Token：输入 ${summary.totalTokens.input} / 输出 ${summary.totalTokens.output} / 缓存读取 ${summary.totalTokens.cacheRead} / 推理 ${summary.totalTokens.reasoning}`,
  );
  if (summary.byModel.length > 0) {
    lines.push("按模型：");
    for (const m of summary.byModel) lines.push(`  ${m.key}: ${currency}${m.cost.toFixed(4)}（${m.calls} 次调用）`);
  }
  if (summary.byDay.length > 0) {
    lines.push("按天：");
    for (const d of summary.byDay) lines.push(`  ${d.key}: ${currency}${d.cost.toFixed(4)}（${d.calls} 次）`);
  }
  return lines.join("\n");
}

/**
 * 阈值检查：今天的总费用是否超过阈值。
 * @param {object} summary aggregate 结果（scope=today）
 * @param {number} threshold 阈值（¥）
 * @returns {{threshold: number, exceeded: boolean, totalCost: number}}
 */
export function checkThreshold(summary, threshold) {
  const t = Number.isFinite(threshold) && threshold > 0 ? threshold : null;
  const totalCost = summary?.totalCost ?? 0;
  if (t === null) return { threshold: null, exceeded: false, totalCost };
  return { threshold: t, exceeded: totalCost > t, totalCost };
}
