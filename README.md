# 修仙模拟器 (Cloudflare Pages 版本)

一个基于 LLM AI 驱动的文字修仙模拟网页游戏，已完全适配 **Cloudflare Pages** 部署。
利用 **Pages Functions** 作为边缘服务端代理，彻底解决了前端直接请求 AI 服务商时的 **CORS 跨域问题** 和 **API Key 泄露风险**。

---

## 🌟 核心特性

1. **Cloudflare Pages 原生适配**：
   - 纯静态前端配合 `functions/` 目录，开箱即用，无需独立部署 Node.js 后端服务器。
2. **边缘无跨域代理 (BFF Proxy)**：
   - 前端所有 AI 请求（对话、额外剧情、人物图谱、模型列表、向量嵌入）统一请求同源 `/api/*`。
3. **环境变量托管 (ENV)**：
   - 部署者可在 Cloudflare 后台配置 `AI_API_KEY`、`AI_API_URL`、`AI_MODEL` 等，玩家访问网页无需任何配置即可直接开玩！
   - 同时保留前端自定义覆盖能力：若玩家在游戏设置面板中填写了自己的 Key，则优先使用玩家自定义 Key。
4. **额外 API 智能回退**：
   - 额外 API（用于动态世界、社交、NPC交互）若未配置，**服务端自动无缝回退使用主 API**，无需强制配置两组不同凭证。
5. **向量嵌入 (Embedding) 自适应**：
   - 支持独立配置 `EMBEDDING_API_URL`；
   - **若未配置嵌入接口，前端自动默认走浏览器本地计算**（通过本地轻量模型 Transformers.js 或分词算法），不产生报错，无缝体验。
6. **流式与非流式强控 (`FORCE_STREAM`)**：
   - 支持通过环境变量强制上游以流式请求，并内置 **SSE 流式聚合器 (Stream Collector)**，当前端为非流式时服务端实时收集并拼装为标准 JSON 返回，规避边缘超时和只支持流式的接口报错。
7. **OpenAI Responses API 深度兼容**：
   - 完美兼容 OpenAI 新一代 `/v1/responses` 接口协议，同时内置通用自适应响应提取器（兼容 OpenAI Chat / Responses API / Claude / Gemini 多种格式）。

---

## 🚀 重点指南：使用 Wrangler 命令行部署正式生产环境 (Production)

通过 Cloudflare 官方 CLI 工具 **Wrangler**，您可以直接从本地终端将整个游戏与 Functions 函数一键部署发布到 **正式生产环境 (Production)**，无需依赖第三方 Git 托管平台，全流程均可在命令行完成。

### 1. 准备工作

确保本地已安装 Node.js（推荐 v18+ 或 v20+），并在项目根目录下登录 Cloudflare 账户：

```bash
# 登录 Cloudflare（会自动拉起浏览器授权完成登录）
npx wrangler login
```

---

### 2. 首次部署：创建 Pages 项目并绑定生产分支

在 Cloudflare 上创建一个新的 Pages 项目，并显式指定正式生产分支为 `main`：

```bash
# 创建 Pages 项目，指定生产环境分支为 main
npx wrangler pages project create xiuxian-pages --production-branch main
```

> 📌 **关键说明**：`--production-branch main` 极为重要！Cloudflare Pages 会将此分支作为正式生产环境（Production Environment）。

---

### 3. 一键发布到正式生产环境 (Production Deploy)

在项目根目录下，执行以下命令将静态文件与 `functions/` 边缘函数一同发布到正式生产环境：

```bash
# 部署至正式生产环境
npx wrangler pages deploy . --project-name xiuxian-pages --branch main
```

**参数详解**：
- `.`：将当前目录下的静态资源以及 `functions/` 边缘代码打包上传。
- `--project-name xiuxian-pages`：指定目标 Pages 项目名。
- `--branch main`：**核心参数**！确保本次上传直接进入 **正式生产环境 (Production)**，并自动绑定主域名（如 `https://xiuxian-pages.pages.dev`），而不会被当作临时预览环境（Preview）。
- `--commit-dirty=true`（可选）：若本地有暂存或未提交的 git 变更，可追加此参数强制部署。

