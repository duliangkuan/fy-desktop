const { app, BrowserWindow, ipcMain, Menu, dialog, shell } = require("electron");
const { spawn, execFileSync } = require("child_process");
const https = require("https");
const http = require("http");
const path = require("path");
const fs = require("fs");

// CLI 二进制下载源，按序兜底：OSS（北京）→ ECS（杭州）→ GitHub Release
const BIN_SOURCES = [
  "https://iaelitehub.oss-cn-beijing.aliyuncs.com/easycc",
  "https://api.dufengyun.xyz/download",
  "https://github.com/duliangkuan/easycc/releases/download/binaries",
];
// 免费 Skill 开源仓（应用内改为「跳转 GitHub 浏览」，不再应用内下载安装）
const SKILLS_REPO_URL = "https://github.com/duliangkuan/easycc-skills";
// 本项目开源仓（求 Star / 反馈入口）
const REPO_URL = "https://github.com/duliangkuan/easycc";

const configPath = () => path.join(app.getPath("userData"), "config.json");
const binDir = () => path.join(app.getPath("userData"), "bin");

// BYOK：接入配置完全属于用户（无账户、无服务端）。预设见 renderer 的 provider 模板。
const DEFAULT_CONFIG = {
  provider: "deepseek",
  apiKey: "",
  baseUrl: "https://api.deepseek.com/anthropic",
  // deepseek-chat/reasoner 已于 2026-07-24 下线，默认用新款 v4-flash（便宜快）
  model: "deepseek-v4-flash",
  smallModel: "deepseek-v4-flash",
  theme: "light",
};
function loadConfig() {
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(configPath(), "utf-8")) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}
function saveConfig(cfg) {
  fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2));
}

let win;
let cliProxyPort = 0; // 本地转发代理端口（CC 走它，见 startCliProxy）
let relayProc = null;

// ⭐本地转发代理跑在独立 node 进程（ELECTRON_RUN_AS_NODE）。
// 为什么不在 Electron 主进程：主进程内嵌网络栈在 Clash TUN 下 TLS 握手失败（实测），
// 纯 node 的 https 正常。CC 连本地 http 秒通 → worker 用 node https 转发到网关 + 改写模型名。
function relayNodeExe() {
  // 必须用 OpenSSL 的 node（Electron 内嵌 node 是 BoringSSL，在 Clash TUN 下 TLS 握手失败）。
  // 优先打包随附的 node（Windows: resources/node/node.exe，mac: resources/node/node），
  // 否则回退系统 PATH 的 node。
  const nodeName = process.platform === "win32" ? "node.exe" : "node";
  const bundled = path.join(process.resourcesPath, "node", nodeName);
  return fs.existsSync(bundled) ? bundled : "node";
}
function startCliProxy() {
  // 打包后 worker 与 node.exe 都在 asar 外的 resources/（外部 node 读不了 asar 内文件）
  const worker = app.isPackaged
    ? path.join(process.resourcesPath, "relay-worker.js")
    : path.join(__dirname, "relay-worker.js");
  const cfg = loadConfig();
  relayProc = spawn(relayNodeExe(), [worker], {
    env: {
      ...process.env,
      RELAY_UPSTREAM: cfg.baseUrl || DEFAULT_CONFIG.baseUrl,
      RELAY_MODEL: cfg.model || DEFAULT_CONFIG.model,
      RELAY_SMALL: cfg.smallModel || cfg.model || DEFAULT_CONFIG.smallModel,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  relayProc.stdout.on("data", (d) => {
    const m = String(d).match(/RELAY_LISTENING (\d+)/);
    if (m) cliProxyPort = Number(m[1]);
  });
  relayProc.stderr.on("data", (d) => console.error("[relay] " + d));
}

// 接入配置变更后重启 relay（上游/模型是进程 env，须重启生效）
function restartCliProxy() {
  try {
    if (relayProc) relayProc.kill();
  } catch {
    /* 已退出 */
  }
  cliProxyPort = 0;
  startCliProxy();
}

function createWindow() {
  const cfg = loadConfig();
  win = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 940,
    minHeight: 620,
    title: "EasyCC",
    frame: false,
    icon: path.join(__dirname, "renderer", "assets", "icon.png"),
    backgroundColor: cfg.theme === "dark" ? "#211f1c" : "#efeeeb",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      // FY_SHOT 自检：后台跑时不节流，否则切页后不重绘、截图全是旧帧
      backgroundThrottling: !process.env.FY_SHOT,
    },
  });
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
}

