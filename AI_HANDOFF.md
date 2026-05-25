# Zcard AI 交接文档

更新时间：2026-05-25

## 一句话项目说明

Zcard 是一个本地运行的个人知识卡片系统。用户可以粘贴短视频链接、文案或文章内容，用 AI 生成结构化知识卡片，再通过分类、收藏、已读、每日回顾、知识图谱、编辑器、AI 补充和重点标记，把碎片化信息沉淀成可复习的个人知识库。

当前主要是移动端优先的 Web Demo，风格偏 Claude / Claude Code：暖白底、细边框、轻阴影、低饱和色、克制留白。

## 运行方式

项目目录：

```powershell
E:\Zcard - 002
```

启动服务：

```powershell
node server.js
```

浏览器打开：

```text
http://localhost:8080/
```

如果浏览器提示 `localhost 拒绝连接`，通常是服务没启动。重新在项目目录运行 `node server.js` 即可。

如果页面缓存没刷新，可以加 query：

```text
http://localhost:8080/?v=handoff-20260525
```

## VSCode / ccswitch 交接建议

如果用户用 `ccswitch` 从 Codex 切到 Claude Code，建议先让新 Agent 做三件事：

1. 阅读本文件：`AI_HANDOFF.md`
2. 阅读核心文件：`index.html`、`script.js`、`style.css`、`server.js`
3. 运行检查：

```powershell
node --check script.js
node --check server.js
```

注意：`npm run check` 偶尔会在 npm 层卡住，但单独跑上面两个 `node --check` 是可靠的。

## 当前 Git / 文件状态

当前工作树不是干净状态，已有本地修改。不要随便 reset 或 checkout。

最近看到的状态大致是：

```text
M .env.example
M AI_HANDOFF.md
M README.md
M index.html
M script.js
M server.js
M style.css
?? server.err.log
?? server.out.log
```

用户之前明确倾向本地迭代。不要主动提交、推送、开 PR，除非用户明确要求。

## API 与环境变量

`.env` 里可以配置：

```text
DEEPSEEK_API_KEY=...
```

前端也支持在页面设置里临时填写 API Key，保存在 `sessionStorage`。

AI 调用路径：

- 前端 `callDeepSeek(prompt)`
- 优先调用后端代理 `/api/deepseek`
- 代理不可用时，如果页面设置里有 API Key，则前端直连 DeepSeek

重要：当前 “AI 补充” 是基于卡片主题生成相关补充，不是真正跨平台实时检索。不要在文案里假装它已经联网检索各平台。

## 核心文件

```text
index.html    页面结构
style.css     全部样式，移动端适配也在这里
script.js     主要业务逻辑，体量较大
server.js     本地静态服务 + DeepSeek 代理 + 视频文字提取接口
README.md     项目说明
AI_HANDOFF.md 本交接文档
```

## 核心数据结构

卡片主要字段：

```js
{
  id,
  title,
  core_point,
  key_points,
  quote,
  action,
  category,
  video_link,
  created_at,
  isRead,
  readAt,
  isFavorite,
  isIntegrated,
  sourceCards,
  source_titles,
  source_links,
  note,
  customStyles,
  marks
}
```

`marks` 是最近新增的局部文字颜色标记数据，不应该直接写进文本内容：

```js
marks: {
  title: [{ start: 0, end: 2, color: "red" }],
  core_point: [],
  key_points: [],
  note: []
}
```

已知曾经有一版错误地把 `[[markyellow]]...[[/mark]]` 写入文本。现在代码里有兼容清理：

- `stripInlineMarks(value)`
- `renderInlineMarks(value)`

后续不要再把内部标记写进用户可编辑文本。

## 当前主要功能

### 1. 生成卡片

用户粘贴文本或视频链接后生成卡片。核心逻辑在：

- `handleGenerateCard()`
- `callDeepSeek(prompt)`
- `createLocalCard()`
- `normalizeCard(card)`

如果只有很短链接/文案，前端会要求补充字幕或完整文本，避免硬生成低质量卡片。

### 2. 收藏

星星按钮只负责收藏：

- `isFavorite = true/false`
- 与 Get it / 已读无关
- 收藏入口可以筛选收藏卡片

相关：

- `toggleFavoriteCard(card)`
- `.card-favorite-toggle`

### 3. Get it / 已读 / 回顾池

详情页 `Get it` 现在直接切换已读，不再弹分类 prompt。

当前逻辑：

- 点 `Get it`：`isRead = true`，加入今日回顾池
- 再点：取消已读
- 分类沿用卡片已有分类，改分类去编辑页

相关：

- `handleGetCard()`
- `includeCardInTodayReviewSession()`
- `renderDailyReview()`

### 4. 知识图谱

底部导航有 `图谱`。

当前图谱交互：

- 默认显示知识图谱宇宙
- 中心是“我的知识库”
- 外围是分类圆
- 分类超过一定数量会拆成多个圆盘纵向排列
- 点击分类，不在图谱下面展开，而是进入独立二级列表页
- 二级页是单列纵向卡片流，有 `返回图谱`
- `最近生成` 和 `收藏` 也进入独立列表页

相关：

