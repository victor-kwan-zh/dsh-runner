// 客户端插件包物化：把仓库内的本地客户端插件包同步到 dsh profile 的
// node_modules（@dsh-runner/<name>），使 patch 行可按包名解析，
// 从而让 dsh 的 client-modules 识别其客户端 bundle（dsh.client）。
// CJS 模块（main.js 用 require 加载）。纯函数，可单测。
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

/** dsh home（~/.dsh 或 DSH_HOME）。 */
function resolveDshHome(env = process.env) {
  return env.DSH_HOME || path.join(env.USERPROFILE || env.HOME || os.homedir(), ".dsh");
}

/** 客户端包在 profile 里的安装目录：$DSH_HOME/profiles/web/node_modules/@dsh-runner/<name>。 */
function clientPluginDest(dshHome, packageName) {
  return path.join(dshHome, "profiles", "web", "node_modules", "@dsh-runner", packageName);
}

/**
 * 把本地客户端包目录物化到 profile（复制 package.json/index.js/client.js 等）。
 * 返回安装目录。
 * @param {string} dshHome
 * @param {string} srcDir 仓库内包目录（electron/plugins/<name>）
 * @param {string} packageName 包名（@dsh-runner 作用域下的名字）
 */
function materializeClientPlugin(dshHome, srcDir, packageName) {
  if (!fs.existsSync(path.join(srcDir, "package.json"))) {
    throw new Error(`客户端插件包缺少 package.json：${srcDir}`);
  }
  const dest = clientPluginDest(dshHome, packageName);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(srcDir, dest, { recursive: true, force: true });
  return dest;
}

/** 列出仓库内所有本地客户端插件包名（electron/plugins/<dir> 下有 package.json 的目录）。 */
function listLocalClientPlugins(pluginsDir) {
  const names = [];
  if (!fs.existsSync(pluginsDir)) return names;
  for (const entry of fs.readdirSync(pluginsDir, { withFileTypes: true })) {
    if (entry.isDirectory() && fs.existsSync(path.join(pluginsDir, entry.name, "package.json"))) {
      names.push(entry.name);
    }
  }
  return names.sort();
}

module.exports = { resolveDshHome, clientPluginDest, materializeClientPlugin, listLocalClientPlugins };
