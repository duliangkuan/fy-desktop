# EasyCC

**中国大陆的普通人，三分钟用上 Claude Code。**

不用翻墙、不用海外订阅、不用配环境——装上 EasyCC，填一个你自己的国产大模型 API Key（如 DeepSeek 官方，注册充 10 块就能用很久），点一下「▶ 启动」，就能在终端里使用 Claude Code 写代码、改项目、跑任务。

开源 · MIT · **无账户、无追踪、不经手你的任何数据**——你的 Key 只存在你本机，请求只发生在你和模型服务商之间。

## 为什么需要它

Claude Code 是当前最强的 AI 编程 Agent，但在中国大陆用它有三道坎：网络不通、订阅太贵、配置太繁。EasyCC 把三道坎一次铲平：

- **网络**：内置本地转发通道（系统 node/OpenSSL），实测穿透常见 VPN TUN 网卡的 TLS 兼容问题；运行组件从国内源下载；连接被代理劫持时给出一键诊断
- **成本**：BYOK（Bring Your Own Key）——用你自己的 DeepSeek / 硅基流动 / 任意 Anthropic 兼容接口，按量付费，几块钱起步
- **配置**：预设服务商模板，填 Key 即用；模型改写自动把 CC 请求映射到你选的模型，无需理解任何协议细节

## 功能

| 页签 | 说明 |
|---|---|
| 应用启动 | 一键启动 Claude Code，运行组件首次自动下载（国内三源兜底） |
| Skill 商店 | 免费开源 Skill 目录（[easycc-skills](https://github.com/duliangkuan/easycc-skills)），一键跳转 GitHub 浏览、按说明装到 `~/.claude/skills/`，欢迎 PR 投稿 |
| Memory | Claude Code 全局记忆（CLAUDE.md）可视化：漂亮渲染、直接编辑、文件变化实时同步 |
| 设置 · 接入 | 模型广场：7 家国产原生 Anthropic 直连（DeepSeek / 阿里 Qwen / 智谱 GLM / Kimi / 腾讯混元 / MiniMax / 硅基流动）+ 自定义，一键填地址、模型名可编辑、直达拿 Key，配主/小模型 + 与 CC 同链路连接检测 |

## 架构

```
┌─────────────────────────────────────────────────────────┐
│ EasyCC (Electron)                                        │
│                                                          │
│  ┌────────────┐   spawn    ┌───────────────────────┐    │
│  │  桌面 UI    │──────────▶│  claude.exe (官方原版)  │    │
│  │ 启动/Skill/ │            │  ANTHROPIC_BASE_URL=   │    │
│  │ Memory/设置 │            │  http://127.0.0.1:port │    │
│  └────────────┘            └───────────┬───────────┘    │
│        │                               │ http(本地回环)   │
│        │ fs.watch                      ▼                 │
│  ┌────────────┐            ┌───────────────────────┐    │
│  │ ~/.claude/ │            │ relay-worker (系统node) │    │
│  │ CLAUDE.md  │            │ · 穿透 VPN TUN 的 TLS   │    │
│  │ skills/    │◀──安装──── │ · 模型名自动改写         │    │
│  └────────────┘            └───────────┬───────────┘    │
└────────────────────────────────────────┼────────────────┘
                                         │ https (你的Key)
                              ┌──────────▼──────────┐
                              │  你选择的模型服务商    │
                              │  DeepSeek官方/硅基/…  │
                              └─────────────────────┘
```

两个关键设计：

1. **本地转发通道**：Claude Code 内置的 HTTP 客户端（undici/BoringSSL）在部分 VPN 的 TUN 虚拟网卡下 TLS 握手会失败，而系统 node（OpenSSL）不受影响。EasyCC 让 CC 连本地回环、由独立 node 进程转发到服务商——这也是打包体积里带一个 node.exe 的原因。
2. **模型自动改写**：CC 默认请求的模型名服务商未必有。转发层把主对话映射到你配置的主模型、后台小任务映射到小模型，任何 Anthropic 兼容接口即插即用。

## 安装

从 [Releases](../../releases) 或官网 [fy.dufengyun.xyz](https://fy.dufengyun.xyz) 下载 `EasyCC-Setup-*.exe`（Windows 10/11），双击安装。

上手三步：设置·接入选服务商填 Key → 回启动页点「▶ 启动」→ 终端里直接对话。

## 开发

```bash
npm install
npm start           # 开发运行
npm run dist        # 打包 NSIS 安装包
# 自检模式
FY_SHOT=1 npx electron .      # 全页截图自检
FY_CC_TEST=1 npx electron .   # 端到端跑真 CC 验证出 token
```

## 声明

本项目与 Anthropic 无关，「Claude Code」名称仅作兼容性事实说明。EasyCC 不提供任何模型服务，不销售任何 API 额度；请使用你自己的服务商账号并遵守其服务条款。

## 关于作者

我是风云，在做 AI 工具与内容的一人公司实验。感谢赛博禅心。

| 个人微信 | 赞赏 | 公众号 | 交流群 |
|---|---|---|---|
| ![](assets/wechat_personal_qr.png) | ![](assets/wechat_reward_qr.png) | ![](assets/wechat_official_qr.png) | ![](assets/wechat_group_qr.png) |

## License

[MIT](LICENSE)
