// 项目记忆核心：AGENTS.md / CLAUDE.md 读取、写入（替换/追加/分区段替换）、定位。
// 纯函数，可单测。
import fs from "node:fs";
import path from "node:path";
import { GitError, isGitRepo, gitRoot } from "../git-tools/git-core.mjs";

/** 记忆文件候选名（按优先级）。 */
export const MEMORY_FILE_NAMES = ["AGENTS.md", "CLAUDE.md"];

const MAX_READ_BYTES = 64 * 1024;

/**
 * 解析工作区根目录：git 仓库根（否则回退到 cwd）。
 * @param {string} cwd
 */
export async function workspaceRoot(cwd) {
  if (await isGitRepo(cwd)) {
    try {
      return await gitRoot(cwd);
    } catch {
      /* fall through */
    }
  }
  return path.resolve(cwd);
}

/**
 * 同步解析工作区根：从 cwd 向上查找 .git（目录或 worktree 文件），最多 10 层。
 * 供 systemPrompt 动态 section 使用（同步上下文）。无 .git 时回退 cwd。
 */
export function syncWorkspaceRoot(cwd) {
  let cur = path.resolve(cwd);
  for (let i = 0; i < 10; i++) {
    const marker = path.join(cur, ".git");
    if (fs.existsSync(marker)) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return path.resolve(cwd);
}

/** 记忆文件路径：root 下已存在的候选文件，否则默认第一个（AGENTS.md）。 */
export function memoryFilePath(root, fileName) {
  const base = path.resolve(root);
  if (fileName) return path.join(base, fileName);
  for (const name of MEMORY_FILE_NAMES) {
    const p = path.join(base, name);
    if (fs.existsSync(p)) return p;
  }
  return path.join(base, MEMORY_FILE_NAMES[0]);
}

/** 读取记忆文件。 */
export function readMemory(root, { fileName, maxBytes = MAX_READ_BYTES } = {}) {
  const file = memoryFilePath(root, fileName);
  if (!fs.existsSync(file)) return { path: file, exists: false, content: "" };
  let content = fs.readFileSync(file, "utf8");
  const truncated = content.length > maxBytes;
  if (truncated) content = content.slice(0, maxBytes);
  return { path: file, exists: true, content, truncated };
}

/**
 * 写入记忆文件。
 * mode=replace：整体替换（content 为空则删除文件）。
 * mode=append：追加到末尾；若提供 section 且该 section 已存在，则替换该 section 的内容。
 * @returns {Promise<{path: string, mode: string, section: string | null}>}
 */
export async function writeMemory(root, { content, mode = "append", section, fileName } = {}) {
  const file = memoryFilePath(root, fileName);
  const body = typeof content === "string" ? content : "";
  fs.mkdirSync(path.dirname(file), { recursive: true });

  if (mode === "replace") {
    if (body.trim() === "") {
      fs.rmSync(file, { force: true });
    } else {
      fs.writeFileSync(file, body.endsWith("\n") ? body : body + "\n", "utf8");
    }
    return { path: file, mode, section: section ?? null };
  }

  if (mode === "append") {
    let existing = "";
    if (fs.existsSync(file)) existing = fs.readFileSync(file, "utf8");
    if (section && section.trim() !== "") {
      existing = upsertSection(existing, section.trim(), body);
    } else {
      const chunk = existing.endsWith("\n") || existing === "" ? body : `\n${body}`;
      existing += chunk;
    }
    const final = existing.endsWith("\n") ? existing : existing + "\n";
    fs.writeFileSync(file, final, "utf8");
    return { path: file, mode, section: section?.trim() ?? null };
  }

  throw new GitError(`未知写入模式：${mode}`);
}

/** 替换或新增一个 `## <name>` 分区（markdown 二级标题）。 */
export function upsertSection(existing, name, body) {
  const header = `## ${name}`;
  const lines = existing.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === header);
  if (start === -1) {
    const block = `${existing.trimEnd()}\n\n${header}\n${body}`;
    return block.replace(/^\n+/, "");
  }
  // 找下一个同级的 "## " 标题作为结束
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i].trim())) {
      end = i;
      break;
    }
  }
  const before = lines.slice(0, start);
  const after = lines.slice(end);
  const block = [...before, header, body, ...after];
  return block.join("\n").replace(/\n{3,}/g, "\n\n");
}

/** 列出工作区根目录下已存在的记忆文件。 */
export function listMemoryFiles(root) {
  const base = path.resolve(root);
  return MEMORY_FILE_NAMES.filter((name) => fs.existsSync(path.join(base, name))).map((name) => path.join(base, name));
}

export { GitError };
