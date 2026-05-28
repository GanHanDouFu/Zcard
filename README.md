# Zcard

把短视频文案整理成可复习、可收藏、可整合的个人知识卡片。

Zcard 是一个移动端优先的 Web 应用。它解决的问题很具体：刷到有价值的视频后，内容往往停留在收藏夹里，过几天就找不到、记不住、也没有沉淀。Zcard 把这类碎片内容转成结构化卡片，再通过收藏、已读、复习、AI 补充和多卡整合，让视频内容变成可复用的知识资产。

线上 Demo：[zcard-production.up.railway.app](https://zcard-production.up.railway.app/)

## 核心流程

1. 粘贴抖音/短视频文案或分享内容。
2. 调用 DeepSeek 提炼为知识卡片。
3. 自动生成标题、核心观点、关键要点、金句、行动建议和领域分类。
4. 用户可以收藏、标记已读、搜索、筛选、复习或整合多张卡片。
5. 在编辑器里用类 WPS 的局部颜色标记圈出重点，AI 还能基于卡片主题生成补充内容。
6. 现场网络或 API 不可用时，会自动使用本地演示模式生成卡片，保证 Demo 可继续展示。

如果只粘贴视频链接，当前版本会先提示补充字幕、转录文本或较完整文案，避免 AI 根据标题硬编。

## 功能亮点

- AI 生成知识卡片：从短视频文案中提炼结构化信息。
- 内容质量保护：仅链接或极短分享文案不会直接生成正式卡片。
- 领域筛选和搜索：支持全部、收藏、未读、已读以及七类领域，可自定义新增分类。
- 收藏与已读拆分：星星只代表收藏，`Get it` 只代表已读/进入复习池。
- 每日复习：从已读卡片中抽取今日复习队列，支持滑动和答题两种模式。
- 多卡整合：把同一话题下的多张碎片卡片合并成一张综合卡。
- 卡片编辑器：可编辑标题、领域、观点、要点、自由补充和原视频链接。
- 局部颜色标记：在原文上直接圈红/黄/绿/蓝重点，类 WPS 体验。
- AI 补充：基于卡片主题生成 4-6 条相关补充，勾选后追加到自由补充。
- 知识图谱：可视化展示知识库结构，按分类组织卡片。
- 左滑删除：移动端原生交互，安全且高效。
- 图片导出：使用 Canvas 生成长图，不依赖额外截图库。
- 本地优先：卡片数据存储在浏览器 `localStorage` 中。

## 技术栈

- 前端：原生 HTML、CSS、JavaScript（无框架）
- 后端：Node.js 静态服务和 DeepSeek API 代理
- AI：DeepSeek Chat Completions
- 图标：Lucide Icons CDN
- 数据：浏览器 `localStorage`
- 部署：Railway 自动部署（push 到 main 触发）

## 设计语言

整体风格参考 Claude / Claude Code：

- 暖白底（`#fafaf7`）、低饱和、克制留白
- 主色为陶土橙 `#d97757`，强调态用浅橙底+橙色文字
- 细边框（`1.5px`）、轻阴影、圆角 `10-14px`
- 移动端优先，桌面端自适应

## 本地运行

要求 Node.js 18 或更高版本。

```bash
npm start
```

或：

```bash
node server.js
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

如果没有配置 `.env`，页面里的设置按钮也可以临时填写 API Key，仅保存在当前浏览器标签页的 `sessionStorage`。两种方式都不可用时，生成和整合会走本地演示兜底逻辑。

## 项目结构

```text
.
├── index.html         页面结构
├── style.css          全部样式（含移动端适配）
├── script.js          主要业务逻辑
├── server.js          静态服务 + DeepSeek 代理
├── package.json
├── .env.example
├── .gitignore
├── tools/
│   └── validation/    验证脚本
│       ├── validate-cdp.js
│       ├── validate-integrate.js
│       └── validate-integrate.spec.js
├── AI_HANDOFF.md      AI 协作交接文档
└── .trae/documents/
    ├── PRD.md
    └── Technical_Architecture.md
```

## 验证

基础语法检查：

```bash
node --check server.js
node --check script.js
```

整合流程验证脚本在 `tools/validation/` 下，默认访问 `http://localhost:32456`，临时使用时需要先按脚本中的端口启动本地服务或调整脚本 URL。

## 部署到 Railway

项目已配置自动部署。push 到 `main` 分支后 Railway 会自动构建并发布到：

```text
https://zcard-production.up.railway.app/
```

部署相关说明：

- 在 Railway 项目变量里配置 `DEEPSEEK_API_KEY`。
- Railway 会自动检测 Node.js 项目并执行 `npm start`。
- 如果浏览器看到的还是旧版本，加 query 参数强制刷新：`?v=20260528`。

## 演示建议

演示时优先展示这条链路：

```text
粘贴视频内容 -> AI 生成卡片 -> 收藏/Get it -> 编辑器标记重点
-> AI 补充 -> 今日复习 -> 多卡整合 -> 导出长图 -> 知识图谱回顾
```

Zcard 不是又一个收藏夹，而是把短视频消费转成个人知识沉淀。
