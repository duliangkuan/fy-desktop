/* EasyCC v3 渲染层：BYOK 无账户版
   页签：应用启动 / Skill 商店（免费开源目录）/ Memory / 设置·接入 */

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

/* ── 模型广场：接入服务商预设（BYOK 模板）──
   数据经官方文档核验（2026-07-14）。base URL / 认证约定相对稳定；
   模型名换代快，故一律做成「可编辑提示」（datalist），用户可自行覆盖填当前型号。 */
const PROVIDERS = {
  deepseek: {
    name: "DeepSeek 官方", tag: "推荐 · 注册即得",
    baseUrl: "https://api.deepseek.com/anthropic",
    models: ["deepseek-v4-flash", "deepseek-v4-pro"],
    defaultModel: "deepseek-v4-flash",
    keyUrl: "https://platform.deepseek.com/api_keys",
    help: "注册充值（10 元起）→ 创建 API Key 粘到下面。旧名 deepseek-chat/reasoner 已于 2026-07-24 下线，改用 v4-flash（便宜快）或 v4-pro（更强）。",
  },
  qwen: {
    name: "阿里 Qwen 百炼", tag: "通义千问 · 编程强",
    baseUrl: "https://dashscope.aliyuncs.com/apps/anthropic",
    models: ["qwen3.7-plus", "qwen3.7-max", "qwen3.6-flash"],
    defaultModel: "qwen3.7-plus",
    keyUrl: "https://bailian.console.aliyun.com/",
    help: "阿里云百炼控制台创建 API-KEY。编程推荐 qwen3.7-plus / qwen3.7-max。",
  },
  glm: {
    name: "智谱 GLM", tag: "GLM-5.2 · 逼近旗舰",
    baseUrl: "https://open.bigmodel.cn/api/anthropic",
    models: ["glm-5.2"],
    defaultModel: "glm-5.2",
    keyUrl: "https://bigmodel.cn/usercenter/proj-mgmt/apikeys",
    help: "智谱开放平台创建 Key。GLM-5.2 面向编程与长程任务，是当前旗舰。",
  },
  kimi: {
    name: "月之暗面 Kimi", tag: "K2.7 Code",
    baseUrl: "https://api.moonshot.cn/anthropic",
    models: ["kimi-k2.7-code", "kimi-k2.7-code-highspeed"],
    defaultModel: "kimi-k2.7-code",
    keyUrl: "https://platform.kimi.com/console/api-keys",
    help: "Kimi 开放平台创建 Key。highspeed 为高速版。",
  },
  hunyuan: {
    name: "腾讯混元", tag: "Hunyuan 2.0",
    baseUrl: "https://api.hunyuan.cloud.tencent.com/anthropic",
    models: ["hunyuan-2.0-instruct-20251111", "hunyuan-2.0-thinking-20251109"],
    defaultModel: "hunyuan-2.0-instruct-20251111",
    keyUrl: "https://console.cloud.tencent.com/hunyuan",
    help: "腾讯云控制台创建 API Key。模型名带日期戳会滚动更新，若报错请到控制台复制最新版本名填入。",
  },
  minimax: {
    name: "MiniMax", tag: "M3 · 长上下文",
    baseUrl: "https://api.minimaxi.com/anthropic",
    models: ["MiniMax-M3"],
    defaultModel: "MiniMax-M3",
    keyUrl: "https://platform.minimaxi.com/user-center/payment/token-plan",
    help: "MiniMax 大陆平台创建 Key。海外版用 api.minimax.io（Key 不互通），可在「自定义」里填该域名。",
  },
  siliconflow: {
    name: "硅基流动", tag: "多模型聚合",
    baseUrl: "https://api.siliconflow.cn",
    models: ["deepseek-ai/DeepSeek-V3.2", "Qwen/Qwen3-Coder", "moonshotai/Kimi-K2-Instruct"],
    defaultModel: "",
    keyUrl: "https://cloud.siliconflow.cn/account/ak",
    help: "聚合多家开源模型。官方未固定 CC 专用型号，请到 cloud.siliconflow.cn/models 复制你要用的 model id 填到主模型（下方仅为常见示例，以模型库为准）。",
  },
  custom: {
    name: "自定义", tag: "任意兼容接口",
    baseUrl: "",
    models: [],
    defaultModel: "",
    keyUrl: "",
    help: "填任意 Anthropic 协议兼容的接口地址与 Key（自建网关 / 其他中转 / 海外区域域名）。",
  },
};

