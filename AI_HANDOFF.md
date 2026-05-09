# Zcard AI 交接说明

更新时间：2026-05-09

## 当前目标

这是一个纯前端 Demo：把短视频文案/链接整理成知识卡片，手机端优先，整体 UI 走 Claude / Claude Code 风格：白底、细边框、轻阴影、克制留白。

当前用户明确说过：**先别提交 GitHub**。后续除非用户明确要求，否则只在本地改。

## 运行方式

项目目录：

```bash
E:\Zcard
```

本地预览：

```bash
node server.js
```

浏览器打开：

```text
http://localhost:8080/
```

最近用于强刷缓存的链接：

```text
http://localhost:8080/?v=fav-tab-yellow
```

## Git 状态

当前有未提交改动：

```text
M script.js
M style.css
```

最近提交：

```text
fc3c25b 最新版本
6882ee0 最新更改
619199e Refine mobile edit toolbar
b80599c Add Get it review pool flow
4f31475 Add demo DeepSeek key
```

重要：用户后来说“以后别给 gitee 给 github”，但最近又说先不要提交，所以现在不要自动 push。

## API 状态

`script.js` 里写了 Demo DeepSeek Key：

```js
const DEFAULT_DEMO_API_KEY = 'sk-4591f6e3f254426abe448bfc21e6d86d';
```

这是用户允许用于前端演示的。正式上线不应这样做。

## 当前核心数据字段

卡片主要字段：

```js
{
  title,
  core_point,
  key_points,
  quote,
  action,
  category,
  video_link,
  created_at,
  isRead,       // 是否已读，由 Get it 控制
  readAt,
  isFavorite,   // 是否收藏，由右上角星星控制
  customStyles  // 编辑样式
}
```

兼容旧字段：

```js
card.isRead = !!card.isGot
```

这行是为了把旧的 Get/待看数据迁移成已读，不是 bug。

## 功能逻辑现状

### 星星

右上角星星只负责收藏：

- 空心星：未收藏
- 黄色实心星：已收藏
- 点星星只切换 `isFavorite`
- 不应该弹出“选择操作”
- 顶部「收藏」筛选显示 `isFavorite === true` 的卡片
- 只要存在收藏卡片，顶部「收藏」按钮会变黄色，颜色和星星一致

相关代码：

- `toggleGotCard(card)`：现在实际是切换收藏，名字还没改
- `.card-got-toggle`：星星按钮 class，名字还没改
- `.category-tag.has-favorites`：收藏按钮变黄

### Get it

详情页里的 `Get it` 只负责已读：

- 点 `Get it` 后 `isRead = true`
- 按钮变成「已读」
- 再点可以取消已读
- 和收藏星星无关

相关代码：

- `handleGetCard()`
- `renderDailyReview()`
- `startFlashcardMode()`

### 顶部筛选

现在有：

- 全部
- 收藏
- 未读
- 已读
- 生活 / 职场 / 学习 / 娱乐 / 财经 / 健康 / 科技

筛选逻辑在 `renderCards()`：

```js
if (currentCategory === '收藏') ...
else if (currentCategory === '未读') ...
else if (currentCategory === '已读') ...
```

### 复习

底部「复习」固定从全部已读卡片里抽，不受当前筛选影响：

```js
flashcardQueue = cards.filter(c => c.isRead && !c.is_integrated);
```

首页顶部今日复习也从已读卡片里抽。

### 左滑删除

卡片支持左滑露出删除：

- 左滑后卡片停在删除位
- 点删除按钮弹确认并删除
- 点白色卡片区域会收回
- 左滑展开时不应该弹出“选择操作”

相关代码：

- `bindSwipeToDelete(cardEl)`
- `.knowledge-card-wrap`
- `.swipe-card`
- `.swipe-delete`

这块之前反复调过，比较脆弱。改动时要小心，不要同时混用太多 touch/pointer 逻辑。

### 编辑

详情页编辑模式：

- 底部统一编辑工具栏 `.edit-dock`
- A- / A / A+ 调字号
- 黑 / 红 / 蓝 / 灰调颜色
- B / U / I 调加粗、下划线、倾斜
- 编辑框默认字号统一 `16px`
- 「领域」输入框强制普通字重，不继承加粗/倾斜/下划线

## 已验证

最近检查：

```bash
node --check .\script.js
```

通过。

```powershell
Invoke-WebRequest -Uri 'http://localhost:8080/?v=fav-read-check' -UseBasicParsing
```

返回 200。

## 下一位 AI 注意事项

1. 不要默认提交或推送，除非用户明确说提交。
2. 现在 `script.js`、`style.css` 有未提交改动。
3. “星星”和 “Get it” 已拆开：
   - 星星 = 收藏
   - Get it = 已读
   - 复习 = 从已读抽卡
4. `toggleGotCard` 和 `.card-got-toggle` 名字不准确，但功能已变成收藏。可以后续重命名，但要小心别改坏事件。
5. 左滑删除交互较脆弱，改之前先用手机/浏览器实际试。
6. 如果页面没变化，用新的 query 参数强刷，例如：

```text
http://localhost:8080/?v=你的版本名
```

