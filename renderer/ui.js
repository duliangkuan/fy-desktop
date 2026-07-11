/* 渲染层逻辑：页签切换 / 主题 / 启动卡片 / 设置表单
   与主进程约定见 preload.js 暴露的 window.fy */

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

/* ── 页签 ── */
const PAGES = { launch: "#page-launch", settings: "#page-settings" };

function setTab(tab) {
  $$(".nav-item").forEach((el) => el.classList.toggle("active", el.dataset.tab === tab));
  for (const [name, sel] of Object.entries(PAGES)) $(sel).hidden = name !== tab;
  if (tab === "launch") refreshBinStatus();
  if (tab === "settings") loadSettingsForm();
}

$$(".nav-item").forEach((el) => el.addEventListener("click", () => setTab(el.dataset.tab)));
document.addEventListener("click", (e) => {
  const goto = e.target.closest("[data-goto]");
  if (goto) setTab(goto.dataset.goto);
});

/* ── 标题栏 ── */
$("#minBtn").addEventListener("click", () => window.fy.winCtl("minimize"));
$("#maxBtn").addEventListener("click", () => window.fy.winCtl("maximize"));
$("#closeBtn").addEventListener("click", () => window.fy.winCtl("close"));

/* ── 主题 ── */
async function applyTheme(theme) {
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

/* ── Key 状态角标 ── */
async function refreshKeyChip() {
  const cfg = await window.fy.getConfig();
  const on = !!(cfg && cfg.apiKey);
  const chip = $("#keyChip");
  chip.textContent = on ? "Key 已配置" : "未配置 Key";
  chip.classList.toggle("on", on);
  return cfg;
}
$("#keyChip").addEventListener("click", () => setTab("settings"));

/* ── 启动卡片 ── */
async function refreshBinStatus() {
  const st = await window.fy.binStatus();
  for (const tool of ["cc", "codex"]) {
    const el = $(`#status-${tool}`);
    if (st[tool].ready) {
      el.textContent = st[tool].bundled ? "✓ 已就绪（内置组件）" : "✓ 已就绪";
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
        alert(r.error);
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

/* ── 设置页 ── */
async function loadSettingsForm() {
  const cfg = await refreshKeyChip();
  $("#apiKey").value = cfg.apiKey || "";
  $("#baseUrl").value = cfg.baseUrl || "https://api.dufengyun.xyz";
  $("#saveMsg").textContent = "";
}

$("#eyeBtn").addEventListener("click", () => {
  const input = $("#apiKey");
  const hide = input.type === "password";
  input.type = hide ? "text" : "password";
  $("#eyeBtn").textContent = hide ? "隐藏" : "显示";
});

$("#saveBtn").addEventListener("click", async () => {
  const cfg = await window.fy.getConfig();
  await window.fy.saveConfig({
    ...cfg,
    apiKey: $("#apiKey").value.trim(),
    baseUrl: $("#baseUrl").value.trim() || "https://api.dufengyun.xyz",
  });
  $("#saveMsg").textContent = "✓ 已保存";
  refreshKeyChip();
  setTimeout(() => ($("#saveMsg").textContent = ""), 2000);
});

$("#pingBtn").addEventListener("click", async () => {
  const el = $("#pingResult");
  el.className = "field-help";
  el.textContent = "测试中…";
  const r = await window.fy.ping($("#baseUrl").value.trim());
  if (r.ok) {
    el.className = "field-help ok";
    el.textContent = `✓ 网关连通，延迟 ${r.ms}ms`;
  } else {
    el.className = "field-help err";
    el.textContent = `✗ 连接失败：${r.error}`;
  }
});

/* ── 启动初始化 ── */
(async () => {
  const cfg = await refreshKeyChip();
  applyTheme(cfg.theme === "dark" ? "dark" : "light");
  $("#verText").textContent = "v" + (await window.fy.version());
  refreshBinStatus();
})();
