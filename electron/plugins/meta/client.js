// @dsh-runner/meta · 浏览器面：POC 客户端插件。
// 客户端 bundle 契约：文件执行时调用 window.__ModuleLoader__.load({ id, factory })，
// factory 收到 require，其返回值作为模块导出（CJS factory 形式）。
// 当前仅验证链路（加载即打印）；后续客户端能力（设置卡/@-mention 等）在此扩展。
window.__ModuleLoader__.load({
  id: "@dsh-runner/meta",
  factory: (require) => {
    const name = "dsh-runner-meta";
    const inject = [];

    function apply(ctx) {
      console.log("[dsh-runner/meta] client loaded in browser");
      ctx.logger?.info?.("dsh-runner/meta: client plugin active");
    }

    return { apply, inject, name };
  },
});
