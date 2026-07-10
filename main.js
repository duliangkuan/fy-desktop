const { app, BrowserWindow, WebContentsView, ipcMain, Menu } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

// 线上网站地址（改内容/课程/证书/UI 只需在网站侧 deploy，桌面端自动同步）
const SITE_URL = process.env.FY_SITE_URL || "https://fy.dufengyun.xyz";
const TOOLBAR_H = 56;

const configPath = () => path.join(app.getPath("userData"), "config.json");
function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath(), "utf-8"));
  } catch {
    return { apiKey: "", baseUrl: "https://api.dufengyun.xyz" };
  }
}
function saveConfig(cfg) {
  fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2));
}

let win, siteView;

function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: "风云AI工具站",
    backgroundColor: "#faf8f5",
    webPreferences: { preload: path.join(__dirname, "preload.js") },
  });

  // 顶部原生工具栏（本地页面，负责启动 CC/Codex 与设置）
  win.loadFile("toolbar.html");

  // 下方加载完整线上网站
  siteView = new WebContentsView();
  win.contentView.addChildView(siteView);
  // 加桌面标识，网站据此隐藏「下载 App」入口，避免 App 里再下 App
  const ua = siteView.webContents.getUserAgent() + " FYDesktop/1.0";
  siteView.webContents.setUserAgent(ua);
  siteView.webContents.loadURL(SITE_URL);

  const layout = () => {
    const { width, height } = win.getContentBounds();
    siteView.setBounds({ x: 0, y: TOOLBAR_H, width, height: height - TOOLBAR_H });
  };
  layout();
  win.on("resize", layout);

  // 网站内的外链用系统浏览器打开（闲鱼/淘宝充值等）
  siteView.webContents.setWindowOpenHandler(({ url }) => {
    require("electron").shell.openExternal(url);
    return { action: "deny" };
  });
}

// ── CLI 启动：弹独立命令行窗口，注入专属 Key ──
function launchCli(tool) {
  const cfg = loadConfig();
  if (!cfg.apiKey) return { ok: false, error: "请先在右上角「设置」填入你的专属 API Key（在控制台→我的 API Key 获取）" };

  if (process.platform === "win32") {
    let inner;
    if (tool === "codex") {
      inner = `set FY_API_KEY=${cfg.apiKey}&& codex`;
    } else {
      inner = `set ANTHROPIC_BASE_URL=${cfg.baseUrl}&& set ANTHROPIC_AUTH_TOKEN=${cfg.apiKey}&& claude`;
    }
    const title = tool === "codex" ? "Codex" : "Claude Code";
    spawn("cmd.exe", ["/c", "start", title, "cmd", "/k", inner], {
      detached: true,
      shell: false,
      windowsHide: false,
    });
    return { ok: true };
  }
  // macOS / Linux 预留
  return { ok: false, error: "当前版本仅支持 Windows 启动 CLI" };
}

ipcMain.handle("launch", (_e, tool) => launchCli(tool));
ipcMain.handle("get-config", () => loadConfig());
ipcMain.handle("save-config", (_e, cfg) => {
  saveConfig(cfg);
  return { ok: true };
});
ipcMain.handle("go-console", () => {
  if (siteView) siteView.webContents.loadURL(`${SITE_URL}/console/keys`);
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(null); // 去掉默认菜单栏
  createWindow();
});
app.on("window-all-closed", () => app.quit());
