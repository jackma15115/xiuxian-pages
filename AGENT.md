# 🤖 AI Agent 接入新游戏全流程改造指南 (AGENT.md)

> 本文档专为后续接入新游戏、新剧本（DLC）或新玩法的 AI Agent 编写。  
> 详细阐述本项目在 **Cloudflare Pages + Functions** 边缘计算架构下的设计原则、改造标准、依赖拓扑与避坑清单。

---

## 一、 核心架构与设计哲学 (Architecture & Principles)

本项目采用 **纯静态前端 + Cloudflare Pages Functions 边缘代理** 架构，核心设计原则如下：

1. **零跨域 (Zero CORS) & 密钥完全隔离**：
   - 玩家端无需暴露任何 API Key。大模型 Key、URL、Model 均托管在 Cloudflare Pages 环境变量中。
   - 前端所有 AI 请求统一发往同源相对路径 `/api/chat` 和 `/api/extra`，彻底杜绝跨域问题。
2. **端到端 SSE 流式保活（规避 100 秒边缘超时）**：
   - **超时元凶**：Cloudflare 边缘代理对静默 HTTP 连接有 **100~125 秒硬性超时 (Error 524)**。
   - **解决方案**：前端默认以 SSE 模式发起请求。后端 Function 无论上游大模型是流式还是非流式，**均以毫秒级向前端返回 HTTP 200 与 SSE 流**，并定时泵入心跳注释（`: ping\n\n`）。连接绝不空闲，大模型推演 2~3 分钟的长剧情也不会中断。
3. **极度克制的 Functions 配额保护**：
   - Cloudflare Pages 免费版每日仅 10 万次 Functions 调用。
   - **禁止启动探测**：页面打开时**零网络请求**，严禁在 `onInit`、`onload` 中自动探测 `/api/config`。
   - **向量默认纯本地**：Embedding 默认走浏览器本地模型（`transformers.js`）或关键词匹配，严禁开局调云端。
   - **本地向量缓存**：`supply.js` 内置 1000 条 LRU 缓存，同一段文本绝不重复计算向量。
   - **故障自动熔断**：云端向量调用失败时（如 501 未配置），自动在本地禁用云端开关并静默回退本地，不弹窗打断游戏。

---

## 二、 游戏目录组织与规范 (Directory Conventions)