/* ── 外链目标（在系统默认浏览器打开）── */
const OPEN_URLS = {
  repo: "https://github.com/duliangkuan/easycc",
  "skills-repo": "https://github.com/duliangkuan/easycc-skills",
};

/* ── 页签 ── */
const PAGES = ["launch", "skills", "memory", "settings"];
let currentTab = "launch";

function setTab(tab) {
  currentTab = tab;
  $$(".nav-item").forEach((el) => el.classList.toggle("active", el.dataset.tab === tab));
  for (const name of PAGES) $(`#page-${name}`).hidden = name !== tab;
  if (tab === "launch") refreshBinStatus();
  if (tab === "memory") loadMemory();
  if (tab === "settings") loadSettingsForm();
}

$$(".nav-item").forEach((el) => el.addEventListener("click", () => setTab(el.dataset.tab)));
document.addEventListener("click", (e) => {
  const goto = e.target.closest("[data-goto]");
  if (goto) return setTab(goto.dataset.goto);
  const open = e.target.closest("[data-open]");
  if (open && OPEN_URLS[open.dataset.open]) window.fy.openExternal(OPEN_URLS[open.dataset.open]);
});

/* ── 标题栏 ── */
$("#minBtn").addEventListener("click", () => window.fy.winCtl("minimize"));
$("#maxBtn").addEventListener("click", () => window.fy.winCtl("maximize"));
$("#closeBtn").addEventListener("click", () => window.fy.winCtl("close"));

/* ── 主题 ── */
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $("#iconMoon").style.display = theme === "light" ? "" : "none";
  $("#iconSun").style.display = theme === "dark" ? "" : "none";
}
$("#themeBtn").addEventListener("click", async () => {
  const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
  applyTheme(next);
  const cfg = await window.fy.getConfig();
  await window.fy.saveConfig({ ...cfg, theme: next });
});

/* ══ 网络自检（走 relay，与 CC 同路径）══ */

async function runNetCheck() {
  const diag = $("#netDiag");
  const r = await window.fy.netCheck();
  diag.hidden = r.ok;
  return r;
}
$("#diagRetryBtn").addEventListener("click", async () => {
  const st = $("#diagStatus");
  st.textContent = "检测中…";
  const r = await runNetCheck();
  st.textContent = r.ok ? "" : `仍被拦截（${r.error}），按上面办法处理后再试`;
});

/* ══ 应用启动 ══ */

async function refreshBinStatus() {
  const st = await window.fy.binStatus();
  const el = $("#status-cc");
  if (el) {
    if (st.cc.ready) {
      el.textContent = st.cc.bundled ? "✓ 已就绪（内置组件）" : "✓ 已就绪";
      el.classList.add("ready");
    } else {
      el.textContent = "首次启动将自动下载组件（仅一次）";
      el.classList.remove("ready");
    }
  }
}

$$("[data-launch]").forEach((btn) =>
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    btn.textContent = "启动中…";
    try {
      const r = await window.fy.launch(btn.dataset.launch);
      if (!r.ok) {
        await window.fy.msgbox(r.error);
        setTab("settings");
      }
    } finally {
      btn.disabled = false;
      btn.textContent = "▶ 启动";
      refreshBinStatus();
    }
  })
);

/* 下载进度（主进程推送）*/
const fmtMB = (b) => (b / 1048576).toFixed(0) + "MB";
window.fy.onProgress((p) => {
  const wrap = $(`#dl-${p.tool}`);
  if (!wrap) return;
  const bar = wrap.querySelector(".dl-bar");
  const text = wrap.querySelector(".dl-text");
  if (p.phase === "start") {
    wrap.hidden = false;
    bar.style.width = "0";
    text.textContent = `正在下载 ${p.label}（仅首次）…`;
  } else if (p.phase === "downloading") {
    bar.style.width = p.percent + "%";
    text.textContent = `${p.percent}%　${fmtMB(p.got)} / ${fmtMB(p.total)}`;
  } else if (p.phase === "extracting") {
    bar.style.width = "100%";
    text.textContent = "解压中…";
  } else {
    wrap.hidden = true;
    refreshBinStatus();
  }
});

function esc(x) {
  const d = document.createElement("span");
  d.textContent = x ?? "";
  return d.innerHTML;
}

/* ══ Memory 可视化 ══ */

let memRaw = "";
let memEditing = false;

