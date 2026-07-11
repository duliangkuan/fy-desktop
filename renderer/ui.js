/* EasyCC 渲染层逻辑：页签 / 主题 / 账户 / Key / 兑换 / 用量 / 公告 / 设置
   与主进程约定见 preload.js 暴露的 window.fy；后端数据全走 window.fy.api */

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const fmt = (n) => (typeof n === "number" ? n.toLocaleString() : "—");

/* ── 全局账户状态 ── */
let me = null; // /api/me 的 me 对象；null = 未登录

/* ── 页签 ── */
const PAGES = ["launch", "account", "keys", "redeem", "usage", "notice", "settings"];
const LOGIN_GATED = { keys: "#keysPanel", redeem: "#redeemWrap", usage: "#usageWrap" };

let currentTab = "launch";

function setTab(tab) {
  currentTab = tab;
  $$(".nav-item").forEach((el) => el.classList.toggle("active", el.dataset.tab === tab));
  for (const name of PAGES) $(`#page-${name}`).hidden = name !== tab;
  const gate = $(`#page-${tab} [data-gate]`);
  if (gate) {
    gate.hidden = !!me;
    $(LOGIN_GATED[tab]).hidden = !me;
  }
  if (tab === "launch") refreshBinStatus();
  if (tab === "account") renderAccount();
  if (tab === "keys" && me) loadKeys();
  if (tab === "redeem" && me) loadRedeem();
  if (tab === "usage" && me) loadUsage();
  if (tab === "notice") loadNotice();
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

/* ══ 账户 ══ */

async function refreshMe() {
  const r = await window.fy.api("/api/me");
  me = r.ok ? r.me : null;
  $("#acctText").textContent = me ? me.email.split("@")[0] : "登录 / 注册";
  $("#launchHintKey").innerHTML = me
    ? "已登录，专属 Key 自动配好，直接点启动。"
    : '<a class="link" data-goto="account">登录账户</a>后自动配好专属 Key，无需手动设置。';
  return me;
}

/** 登录后把账户的默认 Key 同步进启动配置（没有则创建） */
async function syncKeyToConfig() {
  const r = await window.fy.api("/api/keys", { method: "POST" });
  if (!r.ok || !r.key) return;
  const cfg = await window.fy.getConfig();
  if (cfg.apiKey !== r.key.key) {
    await window.fy.saveConfig({ ...cfg, apiKey: r.key.key });
  }
}

function renderAccount() {
  $("#authPanel").hidden = !!me;
  $("#mePanel").hidden = !me;
  if (me) {
    $("#meEmail").textContent = me.email;
    $("#mePoints").textContent = fmt(me.points);
    $("#meCreated").textContent = (me.createdAt || "").slice(0, 10);
  }
}

let authMode = "login";
function setAuthMode(mode) {
  authMode = mode;
  $("#segLogin").classList.toggle("active", mode === "login");
  $("#segRegister").classList.toggle("active", mode === "register");
  $("#authConfirmWrap").hidden = mode === "login";
  $("#authBtn").textContent = mode === "login" ? "登 录" : "注 册";
  $("#authMsg").textContent = " ";
  $("#authMsg").className = "field-help";
}
$("#segLogin").addEventListener("click", () => setAuthMode("login"));
$("#segRegister").addEventListener("click", () => setAuthMode("register"));

$("#authBtn").addEventListener("click", async () => {
  const email = $("#authEmail").value.trim();
  const password = $("#authPassword").value;
  const msg = $("#authMsg");
  msg.className = "field-help";
  if (!email || !password) return (msg.textContent = "邮箱和密码都要填");
  if (authMode === "register" && password !== $("#authPassword2").value) {
    msg.className = "field-help err";
    return (msg.textContent = "两次密码不一致");
  }
  $("#authBtn").disabled = true;
  msg.textContent = "请稍候…";
  try {
    const r = await window.fy.api(`/api/auth/${authMode}`, {
      method: "POST",
      body: { email, password },
    });
    if (!r.ok) {
      msg.className = "field-help err";
      msg.textContent = r.error || "失败了，稍后再试";
      return;
    }
    await refreshMe();
    await syncKeyToConfig();
    msg.className = "field-help ok";
    msg.textContent = "✓ 成功，专属 Key 已自动配好";
    renderAccount();
    setTimeout(() => setTab("launch"), 900);
  } finally {
    $("#authBtn").disabled = false;
  }
});

$("#logoutBtn").addEventListener("click", async () => {
  await window.fy.api("/api/auth/logout", { method: "POST" });
  me = null;
  await refreshMe();
  renderAccount();
});

/* ══ 我的 Key ══ */

function maskKey(k) {
  return k.length > 10 ? `${k.slice(0, 4)}······${k.slice(-6)}` : k;
}

async function loadKeys() {
  const list = $("#keyList");
  list.innerHTML = '<p class="field-help">加载中…</p>';
  const r = await window.fy.api("/api/keys");
  if (!r.ok) return (list.innerHTML = `<p class="field-help err">${r.error}</p>`);
  if (!r.keys.length) {
    list.innerHTML = "";
    const btn = document.createElement("button");
    btn.className = "btn";
    btn.textContent = "创建我的专属 Key";
    btn.addEventListener("click", async () => {
      await window.fy.api("/api/keys", { method: "POST" });
      await syncKeyToConfig();
      loadKeys();
    });
    list.appendChild(btn);
    return;
  }
  list.innerHTML = "";
  for (const k of r.keys) {
    const row = document.createElement("div");
    row.className = "key-row";
    const active = k.status === "ACTIVE";
    row.innerHTML = `
      <div class="key-main">
        <span class="mono key-text">${maskKey(k.key)}</span>
        <span class="chip ${active ? "on" : ""}">${active ? "启用中" : "已停用"}</span>
      </div>
      <div class="key-actions">
        <button class="btn btn-ghost" data-act="copy">复制</button>
        <button class="btn btn-ghost" data-act="use">用于启动</button>
        <button class="btn btn-ghost" data-act="toggle">${active ? "停用" : "启用"}</button>
        <button class="btn btn-ghost" data-act="reset">重置</button>
      </div>`;
    row.addEventListener("click", async (e) => {
      const act = e.target.closest("[data-act]")?.dataset.act;
      if (!act) return;
      const msg = $("#keysMsg");
      msg.className = "field-help";
      if (act === "copy") {
        await navigator.clipboard.writeText(k.key);
        msg.className = "field-help ok";
        msg.textContent = "✓ 已复制完整 Key";
      } else if (act === "use") {
        const cfg = await window.fy.getConfig();
        await window.fy.saveConfig({ ...cfg, apiKey: k.key });
        msg.className = "field-help ok";
        msg.textContent = "✓ 已写入启动配置";
      } else if (act === "toggle") {
        const r2 = await window.fy.api("/api/keys/toggle", {
          method: "POST",
          body: { keyId: k.id, enable: !active },
        });
        msg.className = r2.ok ? "field-help ok" : "field-help err";
        msg.textContent = r2.ok ? `✓ ${r2.message}` : r2.error;
        loadKeys();
      } else if (act === "reset") {
        const r2 = await window.fy.api("/api/keys/reset", {
          method: "POST",
          body: { keyId: k.id },
        });
        msg.className = r2.ok ? "field-help ok" : "field-help err";
        msg.textContent = r2.ok ? `✓ ${r2.message}` : r2.error;
        if (r2.ok) await syncKeyToConfig();
        loadKeys();
      }
    });
    list.appendChild(row);
  }
}

/* ══ 积分 · 兑换 ══ */

async function loadRedeem() {
  await refreshMe();
  if (!me) return;
  $("#pointsNum").textContent = fmt(me.points);
  $("#rateText").textContent = `1 积分 = ${fmt(me.exchangeQuotaPerPoint)} 额度`;
  updateExchangePreview();
}

function updateExchangePreview() {
  const n = parseInt($("#exchangeInput").value, 10);
  const el = $("#exchangePreview");
  if (me && n > 0) {
    el.textContent = `将得到 ${fmt(n * me.exchangeQuotaPerPoint)} 额度`;
  } else {
    el.textContent = " ";
  }
}
$("#exchangeInput").addEventListener("input", updateExchangePreview);

$("#activateBtn").addEventListener("click", async () => {
  const code = $("#codeInput").value.trim();
  const msg = $("#activateMsg");
  msg.className = "field-help";
  if (!code) return (msg.textContent = "先粘贴激活码");
  $("#activateBtn").disabled = true;
  msg.textContent = "激活中…";
  try {
    const r = await window.fy.api("/api/activate", { method: "POST", body: { code } });
    msg.className = r.ok ? "field-help ok" : "field-help err";
    msg.textContent = r.ok ? `✓ ${r.message}` : r.error;
    if (r.ok) {
      $("#codeInput").value = "";
      loadRedeem();
    }
  } finally {
    $("#activateBtn").disabled = false;
  }
});

$("#exchangeBtn").addEventListener("click", async () => {
  const points = parseInt($("#exchangeInput").value, 10);
  const msg = $("#exchangeMsg");
  msg.className = "field-help";
  if (!points || points < 1) return (msg.textContent = "输入要兑换的积分数（正整数）");
  $("#exchangeBtn").disabled = true;
  msg.textContent = "兑换中…";
  try {
    const r = await window.fy.api("/api/exchange", { method: "POST", body: { points } });
    msg.className = r.ok ? "field-help ok" : "field-help err";
    msg.textContent = r.ok ? `✓ ${r.message}` : r.error;
    if (r.ok) {
      $("#exchangeInput").value = "";
      loadRedeem();
    }
  } finally {
    $("#exchangeBtn").disabled = false;
  }
});

/* ══ 用量统计 ══ */

async function loadUsage() {
  const msg = $("#usageMsg");
  msg.textContent = "加载中…";
  const r = await window.fy.api("/api/usage?days=30");
  if (!r.ok) return (msg.textContent = r.error);
  if (!r.hasKey) {
    $("#remainNum").textContent = $("#usedNum").textContent = $("#reqNum").textContent = "—";
    $("#dailyChart").innerHTML = "";
    msg.textContent = "还没有 Key，先去「我的 Key」创建一个";
    return;
  }
  $("#remainNum").textContent = fmt(r.usage?.remain);
  $("#usedNum").textContent = fmt(r.usage?.used);
  $("#reqNum").textContent = fmt(r.daily.reduce((s, d) => s + d.requests, 0));

  // 纯 CSS 柱状图：30 天补齐，无数据的天画 0 高度
  const byDay = Object.fromEntries(r.daily.map((d) => [d.day, d]));
  const days = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400_000).toISOString().slice(0, 10);
    days.push({ day: d, quotaUsed: byDay[d]?.quotaUsed || 0 });
  }
  const max = Math.max(1, ...days.map((d) => d.quotaUsed));
  const chart = $("#dailyChart");
  chart.innerHTML = "";
  for (const d of days) {
    const bar = document.createElement("div");
    bar.className = "chart-bar";
    bar.style.height = `${Math.round((d.quotaUsed / max) * 100)}%`;
    bar.title = `${d.day}：${fmt(d.quotaUsed)} 额度`;
    chart.appendChild(bar);
  }
  msg.textContent = " ";
}

