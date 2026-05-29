# Zcard 视频解析中转站交接文档

更新时间：2026-05-29

## 目标

Zcard 需要把“只粘贴视频链接”变成可生成知识卡片的流程。这个流程依赖一个第三方视频解析/转写中转站，把视频链接转换成字幕、转录文本或摘要文本。

当前要做的是：替换 BibiGPT 或换成新的中转站，同时保持 Zcard 现有生成逻辑不变。

## 当前调用链路

```text
用户粘贴视频链接
  -> 前端 POST /api/extract-card
  -> server.js 提取链接
  -> 调用 VIDEO_TEXT_API_URL 中转站
  -> 中转站返回 transcript/subtitle/text/content
  -> server.js 调 DeepSeek 生成结构化卡片
  -> 前端展示卡片
```

如果中转站失败，系统会回退：

```text
中转站失败
  -> 返回 needs_text 或前端回退
  -> DeepSeek/本地兜底基于已有标题、分享文案或用户输入生成
```

注意：回退生成不等于解析了视频全文，内容可能只基于标题或短文案。

## 核心文件

```text
server.js      后端代理、视频文字提取、中转站适配、DeepSeek 调用
script.js      前端生成入口、错误提示、回退逻辑
.env.example   环境变量模板
.env           本地真实配置，不提交 Git
```

主要后端函数：

```text
fetchVideoText(videoLink)
normalizeVideoTextPayload(payload)
buildVideoTextRequestBody(videoLink)
buildVideoTextQuery(videoLink)
buildVideoTextHeaders()
handleExtractCard(req, res)
```

## Railway 必填变量

DeepSeek：

```env
DEEPSEEK_API_KEY=你的 DeepSeek Key
```

视频中转站：

```env
VIDEO_TEXT_API_URL=中转站接口地址
VIDEO_TEXT_API_METHOD=GET 或 POST
VIDEO_TEXT_API_QUERY_FIELD=url
VIDEO_TEXT_API_URL_FIELD=url
VIDEO_TEXT_API_KEY=
VIDEO_TEXT_API_AUTH_HEADER=Authorization
VIDEO_TEXT_API_AUTH_PREFIX=Bearer 
VIDEO_TEXT_API_TIMEOUT_MS=120000
VIDEO_TEXT_API_TEXT_PATHS=transcript,subtitle,text,content,summary,data.transcript,data.subtitle,data.text,data.content,data.summary,result.transcript,result.subtitle,result.text,result.content,result.summary
VIDEO_TEXT_API_TITLE_PATHS=title,data.title,result.title
```

重要：Railway 的变量值里不要写变量名。

正确：

```env
VIDEO_TEXT_API_URL=https://example.com/api/parse
```

在 Railway 输入框里，值只填：

```text
https://example.com/api/parse
```

错误：

```text
VIDEO_TEXT_API_URL=https://example.com/api/parse
```

## 如果新中转站是 GET

适用于这种接口：

```text
GET https://example.com/api/parse?url=视频链接
```

Railway 配置：

```env
VIDEO_TEXT_API_METHOD=GET
VIDEO_TEXT_API_URL=https://example.com/api/parse
VIDEO_TEXT_API_QUERY_FIELD=url
VIDEO_TEXT_API_KEY=
```

如果 token 放在 URL 里：

```env
VIDEO_TEXT_API_URL=https://example.com/api/open/YOUR_TOKEN
VIDEO_TEXT_API_KEY=
```

如果 token 放 Header：

```env
VIDEO_TEXT_API_URL=https://example.com/api/parse
VIDEO_TEXT_API_KEY=YOUR_TOKEN
VIDEO_TEXT_API_AUTH_HEADER=Authorization
VIDEO_TEXT_API_AUTH_PREFIX=Bearer 
```

## 如果新中转站是 POST

适用于这种接口：

```http
POST https://example.com/api/parse
Content-Type: application/json

{"url":"视频链接"}
```

Railway 配置：

```env
VIDEO_TEXT_API_METHOD=POST
VIDEO_TEXT_API_URL=https://example.com/api/parse
VIDEO_TEXT_API_URL_FIELD=url
```

