// 修复 Windows 下 node-pty 原生编译的 MSB8040：
// node-pty 的 binding.gyp 显式请求 Spectre 缓解（'SpectreMitigation': 'Spectre'），
// 若本机 VS 工具链未安装 "Spectre-mitigated libraries" 组件，node-gyp 编译必然失败。
// 该脚本把该值改为 'false'，避免对 Spectre 库的依赖（本地终端库风险可忽略）。
// 通过 package.json 的 postinstall 在每次 npm install 后自动执行。
const fs = require("node:fs");
const path = require("node:path");

const bindingGyp = path.join(__dirname, "..", "node_modules", "node-pty", "binding.gyp");
const FROM = "'SpectreMitigation': 'Spectre'";
const TO = "'SpectreMitigation': 'false'";

if (!fs.existsSync(bindingGyp)) {
  console.log("[patch-node-pty] node_modules/node-pty not found, skip");
  process.exit(0);
}

const content = fs.readFileSync(bindingGyp, "utf8");
if (!content.includes(FROM)) {
  if (content.includes("'SpectreMitigation': 'false'")) {
    console.log("[patch-node-pty] already patched");
  } else {
    console.log("[patch-node-pty] SpectreMitigation pattern not found, skip (node-pty may have changed)");
  }
  process.exit(0);
}

fs.writeFileSync(bindingGyp, content.replace(FROM, TO), "utf8");
console.log("[patch-node-pty] binding.gyp patched: SpectreMitigation -> false");
