# Zcard - 抖音视频知识卡片管理

## 项目简介

Zcard 是一个用于管理抖音视频知识卡片的 Web 应用。它能从视频文案中提取关键信息，生成结构化的知识卡片，并支持复习、收藏、整合等功能。

## 技术栈

- **前端**: 原生 HTML + CSS + JavaScript
- **后端**: Node.js (简单静态文件服务器 + AI API 代理)
- **AI 服务**: DeepSeek API (用于生成卡片内容)
- **图标**: Lucide Icons (CDN)
- **图片导出**: html2canvas (CDN)

## 文件结构

```
Zcard/
├── index.html      # 主页面 HTML
├── style.css       # 样式文件
├── script.js       # 前端 JavaScript 逻辑
├── server.js       # Node.js 后端服务器
├── data/           # 数据存储目录
│   └── cards.json  # 知识卡片数据
└── README.md       # 项目文档
```

## 快速开始

### 1. 启动服务器

```bash
# 进入项目目录
cd Zcard

# 启动服务器
node server.js
```

服务器启动后访问: **http://localhost:8080**

### 2. 配置 API Key (首次使用)

1. 点击右上角设置图标 ⚙️
2. 输入你的 DeepSeek API Key
3. 点击保存

> API Key 仅保存在当前浏览器会话中

## 功能说明

### 生成卡片

1. 在输入框粘贴抖音视频文案或链接
2. 点击「生成知识卡片」按钮
3. 等待 AI 提取信息
4. 查看生成的卡片，或直接保存

### 卡片结构

每张卡片包含以下字段：

| 字段 | 说明 | 示例 |
|------|------|------|
| title | 标题 | 「游客投诉被拉黑」|
| core_point | 核心观点 | 桂林文旅处理投诉方式极端 |
| key_points | 关键要点列表 | 座椅脏、投诉被拉黑、要求道歉 |
| quote | 引用语 | 用拉黑方式处理投诉不可取 |
| action | 行动建议 | 投诉应礼貌回应 |
| category | 分类 | 生活/职场/学习/娱乐/财经/健康/科技 |

### 卡片管理

- **查看详情**: 点击卡片打开详情
- **收藏**: 点击星星图标 ⭐
- **删除**: 左右滑动卡片，或点击删除按钮
- **编辑**: 在详情弹窗中点击编辑按钮
- **整合**: 选择同分类多张卡片，合并为一张

### 复习功能

- **今日复习**: 首页顶部显示待复习卡片
- **闪卡模式**: 左右滑动复习
- **理解/没理解**: 记录复习状态

### 搜索与筛选

- **分类筛选**: 点击顶部标签筛选
- **搜索**: 输入关键词搜索卡片
- **视图切换**: 首页/未读/已读/收藏

## API 格式

### DeepSeek 请求格式

```javascript
{
  "model": "deepseek-chat",
  "messages": [
    {
      "role": "system",
      "content": "你是一个知识卡片生成助手..."
    },
    {
      "role": "user", 
      "content": "请从以下文本提取知识...\n\n{用户输入的文案}"
    }
  ]
}
```

### DeepSeek 响应格式

```javascript
{
  "title": "卡片标题",
  "core_point": "核心观点",
  "key_points": ["要点1", "要点2", "要点3"],
  "quote": "引用语",
  "action": "行动建议",
  "category": "生活"  // 可选: 生活/职场/学习/娱乐/财经/健康/科技
}
```

## 数据存储

### cards.json 结构

```javascript
[
  {
    "id": "uuid-string",
    "title": "标题",
    "core_point": "核心观点",
    "key_points": ["要点1", "要点2"],
    "quote": "引用语",
    "action": "行动建议",
    "category": "生活",
    "created_at": "2026-05-10",
    "source_url": "",      // 抖音链接
    "source_text": "",     // 原始文案
    "isRead": false,       // 是否已读
    "isFavorite": false,   // 是否收藏
    "is_todo": false,      // 是否有待办
    "todo_status": "",     // 待办状态
    "is_integrated": false // 是否已整合
  }
]
```

## 常用操作

### 查看所有卡片

在浏览器 Console 输入:

```javascript
console.log(cards.length);  // 显示卡片数量
console.log(cards);         // 显示所有卡片
```

### 强制刷新页面

```javascript
location.reload();
```

### 导出所有数据

```javascript
console.log(JSON.stringify(cards, null, 2));
```

## 常见问题

### Q: 页面显示空白怎么办？

1. 打开浏览器开发者工具 (F12)
2. 查看 Console 是否有错误
3. 检查网络请求是否正常
4. 确认 lucide icons CDN 可访问

### Q: API 调用失败？

1. 检查 API Key 是否正确
2. 检查网络连接
3. 查看 Console 中的错误信息

### Q: 卡片不显示？

1. 检查是否在正确视图（首页/未读/已读/收藏）
2. 检查分类筛选
3. 尝试刷新页面

## 开发调试

### Console 日志

打开 F12 查看以下日志:

```
[Zcard] init 开始
[Zcard] init 完成, cards 数量: X
[Zcard] renderCards: 过滤后卡片数量: X
[Zcard] handleGenerateCard 被调用
[Zcard] AI 原始返回内容: {...}
[Zcard] API 调用成功: {...}
```

### 强制重置

如果需要重置所有数据，在 Console 执行:

```javascript
localStorage.removeItem('zcard_cards');
localStorage.removeItem('zcard_api_key');
location.reload();
```

## 联系方式

如有问题，请在 GitHub 提交 Issue。
