// EasyCC CLI 本地转发代理（独立 node 进程，由 main.js 以系统 node 启动）。
// 为什么存在：
// 1) Claude Code(undici/BoringSSL) 在部分 VPN 的 TUN 网卡下直连 https 会 TLS 失败，
//    而系统 node(OpenSSL) 能正常握手 —— CC 连本地 http 秒通，由本进程转发到上游。
// 2) 统一模型改写：CC 默认请求的模型名（如 claude-*）上游未必有，
//    这里把主对话请求映射到用户配置的主模型、后台小任务映射到小模型。
// 上游完全由用户配置（BYOK）：DeepSeek 官方 / 硅基流动 / 任意 Anthropic 兼容网关。
const http = require("http");
const https = require("https");

const UP = process.env.RELAY_UPSTREAM || "https://api.deepseek.com/anthropic";
const MAIN = process.env.RELAY_MODEL || "deepseek-v4-flash";
const SMALL = process.env.RELAY_SMALL || MAIN;
const target = new URL(UP);
const basePath = target.pathname.replace(/\/+$/, ""); // 支持带路径的上游（如 /anthropic）

// 主对话 → MAIN；CC 的后台小任务（haiku/fast/small 特征）→ SMALL
function remap(model) {
  if (model === MAIN || model === SMALL) return model;
  return /haiku|fast|small|mini/i.test(model || "") ? SMALL : MAIN;
}

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (d) => chunks.push(d));
  req.on("end", () => {
    let body = Buffer.concat(chunks);
    if (req.url.includes("/v1/messages") && body.length) {
      try {
        const j = JSON.parse(body.toString("utf8"));
        if (j.model) {
          const m = remap(j.model);
          if (m !== j.model) {
            j.model = m;
            body = Buffer.from(JSON.stringify(j));
          }
        }
      } catch {
        /* 非 JSON body 原样转发 */
      }
    }
    const headers = { ...req.headers, host: target.hostname };
    headers["content-length"] = Buffer.byteLength(body);
    // 认证头兼容：各厂商 Anthropic 兼容层约定不一（x-api-key vs Authorization: Bearer）。
    // CC 用 ANTHROPIC_AUTH_TOKEN 时只发 Bearer。这里把 token 同时补成两种头，
    // 让任意约定的上游都能通过（服务端忽略它不认的那个），模型广场各家即插即用。
    const bearer = /^Bearer\s+(.+)$/i.exec(headers["authorization"] || "");
    const token = headers["x-api-key"] || (bearer && bearer[1]);
    if (token) {
      headers["x-api-key"] = token;
      headers["authorization"] = "Bearer " + token;
    }
    const mod = target.protocol === "http:" ? http : https;
    const up = mod.request(
      {
        host: target.hostname,
        port: target.port || (target.protocol === "http:" ? 80 : 443),
        path: basePath + req.url,
        method: req.method,
        headers,
      },
      (upres) => {
        res.writeHead(upres.statusCode, upres.headers);
        upres.pipe(res);
      }
    );
    up.on("error", (e) => {
      if (!res.headersSent) res.writeHead(502);
      res.end("relay error: " + e.message);
    });
    if (body.length) up.write(body);
    up.end();
  });
});

server.listen(Number(process.env.RELAY_PORT || 0), "127.0.0.1", () => {
  process.stdout.write("RELAY_LISTENING " + server.address().port + "\n");
});
