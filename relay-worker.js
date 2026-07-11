// EasyCC CLI 本地转发代理（独立 node 进程，由 main.js 以 ELECTRON_RUN_AS_NODE 方式 fork）。
// 为什么独立进程：Electron 主进程内嵌网络栈在 Clash TUN 下 TLS 握手会失败，
// 而纯 node（ELECTRON_RUN_AS_NODE）的 https 正常。CC 连本地 http 秒通，代理转发到网关。
// 附带能力：强制改写 model —— 不管 CC 发什么模型名，都映射到网关有的模型，彻底不依赖模型名。
const http = require("http");
const https = require("https");

const UP = process.env.RELAY_UPSTREAM || "https://api.dufengyun.xyz";
const BIG = process.env.RELAY_MODEL || "claude-sonnet-4-5";
const SMALL = process.env.RELAY_SMALL || "claude-haiku-4-5";
const target = new URL(UP);

// 网关已有的模型名放行；其余一律改写（大模型→BIG，含 haiku/fast/small 的→SMALL）
const KNOWN = /sonnet|haiku|opus|deepseek|glm/i;
function remap(model) {
  if (!model || KNOWN.test(model)) return model;
  return /haiku|fast|small|mini/i.test(model) ? SMALL : BIG;
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
          if (m !== j.model) { j.model = m; body = Buffer.from(JSON.stringify(j)); }
        }
      } catch {
        /* 非 JSON body 原样转发 */
      }
    }
    const headers = { ...req.headers, host: target.hostname };
    headers["content-length"] = Buffer.byteLength(body);
    const up = https.request(
      {
        host: target.hostname,
        port: target.port || 443,
        path: req.url,
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