终端输出示例：
```text
✨ Success! Uploaded 128 files
✨ Compiled Worker successfully
✨ Deployment complete!
🌎 Production URL: https://xiuxian-pages.pages.dev
```

---

### 4. 通过命令行配置生产环境变量 (Production Secrets)

生产环境的敏感密钥（如 API Key）可通过 Wrangler 提供的 `secret` 命令安全注入，直接加密保存在 Cloudflare 边缘服务器，安全且绝不经过前端：

```bash
# 1. 设置主 AI API 密钥（必须，终端会提示输入 Key 并进行掩码加密）
npx wrangler pages secret put AI_API_KEY --project-name xiuxian-pages

# 2. 设置主 AI 基础地址（可选，如使用第三方中转站）
npx wrangler pages secret put AI_API_URL --project-name xiuxian-pages

# 3. 设置主模型名称（可选，如 deepseek-chat 或 gpt-4o-mini）
npx wrangler pages secret put AI_MODEL --project-name xiuxian-pages

# 4. 设置强制流式模式（可选，设为 true / false）
npx wrangler pages secret put FORCE_STREAM --project-name xiuxian-pages
```

> 💡 **提示**：更新完生产环境密钥后，重新运行一次 `npx wrangler pages deploy . --project-name xiuxian-pages --branch main`，或者在 Pages 控制台查看已激活的最新变量。

---

### 5. 生产环境运维、日志监控与验证

部署完成后，您可以在终端实时查看线上生产环境的运行状态与日志：

```bash
# 1. 实时流式监控生产环境运行日志 (Tail Live Logs)
# 玩家请求 /api/* 时的调用状态、上游大模型耗时均可在控制台实时打印
npx wrangler pages deployment tail --project-name xiuxian-pages

# 2. 查看历史部署列表及生产环境详情
npx wrangler pages deployment list --project-name xiuxian-pages
```

---

### 6. 进阶：CI/CD 自动化部署 (GitHub Actions)

如果您希望在每次 `git push` 时由 GitHub Actions 自动通过 Wrangler 部署到正式生产环境，只需在仓库中创建 `.github/workflows/deploy.yml`：

```yaml
name: Deploy to Cloudflare Pages (Production)

on:
  push:
    branches:
      - main

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout Code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Deploy to Cloudflare Pages Production
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: pages deploy . --project-name xiuxian-pages --branch main
```

---

### 7. 生产环境高频避坑要点

1. **避免被识别为预览环境 (Preview Deployment)**：
   - 始终在部署命令中带上 `--branch main`（与项目创建时的 `--production-branch` 一致）。若省略 `--branch`，Wrangler 会根据本地 git 当前分支决定，若本地不是 `main` 分支则会被 Cloudflare 降级为临时 Preview 部署。
2. **Functions 生效确认**：
   - 部署命令必须在项目根目录（即直接包含 `functions/` 的目录）执行。Wrangler 会在控制台打印 `✨ Compiled Worker successfully`，表明函数已成功编译。
3. **子路径页面跨域问题已解决**：
   - 无论访问主游戏 `game.html` 还是子目录 `xiandai/game-xiandai.html`、`mfszy/game-mfszy.html`，前端请求均已规范化为根路径 `/api/*`，生产环境下全部走同源边缘代理，绝无跨域。

---

## 🌐 方案 B：Cloudflare 控制台 Web 界面部署

若您习惯使用浏览器可视化界面，亦可直接关联 Git 仓库：

