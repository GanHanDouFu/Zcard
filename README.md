# Zcard

把视频文案整理成知识卡片的静态网页原型。

## 本地预览

只看 UI：

```bash
python -m http.server 8080
```

然后打开 `http://localhost:8080`。

## 带 DeepSeek 代理运行

推荐用后端代理运行，避免把 API Key 暴露在前端页面里：

```bash
$env:DEEPSEEK_API_KEY="sk-..."
node server.js
```

然后打开 `http://localhost:8080`。

如果部署到纯静态托管，页面仍然可以展示 UI、筛选、搜索、复习和导出；生成卡片需要在设置里临时填写 API Key，Key 只保存在当前标签页会话中。
