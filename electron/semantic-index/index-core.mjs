// 语义索引核心：代码库 → 分块 → TF-IDF 稀疏向量 → 余弦相似度检索。
// 纯本地实现（无外部 embedding API），确定性、可离线、可单测。
// 索引对象可 JSON 序列化持久化（~/.dsh/indexes/<workspace-hash>.json）。
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

/** 默认忽略的目录/文件（对应 .gitignore 常见项 + 构建产物）。 */
const DEFAULT_IGNORED_DIRS = new Set([
  "node_modules", ".git", ".dsh", ".dsh-index", "dist", "build", "out", "release",
  ".next", ".nuxt", ".cache", "coverage", "target", "vendor", ".venv", "venv",
]);
const DEFAULT_IGNORED_EXT = new Set([
  ".min.js", ".min.css", ".map", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico",
  ".pdf", ".zip", ".gz", ".tar", ".7z", ".exe", ".dll", ".so", ".dylib", ".class",
  ".woff", ".woff2", ".ttf", ".eot", ".lock", ".snap",
]);
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const CHUNK_LINES = 400;
const CHUNK_OVERLAP = 60;

/** 是否应忽略某相对路径（目录名/扩展名黑名单）。 */
export function shouldIgnore(relPath, opts = {}) {
  const parts = relPath.split(/[\\/]/);
  for (const part of parts) {
    if (DEFAULT_IGNORED_DIRS.has(part)) return true;
  }
  const lower = relPath.toLowerCase();
  for (const ext of DEFAULT_IGNORED_EXT) {
    if (lower.endsWith(ext)) return true;
  }
  if (opts.extraIgnore && opts.extraIgnore.some((p) => parts.includes(p) || lower.endsWith(p))) return true;
  return false;
}

/** 代码感知分词：标识符/单词/数字，转小写。 */
export function tokenize(text) {
  const tokens = text.match(/[a-zA-Z0-9_]+/g) ?? [];
  return tokens.map((t) => t.toLowerCase());
}

/** 简单词频统计。 */
export function termFreq(tokens) {
  const tf = new Map();
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
  return tf;
}

/** 按行分块（带重叠）。 */
export function chunkLines(lines, { chunkLines = CHUNK_LINES, overlap = CHUNK_OVERLAP } = {}) {
  const chunks = [];
  const step = Math.max(1, chunkLines - overlap);
  for (let start = 0; start < lines.length; start += step) {
    const end = Math.min(lines.length, start + chunkLines);
    chunks.push({ startLine: start + 1, endLine: end, text: lines.slice(start, end).join("\n") });
    if (end === lines.length) break;
  }
  return chunks;
}

/** 读取并切分一个文件为块。返回 null 表示应跳过。 */
export function chunkFile(absPath, relPath, opts = {}) {
  let stat;
  try {
    stat = fs.statSync(absPath);
  } catch {
    return null;
  }
  if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return null;
  let buf;
  try {
    buf = fs.readFileSync(absPath);
  } catch {
    return null;
  }
  if (buf.includes(0)) return null; // 二进制
  const text = buf.toString("utf8");
  const lines = text.split(/\r?\n/);
  return chunkLines(lines, opts).map((c) => ({ path: relPath, ...c }));
}

/** 递归收集文件（忽略黑名单）。 */
export function listFiles(root, opts = {}) {
  const files = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      const rel = path.relative(root, full).replace(/\\/g, "/");
      if (shouldIgnore(rel, opts)) continue;
      if (e.isDirectory()) walk(full);
      else if (e.isFile()) files.push(rel);
    }
  };
  walk(root);
  return files.sort();
}

/**
 * 构建索引：返回 { version, root, chunks: [{id, path, startLine, endLine, text}],
 *   idf: {term: number}, chunkVectors: [{id, tf: {term: count}}], chunkCount, fileCount, builtAt }。
 * 索引可 JSON 序列化。
 */
export function buildIndex(root, { files, opts } = {}) {
  const relFiles = files ?? listFiles(root, opts);
  const chunks = [];
  for (const rel of relFiles) {
    const chunked = chunkFile(path.join(root, rel), rel, opts);
    if (chunked) chunks.push(...chunked);
  }
  chunks.forEach((c, i) => {
    c.id = `c${i}`;
    c.tf = Object.fromEntries(termFreq(tokenize(c.text)));
  });
  const df = new Map();
  for (const c of chunks) for (const t of Object.keys(c.tf)) df.set(t, (df.get(t) ?? 0) + 1);
  const idf = {};
  const n = chunks.length;
  for (const [t, d] of df) idf[t] = Math.log(1 + n / (1 + d));
  return {
    version: 1,
    root,
    chunks: chunks.map(({ id, path, startLine, endLine, text }) => ({ id, path, startLine, endLine, text })),
    chunkVectors: chunks.map(({ id, tf }) => ({ id, tf })),
    idf,
    chunkCount: chunks.length,
    fileCount: relFiles.length,
    builtAt: new Date().toISOString(),
  };
}

/** 查询向量（tf*idf，词频做 sqrt 平滑）。 */
export function queryVector(query, idf) {
  const tokens = tokenize(query);
  const tf = termFreq(tokens);
  const v = {};
  for (const [t, count] of tf) {
    const w = idf[t] ?? 0;
    if (w > 0) v[t] = (1 + Math.log(count)) * w;
  }
  return v;
}

/** 余弦相似度（稀疏向量）。 */
export function cosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const iter = (m) => {
    for (const k of Object.keys(m)) {
      const v = m[k];
      if (k in b) dot += v * b[k];
      na += v * v;
    }
  };
  iter(a);
  for (const k of Object.keys(b)) nb += b[k] * b[k];
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** 索引内检索：返回 [{path, startLine, endLine, score, snippet}]，按分数降序。 */
export function search(index, query, { topK = 8, snippetLines = 10 } = {}) {
  const q = queryVector(query, index.idf);
  const scored = [];
  for (const cv of index.chunkVectors) {
    const w = {};
    for (const [t, count] of Object.entries(cv.tf)) {
      const idf = index.idf[t] ?? 0;
      if (idf > 0) w[t] = (1 + Math.log(count)) * idf;
    }
    const s = cosine(q, w);
    if (s > 0) scored.push({ id: cv.id, score: s });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK).map(({ id, score }) => {
    const c = index.chunks.find((x) => x.id === id);
    const lines = c.text.split("\n");
    const snippet = lines.slice(0, snippetLines).join("\n");
    return { path: c.path, startLine: c.startLine, endLine: c.endLine, score: round(score), snippet };
  });
}

/** 索引持久化目录（DSH_HOME/indexes）。 */
export function indexDir(dshHome) {
  return path.join(dshHome ?? path.join(os.homedir(), ".dsh"), "indexes");
}

/** 工作区索引文件路径（按工作区绝对路径哈希）。 */
export function indexFileFor(dshHome, workspacePath) {
  const hash = crypto.createHash("sha1").update(path.resolve(workspacePath)).digest("hex").slice(0, 16);
  return path.join(indexDir(dshHome), `${hash}.json`);
}

/** 保存索引。 */
export function saveIndex(index, file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(index), "utf8");
}

/** 加载索引（损坏则返回 null）。 */
export function loadIndex(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    if (data?.version !== 1 || !Array.isArray(data.chunks)) return null;
    return data;
  } catch {
    return null;
  }
}

function round(x) {
  return Math.round(x * 10000) / 10000;
}

export default {
  shouldIgnore, tokenize, termFreq, chunkLines, chunkFile, listFiles,
  buildIndex, queryVector, cosine, search, indexDir, indexFileFor, saveIndex, loadIndex,
};