// ── 下载文件（带进度 + 跟随重定向，GitHub 下载会 302）──
function downloadFile(url, dest, onProgress, redirects = 0) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const tmp = dest + ".downloading";
    const file = fs.createWriteStream(tmp);
    https
      .get(url, (res) => {
        // 跟随重定向
        if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
          file.close();
          fs.rmSync(tmp, { force: true });
          if (redirects > 5) return reject(new Error("重定向过多"));
          return resolve(downloadFile(res.headers.location, dest, onProgress, redirects + 1));
        }
        if (res.statusCode !== 200) {
          file.close();
          fs.rmSync(tmp, { force: true });
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        const total = parseInt(res.headers["content-length"] || "0", 10);
        let got = 0;
        res.on("data", (chunk) => {
          got += chunk.length;
          if (total) onProgress(Math.round((got / total) * 100), got, total);
        });
        res.pipe(file);
        file.on("finish", () => file.close(() => {
          fs.renameSync(tmp, dest);
          resolve(dest);
        }));
      })
      .on("error", (e) => {
        file.close();
        fs.rmSync(tmp, { force: true });
        reject(e);
      });
  });
}

// 多源兜底：依次尝试 ECS → GitHub
async function downloadWithFallback(filename, dest, onProgress) {
  let lastErr;
  for (const base of BIN_SOURCES) {
    try {
      return await downloadFile(`${base}/${filename}`, dest, onProgress);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("所有下载源均失败");
}

function sendProgress(payload) {
  if (win && !win.isDestroyed()) win.webContents.send("cli-progress", payload);
}

/**
 * 确保工具二进制就位：不在则从自托管源下载 + 缓存。
 * claude：单文件（Windows: claude.exe，mac: claude-darwin-<arch>）。
 * codex：tar.gz 解压到 codex/（Windows 10+ / macOS 都自带 tar）。
 * 返回可执行文件的完整路径。
 */
const isWin = () => process.platform === "win32";
// 安装后本地的相对路径（与平台相关，与下载源文件名无关）
function cliRelPath(tool) {
  const ext = isWin() ? ".exe" : "";
  return tool === "cc" ? `claude${ext}` : path.join("codex", "bin", `codex${ext}`);
}
// 下载源上的文件名：Windows 沿用旧名不动存量；mac 按架构区分
function remoteName(tool) {
  if (tool === "cc") return isWin() ? "claude.exe" : `claude-darwin-${process.arch}`;
  return isWin() ? "codex.tar.gz" : `codex-darwin-${process.arch}.tar.gz`;
}
// 完整版把二进制打进了 resources/cli-bundle/，优先用它（零下载）
function bundledPath(tool) {
  return path.join(process.resourcesPath, "cli-bundle", cliRelPath(tool));
}
function downloadedPath(tool) {
  return path.join(binDir(), cliRelPath(tool));
}

async function ensureBinary(tool) {
  fs.mkdirSync(binDir(), { recursive: true });
  const bundled = bundledPath(tool);
  if (fs.existsSync(bundled)) return bundled; // 完整版：包内自带，不下载
  if (tool === "cc") {
    const exe = downloadedPath("cc");
    if (fs.existsSync(exe)) return exe;
    sendProgress({ tool, phase: "start", label: "Claude Code" });
    await downloadWithFallback(remoteName("cc"), exe, (p, got, total) =>
      sendProgress({ tool, phase: "downloading", percent: p, got, total, label: "Claude Code" })
    );
    if (!isWin()) fs.chmodSync(exe, 0o755); // 自写下载不带可执行位
    sendProgress({ tool, phase: "done" });
    return exe;
  }
  // codex（包内可执行在 bin/codex[.exe]）
  const codexDir = path.join(binDir(), "codex");
  const exe = downloadedPath("codex");
  if (fs.existsSync(exe)) return exe;
  const tgz = path.join(binDir(), "codex.tar.gz");
  sendProgress({ tool, phase: "start", label: "Codex" });
  await downloadWithFallback(remoteName("codex"), tgz, (p, got, total) =>
    sendProgress({ tool, phase: "downloading", percent: p, got, total, label: "Codex" })
  );
  sendProgress({ tool, phase: "extracting" });
  fs.mkdirSync(codexDir, { recursive: true });
  // Windows 10+ / macOS 都自带 tar
  execFileSync("tar", ["-xzf", tgz, "-C", codexDir]);
  fs.rmSync(tgz, { force: true });
  sendProgress({ tool, phase: "done" });
  if (!fs.existsSync(exe)) throw new Error("codex 解压后未找到可执行文件");
  if (!isWin()) fs.chmodSync(exe, 0o755);
  return exe;
}

async function launchCli(tool) {
  const cfg = loadConfig();
  if (!cfg.apiKey)
    return { ok: false, error: "请先在「设置」选择接入服务商并填入你自己的 API Key（如 DeepSeek 官方，注册即得）" };
  if (process.platform !== "win32" && process.platform !== "darwin")
    return { ok: false, error: "当前版本仅支持 Windows / macOS 启动 CLI" };

  let exe;
  try {
    exe = await ensureBinary(tool);
  } catch (e) {
    sendProgress({ tool, phase: "error" });
    return {
      ok: false,
      error: `下载 ${tool === "codex" ? "Codex" : "Claude Code"} 失败：${e.message}\n\n如果你开着 VPN/代理，请先关掉或把 dufengyun.xyz 设为直连，再点启动重试。`,
    };
  }

  const title = tool === "codex" ? "Codex" : "Claude Code";

  // ⭐清空代理环境变量：VPN/Clash 退出后常残留 HTTPS_PROXY 指向已死的本地代理，
  // 导致 CC(Node) 走坏代理、报 UNKNOWN_CERTIFICATE_VERIFICATION_ERROR。清掉后直连
  // 网关的合法证书。这是「关了 VPN 仍连不上」的根因修复。
  const proxyVars = [
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "http_proxy",
    "https_proxy",
    "ALL_PROXY",
    "all_proxy",
    "NODE_EXTRA_CA_CERTS",
  ];

  let toolEnv; // [名, 值] 键值对，按平台渲染成 set / export
  if (tool === "codex") {
    // Codex 不认环境变量式 Key，必须用 config.toml 定义 model_provider。
    // 关键：wire_api="chat"（网关是 chat/completions 兼容，非 responses）、
    // requires_openai_auth=false（key 非 sk- 前缀）。写进独立 CODEX_HOME 不污染用户已有 ~/.codex。
    const codexHome = path.join(app.getPath("userData"), "codex-home");
    fs.mkdirSync(codexHome, { recursive: true });
    const base = cfg.baseUrl.replace(/\/+$/, "") + "/v1";
    const configToml = [
      'model = "deepseek-ai/DeepSeek-V3.2"',
      'model_provider = "easycc"',
      "",
      "[model_providers.easycc]",
      'name = "EasyCC"',
      `base_url = "${base}"`,
      'env_key = "FY_API_KEY"',
      'wire_api = "chat"',
      "requires_openai_auth = false",
      "",
    ].join("\n");
    fs.writeFileSync(path.join(codexHome, "config.toml"), configToml, "utf8");
    toolEnv = [
      ["FY_API_KEY", cfg.apiKey],
      ["CODEX_HOME", codexHome],
    ];
  } else {
    // Claude Code：几个坑一起治（全部经真机端到端验证）——
    // 1) 走本地转发代理（cliProxyPort），绕开 CC 直连 https 网关在 TUN 下卡死
    // 2) 指定网关有的模型：CC 默认请求 claude-fable-5，网关没有→503 无限重试卡死
    // 3) 禁遥测/自动更新：statsig/datadog/sentry/downloads.claude.ai 被墙会拖慢
    // 用户配置用标准 ~/.claude（隔离已按风云要求去掉）：skills/memory/MCP/自定义命令正常加载。
    // 温和给 ~/.claude/settings.json 补 skipWebFetchPreflight（防 WebFetch 域预检连官方被墙挂 30s），
    // 仅在该字段缺失时补，保留用户其它设置。
    try {
      const dir = path.join(require("os").homedir(), ".claude");
      fs.mkdirSync(dir, { recursive: true });
      const sf = path.join(dir, "settings.json");
      let s = {};
      try {
        s = JSON.parse(fs.readFileSync(sf, "utf8"));
      } catch {
        /* 无或坏文件：当空对象 */
      }
      if (s.skipWebFetchPreflight === undefined) {
        s.skipWebFetchPreflight = true;
        fs.writeFileSync(sf, JSON.stringify(s, null, 2), "utf8");
      }
    } catch {
      /* 写不了就算了，不阻塞启动 */
    }
    const baseForCc = cliProxyPort
      ? `http://127.0.0.1:${cliProxyPort}`
      : cfg.baseUrl; // 代理没起来的兜底：直连
    toolEnv = [
      ["ANTHROPIC_BASE_URL", baseForCc],
      ["ANTHROPIC_AUTH_TOKEN", cfg.apiKey],
      ["ANTHROPIC_MODEL", cfg.model || DEFAULT_CONFIG.model],
      ["ANTHROPIC_SMALL_FAST_MODEL", cfg.smallModel || cfg.model || DEFAULT_CONFIG.smallModel],
      ["CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC", "1"],
      ["DISABLE_AUTOUPDATER", "1"],
      ["DISABLE_TELEMETRY", "1"],
      ["DISABLE_ERROR_REPORTING", "1"],
    ];
  }

  if (process.platform === "win32") {
    // 写一个 .bat 启动脚本，绕开「中文安装路径 + 引号嵌套」把命令拼坏的问题。
    // bat 放 ASCII 临时目录（用户名是 ASCII）；内部 chcp 65001 让 cmd 正确识别中文 exe 路径。
    // chcp 65001 必须在第一行（切 UTF-8 后，后面的中文 exe 路径才被正确读取）；不要加 BOM
    const bat = [
      "@chcp 65001 >nul",
      "@echo off",
      `title ${title}`,
      ...proxyVars.map((k) => `set "${k}="`),
      ...toolEnv.map(([k, v]) => `set "${k}=${v}"`),
      `"${exe}"`,
      "",
    ].join("\r\n");
    const batPath = path.join(require("os").tmpdir(), `fy-launch-${tool}.bat`);
    fs.writeFileSync(batPath, bat, "utf8");
    // ⭐start 的第一个参数是窗口标题：必须用带引号的空串 "" 占位。
    // 之前直接传 title，"Codex"(无空格) 不被自动加引号 → start 把它当程序名去执行
    // → codex.exe 收到 "/k" 报 unexpected argument。空 "" 占位后 cmd /k 正常执行，标题由 bat 内 title 设。
    spawn("cmd.exe", ["/c", "start", "", "cmd", "/k", batPath], {
      detached: true,
      shell: false,
      windowsHide: false,
    });
  } else {
    // macOS：写 shell 启动脚本，open -a Terminal 在新终端窗口里执行。
    // 值里只做双引号内转义（\ $ ` "），API Key / 路径都安全。
    const shq = (s) => `"${String(s).replace(/([\\"$`])/g, "\\$1")}"`;
    const sh = [
      "#!/bin/bash",
      `printf '\\033]0;${title}\\007'`, // 终端窗口标题
      `unset ${proxyVars.join(" ")}`,
      ...toolEnv.map(([k, v]) => `export ${k}=${shq(v)}`),
      `exec ${shq(exe)}`,
      "",
    ].join("\n");
    const shPath = path.join(require("os").tmpdir(), `fy-launch-${tool}.command`);
    fs.writeFileSync(shPath, sh, "utf8");
    fs.chmodSync(shPath, 0o755);
    spawn("open", ["-a", "Terminal", shPath], { detached: true });
  }
  return { ok: true };
}

