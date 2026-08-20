// skills 校验：每个 SKILL.md 的 frontmatter（name/description）与目录结构合法。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const skillsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "skills");

function listSkills() {
  return fs.readdirSync(skillsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(skillsDir, e.name, "SKILL.md")))
    .map((e) => e.name)
    .sort();
}

function parseFrontmatter(md) {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!m) return null;
  const raw = m[1];
  const fields = {};
  for (const line of raw.split(/\r?\n/)) {
    const kv = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (kv) fields[kv[1]] = kv[2].replace(/^["']|["']$/g, "");
  }
  return { fields, bodyStart: m[0].length };
}

test("skills 目录存在且包含编程 skills", () => {
  const skills = listSkills();
  assert.ok(skills.length >= 10, `应至少 10 个 skill，实际 ${skills.length}`);
});

test("每个 skill 的 frontmatter 合法（name/description + kebab-case + 正文非空）", () => {
  const skills = listSkills();
  for (const name of skills) {
    const md = fs.readFileSync(path.join(skillsDir, name, "SKILL.md"), "utf8");
    const parsed = parseFrontmatter(md);
    assert.ok(parsed, `${name}: 缺少 YAML frontmatter`);
    const { fields, bodyStart } = parsed;
    assert.ok(fields.name, `${name}: 缺少 name`);
    assert.ok(fields.description, `${name}: 缺少 description`);
    assert.match(fields.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, `${name}: name 必须 kebab-case`);
    assert.equal(fields.name, name, `${name}: frontmatter name 与目录名一致`);
    assert.ok(md.slice(bodyStart).trim().length > 200, `${name}: 正文太短`);
  }
});

test("skill 引用的工具名存在（git_*/semantic_*/checkpoint_* 等）", () => {
  const skills = listSkills();
  const allText = skills.map((s) => fs.readFileSync(path.join(skillsDir, s, "SKILL.md"), "utf8")).join("\n");
  // 至少引用了我们的一部分工具族
  for (const tool of ["git_status", "test_run", "semantic_search", "changeset_review", "checkpoint_create", "memory_read"]) {
    assert.ok(allText.includes(tool), `skills 应引用工具 ${tool}`);
  }
});
