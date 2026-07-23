# EasyCC 模型广场 — 接入数据源（三份调研整合）

> 调研日期 2026-07-14。方法：三个 Sonnet agent WebFetch/WebSearch 核官方文档，标注置信度。
> ⚠️ 国内厂商模型名/价格换代极快，落 `providers.js` 前对照文末「必须复核清单」逐项核实。

## 接入类型分级（决定 relay 怎么接）

- **① native（原生 Anthropic 直连）**：厂商自带 `/anthropic/v1/messages` 端点，relay 只换 key+baseUrl+改模型名，零转换。**模型广场首批主推。**
- **② convert（OpenAI 兼容，需转换层）**：只有 `/v1/chat/completions`，relay 需内置 Anthropic↔OpenAI 双向转换（难点=流式状态机，参考 claude-code-router 35.8k★）。
- **🎫 plan（需订阅特定套餐）**：普通按量 Key 走不通 Anthropic，需用户单独买 Coding/Token Plan。

---

## 一、国内 · 原生直连（✅ native，7 家）— 首批主推

| 厂商 | Anthropic Base URL | 认证头 | 主力模型（✦编程强） | 拿 Key |
|---|---|---|---|---|
| DeepSeek 深度求索 | `https://api.deepseek.com/anthropic` | x-api-key / AUTH_TOKEN | deepseek-v4-pro✦(1M) / deepseek-v4-flash✦(1M) | platform.deepseek.com/api_keys |
| 阿里 Qwen 百炼 | `https://dashscope.aliyuncs.com/apps/anthropic` | Bearer / x-api-key | qwen3.7-max✦ / qwen3.7-plus✦ / qwen3.6-flash | bailian.console.aliyun.com |
| 智谱 GLM | `https://open.bigmodel.cn/api/anthropic` | x-api-key | glm-5.2✦(编程逼近Opus) / glm-5.1✦ | bigmodel.cn |
| 月之暗面 Kimi | `https://api.moonshot.cn/anthropic` | AUTH_TOKEN(待实测) | kimi-k2.7-code✦ / kimi-k2.6 | platform.moonshot.cn |
| 腾讯混元 Hunyuan | `https://api.hunyuan.cloud.tencent.com/anthropic` | x-api-key | hunyuan-2.0-thinking / -instruct | cloud.tencent.com |
| MiniMax | `https://api.minimaxi.com/anthropic` | ANTHROPIC_API_KEY | MiniMax-M3✦(1M,为CC做) / M2.5✦ | platform.minimaxi.com |
| 硅基流动 SiliconFlow | `https://api.siliconflow.cn`（`/v1/messages`） | Bearer / x-api-key | Qwen3-Coder✦ / DeepSeek-V4 / Kimi | cloud.siliconflow.com/account/ak |

**综合「原生+编程强+价格」首选：DeepSeek、GLM、Kimi、MiniMax。**

## 二、海外 · 原生直连（✅ native）

| 厂商 | Anthropic Base URL | 主力模型 | 备注 |
|---|---|---|---|
| Fireworks AI ⭐ | `https://api.fireworks.ai/inference` | DeepSeek-V4 / Qwen / Llama（用 fireworks 模型 ID） | 唯一对旗下所有开源模型开放 Anthropic 兼容层；max_tokens 可选 |
| xAI Grok | `https://api.x.ai`（不带 /v1） | grok-4.5 / grok-4.3 | ⚠️官方声称支持但未核实一手文档，上线前实测 |

> Anthropic 自家不列入广场（国内用不了，且正是要绕开的对象）。

## 三、需订阅套餐（🎫 plan，3 家）

| 厂商 | Anthropic 端点 | 模型/配置 | 套餐价 | 限制 |
|---|---|---|---|---|
| 字节豆包 Doubao（火山方舟） | `https://ark.cn-beijing.volces.com/api/coding` | ANTHROPIC_MODEL=ark-code-latest；doubao-seed-code✦(视觉编程,SWE 78.8%) | Coding Plan 9.9元/月起 | 普通 Key 无 Anthropic；套餐额度禁批量 |
| 讯飞星辰 MaaS | `https://maas-coding-api.cn-huabei-1.xf-yun.com/anthropic` | ANTHROPIC_MODEL=astron-code-latest | ¥39/月起 | Coding Plan 禁批量脚本调用 |
| 阶跃星辰 Step | `https://api.stepfun.com/step_plan` | step-3.7-flash✦ / step-3.5-flash✦ | Step Plan ¥49~699/月 | 裸 API 仅 OpenAI 协议 |

## 四、需转换层（🔧 convert，②类，规划中）

**海外**（全是 OpenAI 兼容，接 CC 需转换层）：
- OpenAI（gpt-5.6-sol/terra/luna✦，`/v1` 或新 `/v1/responses`）
- Google Gemini（gemini-3.5-flash / 2.5-pro，有 OpenAI 兼容层 `/v1beta/openai/`）
- Mistral（Large 3 / Codestral✦）
- Meta Llama 4（Meta 官方 API 已 7-6 下线，经 Together/Groq/Fireworks 调）
- Cohere（Command A）、Groq（超低延迟）、Together、OpenRouter（聚合，但 Anthropic 通道只代付真 Claude）

**国内**：
- 零一万物 Yi（❌ 无 Anthropic + 公司已转政企，可用性存疑，不宜主推）
- 百度文心 ERNIE（千帆 `/anthropic` 网关支持，但官方示例只跑第三方模型，ERNIE 自家模型经该端点待实测）

---

## 五、上线前必须人工复核清单

1. **模型名换代**：DeepSeek 旧名 `deepseek-chat`/`deepseek-reasoner` 2026-07-24 UTC 下线；`qwen-max` 降 legacy（32K）。全改 v4/qwen3.7 新名。
2. **DeepSeek**：base URL 是否带 `/v1`、人民币价格页、峰谷折扣（仅媒体报道）。
3. **认证头差异**（表单要分开处理）：智谱/腾讯/百度 Anthropic 层用 `x-api-key`；DeepSeek/百炼/Kimi 可用 `ANTHROPIC_AUTH_TOKEN`(Bearer)；硅基只写 `ANTHROPIC_API_KEY`。Kimi 端点认证头来自社区教程，curl 实测。
4. **域名分区**：Kimi(.cn/.kimi.com)、MiniMax(.minimaxi.com 大陆 vs .io 全球，Key 不互通)、Step(.com 中国 vs .ai 国际)、阿里(国际旧域名将下线)。
5. **硅基流动**：旧模型 ID 是否仍可调（定价主表已换新款），`curl /v1/models` 确认。
6. **xAI Grok**：Anthropic 兼容需真实 API 调用最终验证。
7. **零一万物 Yi**：是否仍能新注册拿 Key、维护状态。

## 六、技术落地要点

- CC 接入机制：`ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN`(→Bearer) 或 `ANTHROPIC_API_KEY`(→x-api-key)，请求打 `{BASE_URL}/v1/messages`。
- `providers.js` 每条加 `tier` 字段（native/plan/convert），native 加模型=加配置不发版；convert 共享一套转换层。
- 转换层参考：claude-code-router（35.8k★，同形态）、litellm `/v1/messages`（协议覆盖最全）。**别从零手写流式状态机。**
