// @dsh-runner/meta · host 面：客户端插件机制的占位 host 插件（当前无 host 行为）。
const name = "dsh-runner-meta-host";
const inject = [];

function apply() {
  console.log("[dsh-runner/meta] host face loaded");
}

export { apply, inject, name };
