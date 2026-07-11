const { app, BrowserWindow, ipcMain, Menu } = require("electron");
const { spawn, execFileSync } = require("child_process");
const https = require("https");
const http = require("http");
const path = require("path");
const fs = require("fs");

// CLI 二进制下载源：优先 ECS（杭州，国内快），失败兜底 GitHub Release
const BIN_SOURCES = [
  "https://api.dufengyun.xyz/download",
  "https://github.com/duliangkuan/fy-desktop/releases/download/binaries",
];

const configPath = () => path.join(app.getPath("userData"), "config.json");
const binDir = () => path.join(app.getPath("userData"), "bin");

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath(), "utf-8"));
  } catch {
    return { apiKey: "", baseUrl: "https://api.dufengyun.xyz", theme: "light" };
  }
}
function saveConfig(cfg) {
  fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2));
}

let win;

function createWindow() {
  const cfg = loadConfig();
  win = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 940,
    minHeight: 620,
    title: "风云AI工具站",
    frame: false,
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
 * claude：单文件 claude.exe。codex：codex.tar.gz 解压到 codex/（Windows 自带 tar）。
 * 返回可执行文件的完整路径。
 */
// 完整版把二进制打进了 resources/cli-bundle/，优先用它（零下载）
function bundledPath(tool) {
  const base = path.join(process.resourcesPath, "cli-bundle");
  return tool === "cc"
    ? path.join(base, "claude.exe")
    : path.join(base, "codex", "bin", "codex.exe");
}
function downloadedPath(tool) {
  return tool === "cc"
    ? path.join(binDir(), "claude.exe")
    : path.join(binDir(), "codex", "bin", "codex.exe");
}

async function ensureBinary(tool) {
  fs.mkdirSync(binDir(), { recursive: true });
  const bundled = bundledPath(tool);
  if (fs.existsSync(bundled)) return bundled; // 完整版：包内自带，不下载
  if (tool === "cc") {
    const exe = downloadedPath("cc");
    if (fs.existsSync(exe)) return exe;
    sendProgress({ tool, phase: "start", label: "Claude Code" });
    await downloadWithFallback("claude.exe", exe, (p, got, total) =>
      sendProgress({ tool, phase: "downloading", percent: p, got, total, label: "Claude Code" })
    );
    sendProgress({ tool, phase: "done" });
    return exe;
  }
  // codex（包内可执行在 bin/codex.exe）
  const codexDir = path.join(binDir(), "codex");
  const exe = downloadedPath("codex");
  if (fs.existsSync(exe)) return exe;
  const tgz = path.join(binDir(), "codex.tar.gz");
  sendProgress({ tool, phase: "start", label: "Codex" });
  await downloadWithFallback("codex.tar.gz", tgz, (p, got, total) =>
    sendProgress({ tool, phase: "downloading", percent: p, got, total, label: "Codex" })
  );
  sendProgress({ tool, phase: "extracting" });
  fs.mkdirSync(codexDir, { recursive: true });
  // Windows 10+ 自带 tar.exe
  execFileSync("tar", ["-xzf", tgz, "-C", codexDir]);
  fs.rmSync(tgz, { force: true });
  sendProgress({ tool, phase: "done" });
  if (!fs.existsSync(exe)) throw new Error("codex 解压后未找到可执行文件");
  return exe;
}

async function launchCli(tool) {
  const cfg = loadConfig();
  if (!cfg.apiKey)
    return { ok: false, error: "请先在「设置」填入你的专属 API Key（在控制台→我的 API Key 获取）" };
  if (process.platform !== "win32")
    return { ok: false, error: "当前版本仅支持 Windows 启动 CLI" };

  let exe;
  try {
    exe = await ensureBinary(tool);
  } catch (e) {
    sendProgress({ tool, phase: "error" });
    return { ok: false, error: `下载 ${tool === "codex" ? "Codex" : "Claude Code"} 失败：${e.message}` };
  }

  // 写一个 .bat 启动脚本，绕开「中文安装路径 + 引号嵌套」把命令拼坏的问题。
  // bat 放 ASCII 临时目录（用户名是 ASCII）；内部 chcp 65001 让 cmd 正确识别中文 exe 路径。
  const title = tool === "codex" ? "Codex" : "Claude Code";
  const envLines =
    tool === "codex"
      ? [`set "FY_API_KEY=${cfg.apiKey}"`]
      : [
          `set "ANTHROPIC_BASE_URL=${cfg.baseUrl}"`,
          `set "ANTHROPIC_AUTH_TOKEN=${cfg.apiKey}"`,
        ];
  // chcp 65001 必须在第一行（切 UTF-8 后，后面的中文 exe 路径才被正确读取）；不要加 BOM
  const bat = [
    "@chcp 65001 >nul",
    "@echo off",
    `title ${title}`,
    ...envLines,
    `"${exe}"`,
    "",
  ].join("\r\n");
  const batPath = path.join(require("os").tmpdir(), `fy-launch-${tool}.bat`);
  fs.writeFileSync(batPath, bat, "utf8");
  spawn("cmd.exe", ["/c", "start", title, "cmd", "/k", batPath], {
    detached: true,
    shell: false,
    windowsHide: false,
  });
  return { ok: true };
}

// ── 网关连通性：GET baseUrl，量往返毫秒 ──
function pingGateway(baseUrl) {
  return new Promise((resolve) => {
    let url;
    try {
      url = new URL(baseUrl);
    } catch {
      return resolve({ ok: false, error: "地址格式不对" });
    }
    const mod = url.protocol === "http:" ? http : https;
    const t0 = Date.now();
    const req = mod.get(url, (res) => {
      res.resume(); // 只要握上手就算通，状态码不论
      resolve({ ok: true, ms: Date.now() - t0, status: res.statusCode });
    });
    req.setTimeout(5000, () => {
      req.destroy();
      resolve({ ok: false, error: "超时（5s）" });
    });
    req.on("error", (e) => resolve({ ok: false, error: e.message }));
  });
}

// ── IPC ──
ipcMain.handle("launch", (_e, tool) => launchCli(tool));
ipcMain.handle("get-config", () => loadConfig());
ipcMain.handle("save-config", (_e, cfg) => {
  saveConfig(cfg);
  return { ok: true };
});
ipcMain.handle("app-version", () => app.getVersion());
ipcMain.handle("ping", (_e, baseUrl) => pingGateway(baseUrl));

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
      await new Promise((r) => setTimeout(r, 1200));
      await snap("launch");
      await win.webContents.executeJavaScript(`document.querySelector('[data-tab="settings"]').click()`);
      await new Promise((r) => setTimeout(r, 600));
      await snap("settings");
      await win.webContents.executeJavaScript(`document.getElementById('themeBtn').click()`);
      await new Promise((r) => setTimeout(r, 600));
      await snap("settings-dark");
      app.quit();
    });
  }
});
app.on("window-all-closed", () => app.quit());