1. 将代码推送至 GitHub / GitLab 仓库。
2. 登录 [Cloudflare 控制台](https://dash.cloudflare.com/)，进入 **Workers 与 Pages** > **创建应用程序** > **Pages** > **连接到 Git**。
3. 选择仓库并配置构建向导：
   - **项目名称**：`xiuxian-pages`
   - **生产分支**：`main`
   - **框架预设**：`None`
   - **构建输出目录**：`.`
4. 点击 **保存并部署**。
5. 部署完成后，进入 **项目设置 (Settings)** -> **环境变量 (Environment variables)** -> **生产环境 (Production)** 添加环境变量（详见下方表格）。

---

## ⚙️ 环境变量配置表 (Environment Variables)

可在 Cloudflare Pages 控制台后台、Wrangler Secret 或本地 `.dev.vars` 中配置：

| 变量名 | 必填 | 说明 | 示例值 / 回退规则 |
| :--- | :---: | :--- | :--- |
| **`AI_API_KEY`** | **是** | 主 AI 模型的 API Key（免密游玩必备） | `sk-xxxxxxxxxxxxxxxx` |
| **`AI_API_URL`** | 否 | 主模型 Base URL | `https://api.openai.com/v1`（默认） |
| **`AI_MODEL`** | 否 | 主模型名称 | `gpt-4o-mini`（默认） / `deepseek-chat` |
| **`AI_TYPE`** | 否 | 接口协议类型 | `openai`（默认） / `response` / `gemini` |
| **`EXTRA_AI_API_KEY`** | 否 | 额外模型 API Key | **留空时自动回退使用 `AI_API_KEY`** |
| **`EXTRA_AI_URL`** | 否 | 额外模型 Base URL | **留空时自动回退使用 `AI_API_URL`** |
| **`EXTRA_AI_MODEL`** | 否 | 额外模型名称 | **留空时自动回退使用 `AI_MODEL`** |
| **`EXTRA_AI_TYPE`** | 否 | 额外模型协议类型 | **留空时自动回退使用 `AI_TYPE`** |
| **`EMBEDDING_API_URL`** | 否 | 远程向量嵌入接口端点 | **留空时表示未配置，系统自动使用浏览器本地计算** |
| **`EMBEDDING_API_KEY`** | 否 | 嵌入模型 API Key | **留空时自动回退使用 `AI_API_KEY`** |
| **`EMBEDDING_MODEL`** | 否 | 嵌入模型名称 | `text-embedding-3-small`（默认） |
| **`FORCE_STREAM`** | 否 | 强制流式控制 | `true`：强制流式并聚合；`false`：强制非流式；**留空：原生规则** |

> 💡 **提示**：如果您希望使用 OpenAI 新推出的 `/v1/responses` 接口，只需将 `AI_TYPE` 设为 `response`，或者将 `AI_API_URL` 直接指向结尾为 `/responses` 的端点。

---

## 💻 本地模拟与开发调试

1. 确保已安装 Node.js（v18+）。
2. 将根目录下 `.dev.vars.example` 复制一份并重命名为 `.dev.vars`：
   ```bash
   cp .dev.vars.example .dev.vars
   ```
3. 在 `.dev.vars` 中填入您的 `AI_API_KEY`。
4. 使用 Wrangler 本地模拟 Cloudflare Pages 运行环境：
   ```bash
   npx wrangler pages dev .
   ```
5. 打开浏览器访问 `http://localhost:8788` 即可进行本地功能联调与测试。

---

## 📁 架构与目录说明

```text
xiuxian-pages/
├── functions/                     # Cloudflare Pages Functions 服务端无服务器函数
│   ├── _utils.js                  # 共享核心库（ENV解析、回退机制、SSE流聚合、多格式解析）
│   └── api/
│       ├── config.js              # GET /api/config 获取系统配置状态（不泄漏Key）
│       ├── chat.js                # POST /api/chat 主模型对话代理
│       ├── extra.js               # POST /api/extra 额外/手机模型代理（自动回退主API）
│       ├── embeddings.js          # POST /api/embeddings 向量接口代理（未配置返回501）
│       └── models.js              # GET/POST /api/models 模型列表获取代理（消除跨域）
├── wrangler.toml                  # Cloudflare Pages 配置文件
├── .dev.vars.example              # 环境变量模板
├── js/
│   ├── api-calling-functions.js   # 前端 AI 调用适配层（已接入 /api/* 代理）
│   └── ...
├── supply.js                      # 向量库管理 ContextVectorManager（自适应浏览器本地/远程API）
├── game.html                      # 经典修仙主游戏
├── game-bhz.html                  # 百花宗版本
├── xiandai/                       # 现代修真分支
└── mfszy/                         # 魔法世界分支
```
