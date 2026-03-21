# QQ Bot Gateway

独立版 QQ Bot Gateway 服务，提供 HTTP API 和 WebSocket 推送，无需依赖 OpenClaw 框架。

## 功能特性

- **消息接收** - 通过 WebSocket 实时接收 QQ Bot 私聊、群聊、频道消息
- **消息发送** - 通过 HTTP API 发送文本、图片、语音、文件消息
- **自动重连** - 支持断线重连和 Session 恢复
- **Token 管理** - 自动管理 Access Token 缓存和刷新
- **轻量独立** - 无需 OpenClaw 框架，独立运行

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 创建配置文件

配置文件路径：`~/.qqbot-gateway/config.json`

```bash
# 创建配置目录
mkdir -p ~/.qqbot-gateway

# 复制示例配置
cp config.example.json ~/.qqbot-gateway/config.json

# 编辑配置文件，填入你的 AppID 和 ClientSecret
nano ~/.qqbot-gateway/config.json
```

配置文件内容：

```json
{
  "appId": "你的机器人AppID",
  "clientSecret": "你的机器人ClientSecret",
  "httpPort": 3001
}
```

> **获取 AppID 和 ClientSecret**：访问 [QQ 开放平台](https://q.qq.com/) 创建机器人

### 3. 编译并启动

```bash
npm run build
npm start
```

启动成功后显示：

```
[qqbot] Starting QQ Bot Gateway...
[qqbot] AppID: 12345678...
[qqbot] HTTP Port: 3001
[qqbot] Config file: /home/xxx/.qqbot-gateway/config.json
[http] Server started on port 3001
[http] WebSocket endpoint: ws://localhost:3001/ws
[qqbot] WebSocket connected
[qqbot] Gateway ready, session: xxx-xxx-xxx
[qqbot] Gateway is ready!
```

### 4. 获取你的 OpenID

启动服务后，给机器人发送一条消息，控制台会打印：

```
[qqbot] ========== 收到消息 ==========
[qqbot] 类型: c2c
[qqbot] 发送者 OpenID: C50DCF80E802AAF67CF5225A8C224440
[qqbot] 发送者昵称: 你的昵称
[qqbot] 内容: 你好
[qqbot] ==============================
```

这个 **OpenID** 用于发送消息给对应用户。

## HTTP API

### 1. 发送文本消息

**POST** `/api/send`

```bash
curl -X POST http://localhost:3001/api/send \
  -H "Content-Type: application/json" \
  -d '{
    "to": "用户openid",
    "type": "c2c",
    "content": "你好！"
  }'
```

**参数说明：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| to | string | 是 | 目标 OpenID（用户或群） |
| type | string | 是 | 消息类型：`c2c`（私聊）、`group`（群聊） |
| content | string | 是 | 消息内容 |

**响应：**

```json
{
  "success": true,
  "data": {
    "messageId": "ROBOT1.0_xxx",
    "timestamp": "2026-03-21T18:58:05+08:00"
  }
}
```

### 2. 发送图片

**POST** `/api/send/image`

```bash
curl -X POST http://localhost:3001/api/send/image \
  -H "Content-Type: application/json" \
  -d '{
    "to": "用户openid",
    "type": "c2c",
    "imageUrl": "https://example.com/image.png"
  }'
```

### 3. 发送语音

**POST** `/api/send/voice`

```bash
curl -X POST http://localhost:3001/api/send/voice \
  -H "Content-Type: application/json" \
  -d '{
    "to": "用户openid",
    "type": "c2c",
    "voiceUrl": "https://example.com/voice.silk"
  }'
```

### 4. 发送文件

**POST** `/api/send/file`

```bash
curl -X POST http://localhost:3001/api/send/file \
  -H "Content-Type: application/json" \
  -d '{
    "to": "用户openid",
    "type": "c2c",
    "fileUrl": "https://example.com/document.pdf",
    "fileName": "document.pdf"
  }'
```

### 5. 获取服务状态

**GET** `/api/status`

```bash
curl http://localhost:3001/api/status
```

**响应：**

```json
{
  "success": true,
  "data": {
    "connected": true,
    "sessionId": "xxx-xxx-xxx",
    "lastHeartbeat": 1711034285000
  }
}
```

## WebSocket 消息监听

连接 `ws://localhost:3001/ws`，当收到 QQ 消息时会实时推送。

### JavaScript 示例

```javascript
const ws = new WebSocket('ws://localhost:3001/ws');

ws.onopen = () => {
  console.log('已连接到 Gateway');
};

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  console.log('收到消息:', message);
};
```

### 推送消息格式

```json
{
  "type": "c2c",
  "sender": {
    "id": "xxx",
    "openid": "C50DCF80E802AAF67CF5225A8C224440",
    "nickname": "用户昵称"
  },
  "content": "消息内容",
  "messageId": "xxx",
  "timestamp": 1711034285000,
  "attachments": []
}
```

### 消息类型

| type | 说明 | 触发条件 |
|------|------|----------|
| `c2c` | 私聊消息 | 用户给机器人发私聊 |
| `group` | 群聊消息 | 在群里 @机器人 |
| `channel` | 频道消息 | 频道内 @机器人 |

## 测试脚本

项目提供了两个测试脚本：

### 发送消息测试

```bash
# 发送私聊消息
node test-send.js <openid> "Hello World"

# 发送群消息
node test-send.js <群openid> "群消息测试" group
```

### 监听消息测试

```bash
# 监听所有消息
node test-listen.js
```

## 项目结构

```
qqbot-gateway/
├── src/
│   ├── index.ts         # 入口文件
│   ├── gateway.ts       # WebSocket 连接管理
│   ├── api.ts           # QQ Bot API 封装
│   ├── http-server.ts   # HTTP 服务
│   ├── types.ts         # 类型定义
│   └── utils/
│       ├── platform.ts  # 平台适配
│       └── file-utils.ts # 文件工具
├── dist/                # 编译输出
├── config.example.json  # 配置示例
├── test-send.js         # 发送测试脚本
├── test-listen.js       # 监听测试脚本
├── test-api.js          # API 完整测试
├── package.json
└── tsconfig.json
```

## 注意事项

1. **主动消息限制** - QQ 平台对主动消息有配额限制，频繁发送可能被限制
2. **AppSecret 保密** - 不要将 Secret 提交到代码仓库
3. **OpenID 隔离** - 不同机器人的用户 OpenID 不同，不能跨机器人使用
4. **群消息需要 @** - 只有 @机器人 的群消息才会触发事件

## 常见问题

### Q: 发送消息后没有收到？

检查以下几点：
1. 服务是否正常启动并显示 `Gateway is ready!`
2. OpenID 是否正确（需要从收到的消息中获取）
3. 检查 `/api/status` 确认连接状态

### Q: 群消息收不到？

群消息需要 @机器人 才会触发事件。

### Q: 如何获取群 OpenID？

在群里 @机器人 发送消息，控制台会打印群 OpenID。

## License

MIT
