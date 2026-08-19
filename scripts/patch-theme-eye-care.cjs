// 给 dsh 主题插件打补丁：新增内置 "eye-care"（护眼）主题选项。
// 效果：设置 → 外观 → 主题选择器出现第 4 个选项 浅色/深色/跟随系统/护眼，
// 选择后即时生效并持久化（host settings.yaml 的 ui-theme.preference）。
//
// 改动两处（node_modules/@deepseek-ai/dsh-client-ui-theme/lib/）：
//   1) index.js（host）：
//      - THEME_PREFERENCES 增加 "eye-care"（settings schema 放行）
//      - boot 脚本：eye-care → 深色 + body 标记 data-dsh-eye-care（启动区间生效）
//   2) client.js（浏览器 bundle）：
//      - BUILTIN_THEMES 注册 { id: "eye-care", colorScheme: "dark", tokens: <护眼令牌> }
//        （ThemePresenter 会把 tokens 以 body 内联 CSS 变量应用）
//      - THEME_PREFERENCES 增加 "eye-care"；CUBES 增加第 4 个选项；i18n 增加文案
//
// 幂等；任一目标片段缺失即抛错（dsh 升级导致代码变化时会显式暴露）。
const fs = require("node:fs");
const path = require("node:path");

const themeLib = path.join(__dirname, "..", "node_modules", "@deepseek-ai", "dsh-client-ui-theme", "lib");
const hostFile = path.join(themeLib, "index.js");
const clientFile = path.join(themeLib, "client.js");
const cssFile = path.join(__dirname, "..", "electron", "eye-care.css");

if (!fs.existsSync(hostFile) || !fs.existsSync(clientFile)) {
  console.log("[patch-theme-eye-care] dsh-client-ui-theme 未安装，跳过");
  process.exit(0);
}

// ── 1) 从 eye-care.css 提取令牌表（单一事实来源）────────────────────────────
const css = fs.readFileSync(cssFile, "utf8");
const tokens = {};
for (const m of css.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) tokens[`--${m[1]}`] = m[2].trim();
if (Object.keys(tokens).length < 30) throw new Error(`[patch-theme-eye-care] eye-care.css 令牌提取异常（${Object.keys(tokens).length} 个），请检查文件`);
const tokensLiteral = JSON.stringify(tokens);