// ── IPC ──
ipcMain.handle("launch", (_e, tool) => launchCli(tool));
// 在系统默认浏览器打开外链（Skill 商店跳转 / 求 Star / 反馈）
ipcMain.handle("open-external", (_e, url) => {
  if (typeof url === "string" && /^https?:\/\//.test(url)) shell.openExternal(url);
});
ipcMain.handle("get-config", () => loadConfig());
ipcMain.handle("save-config", (_e, cfg) => {
  const prev = loadConfig();
  saveConfig(cfg);
  // 接入配置变了 → 重启 relay 让上游/模型即时生效
  if (
    prev.baseUrl !== cfg.baseUrl ||
    prev.model !== cfg.model ||
    prev.smallModel !== cfg.smallModel
  ) {
    restartCliProxy();
  }
  return { ok: true };
});
ipcMain.handle("app-version", () => app.getVersion());

// ── 网络自检：经 relay（node/OpenSSL，与 CC 同路径）测网关连通 ──
ipcMain.handle("net-check", () => {
  return new Promise((resolve) => {
    if (!cliProxyPort) return resolve({ ok: false, error: "本地代理未就绪" });
    const t0 = Date.now();
    const req = http.get({ host: "127.0.0.1", port: cliProxyPort, path: "/" }, (res) => {
      res.resume();
      // relay 返回 502 = 它连不上网关（多为 VPN 劫持）；其余状态码都算通
      if (res.statusCode === 502) resolve({ ok: false, error: "网关连接被拦截" });
      else resolve({ ok: true, ms: Date.now() - t0 });
    });
    req.setTimeout(12000, () => {
      req.destroy();
      resolve({ ok: false, error: "连接超时" });
    });
    req.on("error", (e) => resolve({ ok: false, error: e.message }));
  });
});

// ── Memory：读写 ~/.claude/CLAUDE.md + fs.watch 实时推送 ──
const memoryPath = () => path.join(require("os").homedir(), ".claude", "CLAUDE.md");
let memoryWatcher = null;

ipcMain.handle("memory-read", () => {
  try {
    return { ok: true, content: fs.readFileSync(memoryPath(), "utf8") };
  } catch {
    return { ok: true, content: "" }; // 还没有 memory 文件也算正常
  }
});
ipcMain.handle("memory-write", (_e, content) => {
  try {
    fs.mkdirSync(path.dirname(memoryPath()), { recursive: true });
    fs.writeFileSync(memoryPath(), content, "utf8");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});
ipcMain.handle("memory-watch", () => {
  if (memoryWatcher) return { ok: true };
  try {
    fs.mkdirSync(path.dirname(memoryPath()), { recursive: true });
    // watch 目录而非文件：编辑器/CC 常用「写临时文件再改名」保存，watch 文件会断
    memoryWatcher = fs.watch(path.dirname(memoryPath()), (_ev, fname) => {
      if (fname === "CLAUDE.md" && win && !win.isDestroyed()) {
        win.webContents.send("memory-changed");
      }
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});
ipcMain.handle("msgbox", (_e, message) =>
  dialog.showMessageBox(win, { type: "warning", title: "EasyCC", message, buttons: ["确定"] })
);

ipcMain.handle("bin-status", () => {
  const st = {};
  for (const tool of ["cc", "codex"]) {
    const bundled = fs.existsSync(bundledPath(tool));
    st[tool] = { ready: bundled || fs.existsSync(downloadedPath(tool)), bundled };
  }
  return st;
});

ipcMain.handle("win-ctl", (_e, action) => {
  if (!win) return;
  if (action === "minimize") win.minimize();
  else if (action === "maximize") (win.isMaximized() ? win.unmaximize() : win.maximize());
  else if (action === "close") win.close();
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  startCliProxy();

  // FY_NET_TEST=1：诊断 Electron 主进程 https 到网关通不通（3 种方式）
  if (process.env.FY_NET_TEST) {
    const dns = require("dns");
    const tryReq = (label, opts, extra) =>
      new Promise((r) => {
        const t0 = Date.now();
        const rq = https.request(opts, (res) => { res.resume(); r(label + ": " + res.statusCode + " (" + (Date.now() - t0) + "ms)"); });
        rq.setTimeout(9000, () => { rq.destroy(); r(label + ": TIMEOUT"); });
        rq.on("error", (e) => r(label + ": ERR " + e.message));
        rq.end();
      });
    (async () => {
      console.log("NET1 " + (await tryReq("hostname", { host: "api.dufengyun.xyz", port: 443, path: "/", method: "GET" })));
      const ip = await new Promise((r) => dns.lookup("api.dufengyun.xyz", (e, a) => r(a || "?")));
      console.log("NET dns.lookup -> " + ip);
      console.log("NET2 " + (await tryReq("realIP+SNI", { host: "115.29.233.78", servername: "api.dufengyun.xyz", port: 443, path: "/", method: "GET", headers: { host: "api.dufengyun.xyz" } })));
      app.quit();
    })();
    return;
  }

  // FY_CC_TEST=1：端到端自检——用产品完全一致的内置代理+环境变量跑真 claude.exe，验证出 token
  if (process.env.FY_CC_TEST) {
    setTimeout(() => {
      const cfg = loadConfig();
      const ccHome = path.join(app.getPath("userData"), "cc-home");
      fs.mkdirSync(ccHome, { recursive: true });
      fs.writeFileSync(
        path.join(ccHome, "settings.json"),
        JSON.stringify({ skipWebFetchPreflight: true }),
        "utf8"
      );
      const exe = fs.existsSync(bundledPath("cc")) ? bundledPath("cc") : downloadedPath("cc");
      const env = {
        ...process.env,
        HTTP_PROXY: "", HTTPS_PROXY: "", ALL_PROXY: "", NODE_EXTRA_CA_CERTS: "",
        ANTHROPIC_BASE_URL: `http://127.0.0.1:${cliProxyPort}`,
        ANTHROPIC_AUTH_TOKEN: cfg.apiKey,
        ANTHROPIC_MODEL: cfg.model || DEFAULT_CONFIG.model,
        ANTHROPIC_SMALL_FAST_MODEL: cfg.smallModel || cfg.model || DEFAULT_CONFIG.smallModel,
        CLAUDE_CONFIG_DIR: ccHome,
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
        DISABLE_AUTOUPDATER: "1", DISABLE_TELEMETRY: "1", DISABLE_ERROR_REPORTING: "1",
      };
      console.log("SELFTEST proxy=127.0.0.1:" + cliProxyPort + " key=" + (cfg.apiKey || "").slice(0, 8) + " exe=" + exe);
      const cc = spawn(exe, ["-p", "只回三个字：你好呀", "--dangerously-skip-permissions"], { env, stdio: ["ignore", "pipe", "pipe"] });
      let out = "";
      cc.stdout.on("data", (d) => (out += d));
      cc.stderr.on("data", (d) => process.stderr.write("[cc-err] " + d));
      cc.on("close", (code) => { console.log("SELFTEST CC_EXIT=" + code + " OUTPUT=[" + out.trim() + "]"); app.quit(); });
      setTimeout(() => { cc.kill(); console.log("SELFTEST TIMEOUT"); app.quit(); }, 45000);
    }, 1500);
    return;
  }

  createWindow();

  // UI 自检截图：FY_SHOT=1 npm start → 存 launch/settings 两页 png 后退出
  if (process.env.FY_SHOT) {
    const shotDir = process.env.FY_SHOT_DIR || app.getPath("temp");
    win.webContents.once("did-finish-load", async () => {
      const snap = async (name) => {
        win.webContents.invalidate(); // 强制重绘再截，避免拿到旧合成帧
        await new Promise((r) => setTimeout(r, 300));
        const img = await win.webContents.capturePage();
        fs.writeFileSync(path.join(shotDir, `fy-${name}.png`), img.toPNG());
      };
      await new Promise((r) => setTimeout(r, 1500));
      for (const tab of ["launch", "skills", "memory", "settings"]) {
        await win.webContents.executeJavaScript(
          `(document.querySelector('[data-tab="${tab}"]') || document.querySelector('[data-goto="${tab}"]')).click()`
        );
        await new Promise((r) => setTimeout(r, tab === "skills" ? 3000 : 900));
        await snap(tab);
        if (tab === "memory") {
          // 实时刷新自动验证：外部改 CLAUDE.md → fs.watch 应推动界面更新 → 再截一张对比
          const mp = path.join(require("os").homedir(), ".claude", "CLAUDE.md");
          const bak = fs.existsSync(mp) ? fs.readFileSync(mp, "utf8") : null;
          fs.writeFileSync(mp, "# EasyCC 实时刷新验证\n\n- 这行字是**外部写入**的\n- 界面若显示本内容 = fs.watch 生效\n\n> 引用块样式检查\n\n`行内代码` 与 **粗体** 混排\n", "utf8");
          await new Promise((r) => setTimeout(r, 1200));
          await snap("memory-live");
          if (bak === null) fs.rmSync(mp, { force: true });
          else fs.writeFileSync(mp, bak, "utf8");
        }
      }
      await win.webContents.executeJavaScript(`document.getElementById('themeBtn').click()`);
      await new Promise((r) => setTimeout(r, 600));
      await snap("settings-dark");
      app.quit();
    });
  }
});
app.on("window-all-closed", () => app.quit());