/* ══ 公告 ══ */

async function loadNotice() {
  const wrap = $("#noticeWrap");
  const r = await window.fy.api("/api/announcements");
  if (!r.ok) {
    wrap.innerHTML = `<p class="field-help err">${r.error}</p>`;
    return;
  }
  wrap.innerHTML = "";
  if (r.notice) {
    const el = document.createElement("div");
    el.className = "notice-item pinned";
    el.innerHTML = `<div class="notice-title">📌 置顶</div><div class="notice-body"></div>`;
    el.querySelector(".notice-body").textContent = r.notice;
    wrap.appendChild(el);
  }
  for (const it of r.items) {
    const el = document.createElement("div");
    el.className = "notice-item";
    el.innerHTML = `<div class="notice-title"></div><div class="notice-date"></div><div class="notice-body"></div>`;
    el.querySelector(".notice-title").textContent = it.title || "公告";
    el.querySelector(".notice-date").textContent = it.date || "";
    el.querySelector(".notice-body").textContent = it.content || "";
    wrap.appendChild(el);
  }
  if (!r.notice && !r.items.length) {
    wrap.innerHTML = '<p class="field-help">暂无公告</p>';
  }
}

/* ══ 应用启动 ══ */

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
        await window.fy.msgbox(r.error);
        setTab(me ? "settings" : "account");
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

/* ══ 设置 ══ */

async function loadSettingsForm() {
  const cfg = await window.fy.getConfig();
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
  const cfg = await window.fy.getConfig();
  applyTheme(cfg.theme === "dark" ? "dark" : "light");
  $("#verText").textContent = "v" + (await window.fy.version());
  refreshBinStatus();
  await refreshMe();
  if (me) syncKeyToConfig(); // 登录态下每次开 App 校准一次启动 Key
  setTab(currentTab); // 登录态确定后重放当前页签，消掉「抢先点开门禁页」的竞态
})();