- `renderKnowledgeGraph()`
- `calculateBubbleLayout(count)`
- `chunkGraphGroups(groups)`
- `renderKnowledgeGraphCard(card, mode)`
- `.knowledge-universe`
- `.universe-map`
- `.graph-list-page`

设计注意：

- 外围圆现在不放图标，避免视觉变脏
- 分类颜色使用低饱和 palette
- 新分类会按分类名稳定分配 fallback color

### 5. 卡片编辑器

编辑页最近改动很多，后续接手要小心。

当前编辑页顺序：

1. 标题 / 领域
2. 主要观点
3. 关键要点
4. 自由补充
5. 原视频链接
6. 文字样式
7. AI 补充

相关：

- `renderCardEditForm(card)`
- `renderEditField(field, label, type, value, card, options)`
- `bindEditStyleControls()`
- `saveEditedCard()`

### 6. AI 补充

编辑页底部有 `AI补充`。

流程：

1. 用户点击 `生成补充`
2. 调用 `callDeepSeek(buildAiSupplementPrompt(draft))`
3. 返回 4-6 条补充
4. 用户勾选
5. 点击 `添加选中`
6. 追加到 `自由补充`

相关：

- `handleAiSupplement()`
- `buildAiSupplementPrompt(draft)`
- `normalizeAiSupplements(result)`
- `addSelectedAiSupplements()`

注意：

- 这是主题相关补充，不是真正联网检索
- 不要写“来自各平台检索结果”这种误导 UI

### 7. 局部颜色标记 / 类 WPS 选字

用户想要的是：在原文上直接显示颜色标记，而不是下面预览，也不是露出 `[[mark]]`。

当前实现方向：

- 标题、主要观点、关键要点、自由补充已改为轻量富文本编辑区 `contenteditable`
- 局部颜色直接显示在原文字段里
- 颜色数据存在 `card.marks`
- 保存后详情页也按 `marks` 渲染

相关函数：

- `renderEditableHtml(value, ranges)`
- `getEditablePlainText(element)`
- `getEditableMarkRanges(element)`
- `getSelectionOffsetsWithin(element)`
- `setEditableSelection(element, start, end)`
- `markSelectedEditText(color)`
- `renderMarkedText(value, ranges)`
- `renderMarkedField(card, field, fallback)`

颜色盘：

- 红
- 黄
- 绿
- 蓝
- `无`：清除选区颜色

移动 / F12 手机模式：

- 浏览器原生 textarea 滑选不可靠，所以之前改成 contenteditable
- 另外保留了 `precision-mark-picker`，用字块面板模拟滑动选字
- 最近用户希望“像截图那样选中有蓝色底纹”，字块面板样式已改成深色背景 + 蓝色选区

这块仍是最脆弱的区域。如果后续要继续优化，建议目标是：

- 优先使用 contenteditable 原生 selection
- 颜色盘尽量靠近选区
- 不要再引入文本内隐藏符号

### 8. 左滑删除

卡片支持左滑删除。相关逻辑较脆弱，不要轻易重写。

相关：

- `bindSwipeToDelete(cardEl)`
- `.knowledge-card-wrap`
- `.swipe-card`
- `.swipe-delete`

### 9. 整合卡片

用户可选择多张卡片整合。整合后会生成整合卡片，并移除原选中卡片。

相关：

- `handleIntegrateCards()`
- `showIntegratePreview()`
- `confirmIntegrate()`
- `createLocalIntegratedCard()`

## 最近已验证

最近稳定通过：

```powershell
node --check script.js
node --check server.js
```

服务探活：

```powershell
Invoke-WebRequest -Uri 'http://localhost:8080' -UseBasicParsing -TimeoutSec 5
```

返回 200。

## 已知问题 / 后续建议

1. 编辑器局部标记刚从 textarea 迁移到 contenteditable，建议重点测试：
   - 标题标色
   - 主要观点标色
   - 关键要点多行标色
   - 自由补充标色
   - 保存后再打开是否保留
   - 点击 `无` 是否只清除选区颜色

2. F12 手机模式的文本选择和真实手机不完全一致。如果继续追求 WPS 体验，需要更多真实手机测试。

3. `precision-mark-picker` 是兼容 F12/触控的辅助方案，可能和 contenteditable 原生 selection 有重叠。后续可以视效果决定是否保留。

4. `npm run check` 偶发卡住，不一定是语法问题。优先看：

```powershell
node --check script.js
node --check server.js
```

5. 当前 `server.err.log` 和 `server.out.log` 是空日志文件，未跟踪。不要误删用户文件，但这两个可视为本地运行产物。

## 给下一位 Agent 的工作建议

如果用户继续说“颜色标记不好用”，优先检查：

1. `contenteditable` 里的 selection 是否正确
2. `pendingEditMarks` 是否更新
3. 保存时 `getEditableMarkRanges()` 是否拿到正确范围
4. 详情页 `renderMarkedField()` 是否渲染

如果用户继续说“页面丑”，先不要再加图标。这个项目更适合：

- 更少装饰
- 更准的间距
- 更轻的边框
- 更清楚的层级

如果用户问如何在 VSCode 打开：

```powershell
cd "E:\Zcard - 002"
node server.js
```

然后打开：

```text
http://localhost:8080/
```