已有游戏布局参考：
- **经典修仙**（根目录）：[`game.html`](file:///D:/workspace/xiuxian-pages/game.html) + [`xiuxian-config.js`](file:///D:/workspace/xiuxian-pages/xiuxian-config.js)
- **白虎宗 DLC**（根目录）：[`game-bhz.html`](file:///D:/workspace/xiuxian-pages/game-bhz.html) + [`bhz-config.js`](file:///D:/workspace/xiuxian-pages/bhz-config.js)
- **现代都市**（独立子目录）：[`xiandai/game-xiandai.html`](file:///D:/workspace/xiuxian-pages/xiandai/game-xiandai.html) + [`xiandai/xiandai-config.js`](file:///D:/workspace/xiuxian-pages/xiandai/xiandai-config.js)
- **魔道宗门**（独立子目录）：[`mfszy/game-mfszy.html`](file:///D:/workspace/xiuxian-pages/mfszy/game-mfszy.html) + [`mfszy/mfszy-config.js`](file:///D:/workspace/xiuxian-pages/mfszy/mfszy-config.js)

### 新游戏接入推荐形式
- **小型 DLC / 派生版**：直接置于根目录下，命名为 `game-<name>.html` + `<name>-config.js`。
- **全新世界观 / 独立资源包**：在根目录下创建新文件夹 `<gamename>/`，内含 `game-<gamename>.html` + `<gamename>-config.js`。

---

## 三、 标准依赖拓扑顺序 (Script Dependency Order)

无论新游戏在根目录还是子目录，HTML 内的 `<script>` 标签**必须遵循以下拓扑顺序**：

```html
<!-- 1. 外部库与基础支持 -->
<script src="https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/transformers.min.js"></script>

<!-- 2. 核心数据与向量知识库引擎 -->
<script src="../supply.js"></script>           <!-- 向量检索、Embedding缓存、本地模型管理 -->
<script src="../matrix-manager.js"></script>   <!-- History 矩阵智能检索 -->
<script src="../combat-skills.js"></script>    <!-- 战斗技能库（若需要） -->
<script src="../combat-system-complete.js"></script> <!-- 战斗系统主引擎（若需要） -->

<!-- 3. API 请求代理层（核心） -->
<script src="../js/api-calling-functions.js"></script> <!-- 封装 /api/chat、/api/extra 与 SSE 流式 -->

<!-- 4. 统一配置弹窗与游戏核心子系统 -->
<script src="../js/config-modal.js"></script>       <!-- 动态生成游戏配置模态窗 -->
<script src="../js/game-core-systems.js"></script>   <!-- 设置保存、历史记录、视角切换 -->
<script src="../js/game-initialization.js"></script> <!-- 配置读取、状态恢复、调试面板 -->

<!-- 5. 提示词与用户交互处理 -->
<script src="../js/ai-message-builder.js"></script>  <!-- 组装包含历史/矩阵/状态的 Prompt -->
<script src="../js/user-input-handler.js"></script>  <!-- 监听输入、显示 loading、驱动 callAI -->
<script src="../character-creation.js"></script>    <!-- 开局角色生成逻辑 -->

<!-- 6. 新游戏专属剧本配置（最后加载） -->
<script src="./mygame-config.js"></script>
```
*(注：若新游戏置于根目录，上述 `../` 替换为 `./` 或直接使用根路径 `/`)*

---

## 四、 新游戏改造 7 步标准化流程 (Step-by-Step Checklist)

当用户提供一个外部纯静态游戏 HTML/JS 并要求接入本项目时，AI Agent 必须依次完成以下 7 步改造：

### Step 1: 路径与同源引用规范化
- 检查新 HTML 中的所有静态资源（CSS、JS、IMG）。
- 如果游戏位于子目录下（如 `mygame/game.html`）：
  - 公共脚本引用必须指向上一级目录，如 `../supply.js`、`../js/api-calling-functions.js`。
  - **严禁**把公共基础库重复拷贝一份放入子目录中造成版本分裂。

### Step 2: 剔除直接网络请求，接入 Functions 代理
1. **全局排查直接 `fetch()`**：
   - 查找代码中的 `fetch(fullEndpoint)`、`fetch('https://api.openai.com/...')` 等外部直连代码。
   - 全部替换为调用 [`callAI(userMessage, isTest, originalUserInput)`](file:///D:/workspace/xiuxian-pages/js/api-calling-functions.js#L145) 或 [`callExtraAI(messages, systemPrompt)`](file:///D:/workspace/xiuxian-pages/js/api-calling-functions.js#L160)。
2. **移除启动时的网络探测**：
   - 严禁调用 `/api/config` 或自动向大模型发送无意义探测。
   - 检查并确保游戏启动守卫函数直接通过：
     ```javascript
     window.isApiConfigured = function() {
         return true; // 交由 Functions 边缘端环境变量处理，前端无需本地拦截
     };
     ```

### Step 3: 适配端到端 SSE 流式与进度反馈
新游戏的推演主流程必须遵循以下生命周期：
```javascript
// 1. 显示加载中与进度提示
const historyDiv = document.getElementById('gameHistory');
const loadingDiv = document.createElement('div');
loadingDiv.className = 'message ai-message';
loadingDiv.id = 'loading-message';
loadingDiv.innerHTML = '<div class="message-content"><span class="loading"></span> AI推演中...</div>';
historyDiv.appendChild(loadingDiv);

try {
    // 2. 组装增强提示词（包含上下文、状态矩阵）
    const enhancedInput = buildEnhancedPrompt(userText);

    // 3. 调用 AI（api-calling-functions.js 默认走 SSE，并实时把接收字数刷在 loading-message 上）
    const response = await callAI(enhancedInput, false, userText);

    // 4. 移除 loading 提示
    const loading = document.getElementById('loading-message');
    if (loading) loading.remove();

    // 5. 交付游戏专有解析器渲染剧情与选项
    handleAIResponse(response);
} catch (error) {
    const loading = document.getElementById('loading-message');
    if (loading) loading.remove();
    displayErrorMessageWithRetry('推演失败：' + error.message, async () => {
        await regenerateLastResponse();
    });
}
```

### Step 4: 向量检索容错与本地化对齐
在处理大模型返回数据存入向量库的逻辑中（通常位于 `handleAIResponse` 或游戏存档处），**必须包含故障自动回退**：
```javascript
// 添加到向量记忆库
if (window.contextVectorManager && window.contextVectorManager.isInitialized) {
    window.contextVectorManager.addConversation(
        userMessage,
        aiResponseStory,
        gameState.variables
    ).catch(err => {
        console.warn('向量库添加失败，自动切换为关键词检索:', err);
        // 自动降级本地与关键词方法
        window.contextVectorManager.setEmbeddingMethod('keyword');
        window.contextVectorManager.useCloudEmbedding = false;
        const cloudChk = document.getElementById('enableCloudEmbedding');
        if (cloudChk) cloudChk.checked = false;
        const methodSelect = document.getElementById('vectorMethod');
        if (methodSelect) methodSelect.value = 'keyword';
    });
}
```

### Step 5: 配置弹窗与 LocalStorage 同步
确保新游戏在初始化时调用标准弹窗生成：
```javascript
// 在游戏启动代码（如 startGame 或 DOMContentLoaded）中：
if (typeof loadConfigModal === 'function') {
    loadConfigModal(); // 动态注入配置 HTML 并恢复用户保存在 localStorage('gameConfig') 的配置
}
```
配置项将自动与云端接口开关、浏览器本地模型（`transformers`）、历史记忆轮数完成数据绑定。

### Step 6: 注册至总启动台 ([`index.html`](file:///D:/workspace/xiuxian-pages/index.html))
编辑根目录下的 [`index.html`](file:///D:/workspace/xiuxian-pages/index.html)：
在 `.game-buttons` 区域添加新游戏入口卡片或按钮：
```html
<div class="game-buttons">
    <a href="game.html" class="btn">觅长生 v1.7</a>
    <a href="game-bhz.html" class="btn btn-secondary">白虎宗</a>
    <a href="xiandai/game-xiandai.html" class="btn btn-secondary">现代都市</a>
    <!-- 🆕 新增游戏入口 -->
    <a href="mygame/game-mygame.html" class="btn btn-secondary">新游戏名称</a>
</div>
```

### Step 7: 本地模拟与代码验证
完成修改后，AI Agent 必须执行以下检查确保无语法及逻辑错误：
1. **语法检查**：
   ```powershell
   $OutputEncoding = [System.Text.Encoding]::UTF8; Get-Content ./path/to/new-game.js -Encoding utf8 -Raw | node --check
   ```
2. **本地边缘测试**：
   ```bash
   npx wrangler pages dev .
   ```
   在浏览器访问 `http://localhost:8788/mygame/game-mygame.html`，验证：
   - 页面加载时 **控制台网络面板无任何针对 `/api/*` 的自发请求**；
   - 用户点击交互时，触发对 `/api/chat` 的 **SSE 请求**；
   - 加载动画中实时出现 `AI推演中... (已接收 N 字)`；
   - 生成完毕后选项正常渲染、状态栏正常增量变动。

---

## 五、 核心 API 快速参考表 (Cheat Sheet)

| 函数 / 对象 | 所在文件 | 职责说明 |
| :--- | :--- | :--- |
| `callAI(prompt, isTest, userMsg)` | `js/api-calling-functions.js` | 主 AI 调用。默认以 SSE 模式请求 `/api/chat` 并聚合后返回完整文本。 |
| `callExtraAI(messages, sysPrompt)` | `js/api-calling-functions.js` | 额外 AI 调用。发往 `/api/extra`，服务端未配置时自动继承主模型。 |
| `window.contextVectorManager` | `supply.js` | 向量记忆库实例。管理本地/云端 Embedding、LRU 缓存与历史召回。 |
| `generateConfigModal()` | `js/config-modal.js` | 动态将配置面板 DOM 插入到页面，提供云端向量开关与 API 调试。 |
| `loadConfig()` | `js/game-initialization.js` | 从 `localStorage.getItem('gameConfig')` 加载玩家设置并恢复 UI 状态。 |
| `saveGameSettings()` | `js/game-core-systems.js` | 保存游戏全局设置（视角、记忆深度、模型方式）。 |

---

## 六、 常见踩坑点 (Pitfalls to Avoid)

1. **不要重写 API 调用逻辑**：  
   新游戏绝不要在自己的 HTML/JS 里单独写 `fetch`、`axios` 或 `XMLHttpRequest`，必须直接调用公共模块 `callPagesFunctionApi`。
2. **小心中文正则编码与 Windows PowerShell**：  
   在 PowerShell 终端下通过管道向 node 传递 JS 代码检查时，必须指定 `$OutputEncoding = [System.Text.Encoding]::UTF8`，否则全角括号 `（` 会被转换为乱码问号破坏正则。
3. **保留游戏原有的局部变量增量更新系统**：  
   大部分衍生游戏使用 `applyVariableChanges(variableChanges)` 来处理属性、背包、人物好感度的增量变化，务必完整保留该逻辑，不要破坏其与 `gameState.variables` 的绑定。
4. **云端 Embedding 必须默认为 false**：  
   新游戏中涉及向量化配置时，`useCloudEmbedding` 初始值必须为 `false`，绝不能默认开启，保证用户在未配置云端向量环境时不报错、零成本运行。