/** 轻量 markdown 渲染（无 CDN）：标题/粗体/斜体/行内码/码块/列表/引用/链接/分割线 */
function mdRender(md) {
  if (!md || !md.trim()) {
    return '<p class="mem-empty">还没有全局 Memory。<br/><br/>点右上角「编辑」写下你希望 Claude Code 一直记住的偏好和约定；<br/>或在 CC 对话里以 <code class="md-inline">#</code> 开头发消息，CC 会自己记到这里。</p>';
  }
  const lines = esc(md).split("\n");
  let html = "", inCode = false, inList = false;
  const closeList = () => { if (inList) { html += "</ul>"; inList = false; } };
  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      closeList();
      html += inCode ? "</code></pre>" : '<pre class="md-code"><code>';
      inCode = !inCode;
      continue;
    }
    if (inCode) { html += line + "\n"; continue; }
    let l = line
      .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
      .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<i>$2</i>")
      .replace(/`([^`]+)`/g, '<code class="md-inline">$1</code>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<span class="md-link">$1</span>');
    if (/^###\s/.test(l)) { closeList(); html += `<h3>${l.slice(4)}</h3>`; }
    else if (/^##\s/.test(l)) { closeList(); html += `<h2>${l.slice(3)}</h2>`; }
    else if (/^#\s/.test(l)) { closeList(); html += `<h1>${l.slice(2)}</h1>`; }
    else if (/^\s*[-*]\s/.test(l)) { if (!inList) { html += "<ul>"; inList = true; } html += `<li>${l.replace(/^\s*[-*]\s/, "")}</li>`; }
    else if (/^>\s?/.test(l)) { closeList(); html += `<blockquote>${l.replace(/^>\s?/, "")}</blockquote>`; }
    else if (/^\s*(---|\*\*\*)\s*$/.test(l)) { closeList(); html += "<hr/>"; }
    else if (l.trim() === "") { closeList(); html += '<div class="md-gap"></div>'; }
    else { closeList(); html += `<p>${l}</p>`; }
  }
  closeList();
  if (inCode) html += "</code></pre>";
  return html;
}

async function loadMemory() {
  if (memEditing) return; // 编辑中不覆盖
  const r = await window.fy.memoryRead();
  memRaw = r.content || "";
  $("#memView").innerHTML = mdRender(memRaw);
  window.fy.memoryWatch();
}

window.fy.onMemoryChanged(() => {
  if (currentTab === "memory" && !memEditing) {
    loadMemory();
    const live = $("#memLive");
    live.textContent = "● 刚刚同步";
    setTimeout(() => (live.textContent = "● 实时同步中"), 1500);
  }
});

function setMemEditing(on) {
  memEditing = on;
  $("#memView").hidden = on;
  $("#memEditor").hidden = !on;
  $("#memEditBtn").hidden = on;
  $("#memSaveBtn").hidden = !on;
  $("#memCancelBtn").hidden = !on;
}
$("#memEditBtn").addEventListener("click", () => {
  $("#memEditor").value = memRaw;
  setMemEditing(true);
  $("#memEditor").focus();
});
$("#memCancelBtn").addEventListener("click", () => setMemEditing(false));
$("#memSaveBtn").addEventListener("click", async () => {
  const r = await window.fy.memoryWrite($("#memEditor").value);
  const msg = $("#memMsg");
  msg.className = r.ok ? "field-help ok" : "field-help err";
  msg.textContent = r.ok ? "✓ 已保存，CC 下次启动即读取" : r.error;
  setMemEditing(false);
  loadMemory();
  setTimeout(() => (msg.textContent = " "), 2500);
});

/* ══ 设置 · 接入（BYOK）══ */

let curProvider = "deepseek";
let curKeyUrl = "";

/** 模型广场：从 PROVIDERS 动态渲染服务商卡片 */
function renderProviderChips() {
  const wrap = $("#providerChips");
  wrap.innerHTML = "";
  for (const [id, p] of Object.entries(PROVIDERS)) {
    const b = document.createElement("button");
    b.className = "model-chip";
    b.dataset.provider = id;
    b.innerHTML = `<b>${esc(p.name)}</b><span>${esc(p.tag || "")}</span>`;
    b.addEventListener("click", async () => {
      const cfg = await window.fy.getConfig();
      applyProviderUI(id, cfg);
    });
    wrap.appendChild(b);
  }
}

function applyProviderUI(provider, cfg = {}) {
  curProvider = provider;
  const p = PROVIDERS[provider];
  $$(".model-chip[data-provider]").forEach((c) =>
    c.classList.toggle("active", c.dataset.provider === provider)
  );
  $("#providerHelp").textContent = p.help;
  curKeyUrl = p.keyUrl || "";
  $("#getKeyBtn").hidden = !curKeyUrl;
  $("#customFields").hidden = provider !== "custom";
  if (provider === "custom") {
    $("#baseUrl").value = cfg.baseUrl && cfg.provider === "custom" ? cfg.baseUrl : "";
  }
  // 模型候选（可编辑提示）
  const dl = $("#modelOptions");
  dl.innerHTML = p.models.map((m) => `<option value="${esc(m)}">`).join("");
  const useSaved = cfg.provider === provider;
  $("#modelInput").value = useSaved && cfg.model ? cfg.model : p.defaultModel;
  $("#smallModelInput").value = useSaved && cfg.smallModel && cfg.smallModel !== cfg.model ? cfg.smallModel : "";
}

$("#getKeyBtn").addEventListener("click", () => {
  if (curKeyUrl) window.fy.openExternal(curKeyUrl);
});

async function loadSettingsForm() {
  if (!$("#providerChips").children.length) renderProviderChips();
  const cfg = await window.fy.getConfig();
  applyProviderUI(cfg.provider || "deepseek", cfg);
  $("#apiKey").value = cfg.apiKey || "";
  $("#saveMsg").textContent = "";
  if (cfg.apiKey) checkConn();
}

$("#eyeBtn").addEventListener("click", () => {
  const input = $("#apiKey");
  const hide = input.type === "password";
  input.type = hide ? "text" : "password";
  $("#eyeBtn").textContent = hide ? "隐藏" : "显示";
});

$("#saveBtn").addEventListener("click", async () => {
  const p = PROVIDERS[curProvider];
  const model = $("#modelInput").value.trim() || p.defaultModel || "deepseek-chat";
  const small = $("#smallModelInput").value.trim() || model;
  const baseUrl = curProvider === "custom" ? $("#baseUrl").value.trim().replace(/\/+$/, "") : p.baseUrl;
  const msg = $("#saveMsg");
  if (!baseUrl) {
    msg.textContent = "接口地址不能为空";
    return;
  }
  const cfg = await window.fy.getConfig();
  await window.fy.saveConfig({
    ...cfg,
    provider: curProvider,
    baseUrl,
    apiKey: $("#apiKey").value.trim(),
    model,
    smallModel: small,
  });
  msg.textContent = "✓ 已保存";
  setTimeout(() => (msg.textContent = ""), 2000);
  setTimeout(checkConn, 800); // relay 重启后再测
});

/** 连接检测：走 relay（与 CC 完全同一条链路） */
async function checkConn() {
  const el = $("#connStatus");
  el.className = "field-help";
  el.textContent = "检测中…";
  const r = await window.fy.netCheck();
  if (r.ok) {
    el.className = "field-help ok";
    el.textContent = `✓ 连接正常 · 延迟 ${r.ms}ms（与 Claude Code 同链路实测）`;
  } else {
    el.className = "field-help err";
    el.textContent = `✗ 连接异常：${r.error} —— 若开着 VPN 请彻底退出或给服务商域名加直连规则`;
  }
}
$("#connBtn").addEventListener("click", checkConn);

/* ══ 首次启动引导 / 关于弹层 ══ */
function openOnboard() {
  $("#onboard").hidden = false;
}
async function closeOnboard() {
  $("#onboard").hidden = true;
  // 记录已看过引导：下次启动不再自动弹（写进用户 config）
  const cfg = await window.fy.getConfig();
  if (!cfg.onboarded) await window.fy.saveConfig({ ...cfg, onboarded: true });
}
$("#onboardStart").addEventListener("click", closeOnboard);
$("#onboardClose").addEventListener("click", closeOnboard);
$("#aboutBtn").addEventListener("click", openOnboard); // 底部「关于·联系作者」随时重开
// 点遮罩空白处关闭
$("#onboard").addEventListener("click", (e) => {
  if (e.target.id === "onboard") closeOnboard();
});

/* ── 启动初始化 ── */
(async () => {
  const cfg = await window.fy.getConfig();
  applyTheme(cfg.theme === "dark" ? "dark" : "light");
  $("#verText").textContent = "v" + (await window.fy.version());
  refreshBinStatus();
  if (!cfg.onboarded) openOnboard(); // 首次启动自动弹引导
  setTimeout(runNetCheck, 2500); // 等 relay 起来后自检网络
})();
