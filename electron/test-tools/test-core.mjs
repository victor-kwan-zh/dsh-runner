// 测试闭环核心：探测项目测试命令并运行（纯函数 + spawn 封装，可单测）。
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

/** 输出截断上限（字节）。 */
const MAX_OUTPUT = 60 * 1024;

/** 终止进程树（Windows 用 taskkill /T，否则负 pid 杀进程组）。 */
function killTree(pid) {
  if (!pid) return;
  if (process.platform === "win32") {
    try {
      spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    } catch {
      /* ignore */
    }
    return;
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* already gone */
    }
  }
}

/**
 * 探测项目的测试命令。
 * @param {string} cwd
 * @returns {Promise<{type: string, command: string, args: string[], label: string} | null>}
 */
export async function detectTestCommand(cwd) {
  const pkgPath = path.join(cwd, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      const test = pkg?.scripts?.test;
      if (typeof test === "string" && test !== "") {
        return { type: "npm", command: "npm", args: ["test"], label: `npm test (${test})` };
      }
    } catch {
      /* ignore malformed package.json */
    }
  }
  for (const marker of ["pyproject.toml", "pytest.ini", "tox.ini"]) {
    if (fs.existsSync(path.join(cwd, marker))) {
      return { type: "pytest", command: "pytest", args: [], label: "pytest" };
    }
  }
  if (fs.existsSync(path.join(cwd, "Cargo.toml"))) {
    return { type: "cargo", command: "cargo", args: ["test"], label: "cargo test" };
  }
  if (fs.existsSync(path.join(cwd, "go.mod"))) {
    return { type: "go", command: "go", args: ["test", "./..."], label: "go test ./..." };
  }
  return null;
}

/**
 * 运行测试命令。
 * @param {string} cwd
 * @param {{command?: string, args?: string[], timeoutMs?: number, detected?: object}} opts
 * @returns {Promise<{exitCode: number | null, timedOut: boolean, stdout: string, stderr: string, command: string, label: string | null}>}
 */
export async function runTest(cwd, opts = {}) {
  const timeoutMs = Number.isFinite(opts.timeoutMs) && opts.timeoutMs > 0 ? opts.timeoutMs : 120_000;
  let runner;
  let args = [];
  let label = null;
  let shell = false;
  if (typeof opts.command === "string" && opts.command.trim() !== "") {
    const parts = opts.command.trim().split(/\s+/);
    runner = parts[0];
    args = parts.slice(1);
    if (Array.isArray(opts.args) && opts.args.length > 0) args.push(...opts.args);
    // 无法确定是否为可执行文件时走 shell（Windows 上 npm 等是 .cmd）
    shell = true;
  } else {
    const detected = opts.detected ?? (await detectTestCommand(cwd));
    if (!detected) return { exitCode: null, timedOut: false, stdout: "", stderr: "未探测到测试命令（如 package.json scripts.test）", command: "", label: null };
    runner = detected.command;
    args = detected.args;
    label = detected.label;
    if (detected.type === "npm") {
      // npm 在 Windows 是 .cmd，走 shell
      shell = true;
      if (process.platform === "win32") runner = "npm.cmd";
    }
  }

  const fullCommand = [runner, ...args].join(" ");
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    // shell 模式传完整命令字符串（Windows 下 spawn(file, args, {shell:true}) 会 EINVAL）
    const child = shell
      ? spawn(fullCommand, { cwd, shell: true, windowsHide: true })
      : spawn(runner, args, { cwd, windowsHide: true });
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child.pid);
    }, timeoutMs);
    const cap = (buf, sink) => {
      const s = buf.toString("utf8");
      return (sink + s).slice(-MAX_OUTPUT);
    };
    child.stdout?.on("data", (b) => {
      stdout = cap(b, stdout);
    });
    child.stderr?.on("data", (b) => {
      stderr = cap(b, stderr);
    });
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode: null, timedOut, stdout, stderr: `启动失败：${err.message}`, command: fullCommand, label });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode: code, timedOut, stdout, stderr, command: fullCommand, label });
    });
  });
}

export { MAX_OUTPUT };