// ── 2) 补丁定义：{ file, old, new, check } ─────────────────────────────────
const TAB = "\t";
const replacements = [
  // host: THEME_PREFERENCES
  {
    file: hostFile,
    old: `"light",\n${TAB}"dark",\n${TAB}"system"\n];`,
    new: `"light",\n${TAB}"dark",\n${TAB}"system",\n${TAB}"eye-care"\n];`,
    check: '"eye-care"',
  },
  // host: boot 脚本 dark 判定 + eye-care 标记
  {
    file: hostFile,
    old: `const dark = preference === 'dark' || systemDark\n  document.documentElement.style.colorScheme`,
    new:
      `const dark = preference === 'dark' || preference === 'eye-care' || systemDark\n` +
      `  if (preference === 'eye-care') document.body.setAttribute('data-dsh-eye-care', '1')\n` +
      `  document.documentElement.style.colorScheme`,
    check: "data-dsh-eye-care",
  },
  // client: THEME_PREFERENCES
  {
    file: clientFile,
    old: `const THEME_PREFERENCES = [\n${TAB}${TAB}${TAB}"light",\n${TAB}${TAB}${TAB}"dark",\n${TAB}${TAB}${TAB}"system"\n${TAB}${TAB}];`,
    new: `const THEME_PREFERENCES = [\n${TAB}${TAB}${TAB}"light",\n${TAB}${TAB}${TAB}"dark",\n${TAB}${TAB}${TAB}"system",\n${TAB}${TAB}${TAB}"eye-care"\n${TAB}${TAB}];`,
    check: '"eye-care"',
  },
  // client: BUILTIN_THEMES 注册 eye-care 主题
  {
    file: clientFile,
    old: `id: "dark",\n${TAB}${TAB}${TAB}colorScheme: "dark",\n${TAB}${TAB}${TAB}tokens: Object.freeze({})\n${TAB}${TAB}})])` + `;`,
    new:
      `id: "dark",\n${TAB}${TAB}${TAB}colorScheme: "dark",\n${TAB}${TAB}${TAB}tokens: Object.freeze({})\n` +
      `${TAB}${TAB}}), Object.freeze({\n` +
      `${TAB}${TAB}${TAB}id: "eye-care",\n` +
      `${TAB}${TAB}${TAB}colorScheme: "dark",\n` +
      `${TAB}${TAB}${TAB}tokens: Object.freeze(${tokensLiteral})\n` +
      `${TAB}${TAB}})])` + `;`,
    check: 'id: "eye-care"',
  },
  // client: CUBES 第 4 个选项
  {
    file: clientFile,
    old:
      `id: "system",\n${TAB}${TAB}${TAB}${TAB}labelKey: "appearance.system",\n` +
      `${TAB}${TAB}${TAB}${TAB}Icon: _deepseek_ai_dsh_client_ui_primitives.IconFollowsystemOutline16\n${TAB}${TAB}${TAB}}\n${TAB}${TAB}];`,
    new:
      `id: "system",\n${TAB}${TAB}${TAB}${TAB}labelKey: "appearance.system",\n` +
      `${TAB}${TAB}${TAB}${TAB}Icon: _deepseek_ai_dsh_client_ui_primitives.IconFollowsystemOutline16\n${TAB}${TAB}${TAB}},\n` +
      `${TAB}${TAB}${TAB}{\n` +
      `${TAB}${TAB}${TAB}${TAB}id: "eye-care",\n` +
      `${TAB}${TAB}${TAB}${TAB}labelKey: "appearance.eyeCare",\n` +
      `${TAB}${TAB}${TAB}${TAB}Icon: _deepseek_ai_dsh_client_ui_primitives.IconDarkOutline16\n${TAB}${TAB}${TAB}}\n${TAB}${TAB}];`,
    check: 'labelKey: "appearance.eyeCare"',
  },
  // client: zh 文案
  {
    file: clientFile,
    old: `"appearance.system": "跟随系统"\n${TAB}${TAB}};`,
    new: `"appearance.system": "跟随系统",\n${TAB}${TAB}${TAB}"appearance.eyeCare": "护眼"\n${TAB}${TAB}};`,
    check: '"appearance.eyeCare": "护眼"',
  },
  // client: en 文案
  {
    file: clientFile,
    old: `"appearance.system": "System"\n${TAB}${TAB}};`,
    new: `"appearance.system": "System",\n${TAB}${TAB}${TAB}"appearance.eyeCare": "Eye-care"\n${TAB}${TAB}};`,
    check: '"appearance.eyeCare": "Eye-care"',
  },
];

// ── 3) 执行（幂等：已含新标记则跳过；否则必须精确匹配一次）────────────────────
let changed = 0;
for (const { file, old, new: next, check } of replacements) {
  const content = fs.readFileSync(file, "utf8");
  if (content.includes(check)) continue; // 已打过
  const count = content.split(old).length - 1;
  if (count !== 1) {
    throw new Error(
      `[patch-theme-eye-care] ${path.basename(file)} 目标片段匹配 ${count} 次（期望 1 次），` +
        `dsh 主题插件可能已升级，请人工核对：\n${JSON.stringify(old.slice(0, 120))}`,
    );
  }
  fs.writeFileSync(file, content.replace(old, next), "utf8");
  changed += 1;
}

// ── 4) 语法自检（node --check 自动识别 ESM/CJS）──────────────────────────────
const { execFileSync } = require("node:child_process");
for (const file of [hostFile, clientFile]) {
  try {
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe", windowsHide: true });
  } catch (error) {
    throw new Error(`[patch-theme-eye-care] ${path.basename(file)} 补丁后语法错误：${String(error.stderr || error.message)}`);
  }
}

console.log(`[patch-theme-eye-care] 补丁完成：${changed} 处，eye-care 主题（${Object.keys(tokens).length} 个令牌）已注册`);
