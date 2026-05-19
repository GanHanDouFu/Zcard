# Zcard

把短视频文案整理成可复习、可收藏、可整合的个人知识卡片。

Zcard 是一个面向黑客松演示的移动端优先 Web 原型。它解决的问题很具体：刷到有价值的视频后，内容往往停留在收藏夹里，过几天就找不到、记不住、也没有沉淀。Zcard 把这类碎片内容转成结构化卡片，再通过收藏、已读、复习、答题和多卡整合，让视频内容变成可复用的知识资产。

## 核心流程

1. 粘贴抖音/短视频文案或分享内容。
2. 调用 DeepSeek 提炼为知识卡片。
3. 自动生成标题、核心观点、关键要点、金句、行动建议和领域分类。
4. 用户可以收藏、标记已读、搜索、筛选、复习或整合多张卡片。
5. 现场网络或 API 不可用时，会自动使用本地演示模式生成卡片，保证 Demo 可继续展示。

## 功能亮点

- AI 生成知识卡片：从短视频文案中提炼结构化信息。
- 领域筛选和搜索：支持全部、收藏、未读、已读以及七类领域。
- 收藏与已读拆分：星星只代表收藏，`Get it` 只代表已读/进入复习池。
- 每日复习：从已读卡片中抽取今日复习队列。
- 滑动复习和答题复习：用更接近移动端的交互完成记忆检测。
- 多卡整合：把同一话题下的多张碎片卡片合并成一张综合卡。
- 图片导出：使用 Canvas 生成长图，不依赖额外截图库。
- 本地优先：卡片数据存储在浏览器 `localStorage` 中，适合快速演示。

## 技术栈

- 前端：原生 HTML、CSS、JavaScript
- 后端：Node.js 本地静态服务和 DeepSeek API 代理
- AI：DeepSeek Chat Completions
- 图标：Lucide Icons CDN
- 数据：浏览器 `localStorage`

## 本地运行

要求 Node.js 18 或更高版本。

```bash
npm start
```

打开：

```text
http://localhost:8080/
```

## API Key 配置

推荐使用本地后端代理，避免把密钥写进前端代码。

1. 复制 `.env.example` 为 `.env`。
2. 填写 `DEEPSEEK_API_KEY`。
3. 运行 `npm start`。

```env
PORT=8080
DEEPSEEK_API_KEY=sk-your-deepseek-api-key
```

如果没有配置 `.env`，页面里的设置按钮也可以临时填写 API Key。这个 Key 只保存在当前浏览器标签页的 `sessionStorage` 中。两种方式都不可用时，生成和整合会走本地演示兜底逻辑。

## 项目结构

```text
.
├── index.html
├── style.css
├── script.js
├── server.js
├── package.json
├── .env.example
├── .gitignore
├── tools/
│   └── validation/
│       ├── validate-cdp.js
│       ├── validate-integrate.js
│       └── validate-integrate.spec.js
├── AI_HANDOFF.md
└── .trae/documents/
    ├── PRD.md
    └── Technical_Architecture.md
```

`artifacts/` 是本地验证脚本生成的截图和结果目录，已加入 `.gitignore`。

## 验证

基础语法检查：

```bash
node --check server.js
node --check script.js
```

整合流程验证脚本在 `tools/validation/` 下。它们默认访问 `http://localhost:32456`，如果临时使用，需要先按脚本中的端口启动本地服务或调整脚本 URL。

## 黑客松展示建议

演示时优先展示这条链路：

```text
粘贴视频内容 -> AI 生成卡片 -> 收藏/Get it -> 今日复习 -> 多卡整合 -> 导出长图
```

重点讲清楚 Zcard 的价值：它不是又一个收藏夹，而是把短视频消费转成个人知识沉淀。