如果接口字段名不是 `url`，例如要求 `video_url`：

```env
VIDEO_TEXT_API_URL_FIELD=video_url
```

如果接口还要固定参数，用 JSON：

```env
VIDEO_TEXT_API_EXTRA_BODY={"platform":"douyin","language":"zh"}
```

## 返回字段适配

后端会从中转站返回 JSON 里按路径找正文。默认支持这些字段：

```text
transcript
subtitle
text
content
summary
data.transcript
data.subtitle
data.text
data.content
data.summary
result.transcript
result.subtitle
result.text
result.content
result.summary
```

如果新中转站返回格式是：

```json
{
  "data": {
    "video": {
      "caption": "这里是字幕"
    }
  }
}
```

就要配置：

```env
VIDEO_TEXT_API_TEXT_PATHS=data.video.caption
```

如果标题路径是：

```json
{
  "data": {
    "video": {
      "title": "视频标题"
    }
  }
}
```

配置：

```env
VIDEO_TEXT_API_TITLE_PATHS=data.video.title
```

多个路径用逗号隔开。

## 常见错误

### 未配置 VIDEO_TEXT_API_URL

原因：Railway 变量没有加到 Zcard 这个 service，或加完没有 redeploy。

处理：

```text
Railway -> Zcard service -> Variables -> New Variable -> VIDEO_TEXT_API_URL
```

保存后重新部署。

### Invalid URL

原因通常是 `VIDEO_TEXT_API_URL` 值写错，比如把变量名也写进了值里。

正确值只应该是：

```text
https://...
```

当前代码已经做了容错，会自动剥掉误写的 `VIDEO_TEXT_API_URL=`，但仍建议 Railway 里写干净。

### UNAUTHORIZED

原因：中转站 token 错误、过期、额度不足或权限不足。

处理：

1. 重新生成中转站 token。
2. 如果 token 放 URL，更新 `VIDEO_TEXT_API_URL`。
3. 如果 token 放 Header，更新 `VIDEO_TEXT_API_KEY`。
4. 重新部署 Railway。

### API 返回 308

原因：中转站接口发生重定向。

当前 `server.js` 已支持跟随 `301/302/303/307/308`，GET 和 POST 都处理了。

如果线上还出现 308，说明 Railway 还没部署最新代码。

### JSON 解析失败

原因：DeepSeek 返回了类似 JSON 但不合法的内容。

当前代码已加固：

1. 尝试从返回文本中提取 JSON 对象。
2. 去掉尾随逗号。
3. 如果仍失败，后端用已提取的视频文字生成保底卡片，不再让 `/api/extract-card` 直接 500。

## 换中转站步骤

1. 拿到新中转站文档，确认请求方法：GET 还是 POST。
2. 确认视频链接字段名：`url`、`video_url`、`link` 等。
3. 确认鉴权方式：token 在 URL、Header，还是 body。
4. 确认返回正文路径：`transcript`、`data.text`、`result.content` 等。
5. 在 Railway Variables 更新 `VIDEO_TEXT_API_*`。
6. 点 Railway `Deploy` 或重新部署最新 GitHub 代码。
7. 用一个真实视频链接测试。
8. 打开浏览器控制台检查是否走通 `/api/extract-card`。

## 本地测试

启动：

```powershell
node server.js
```

测试页面：

```text
http://localhost:8080/
```

直接测接口：

```powershell
$body = @{ input = "https://你的测试视频链接" } | ConvertTo-Json
Invoke-WebRequest -Uri "http://localhost:8080/api/extract-card" -Method Post -Body $body -ContentType "application/json" -UseBasicParsing
```

成功时应返回：

```json
{
  "status": "ok",
  "source_type": "video_api",
  "source_text_length": 1234,
  "card": {}
}
```

如果 `source_type` 是 `pasted_text` 或控制台提示回退，说明没有成功用到中转站解析视频正文。

## 提交前检查

```powershell
node --check server.js
node --check script.js
git status --short
```

不要提交：

```text
.env
.claude/settings.local.json
```

可以提交：

```text
server.js
script.js
.env.example
README.md
AI_HANDOFF.md
VIDEO_API_HANDOFF.md
```

