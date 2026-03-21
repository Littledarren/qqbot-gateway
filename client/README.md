# QQ Bot Client

连接 qqbot-gateway 的 WebSocket，处理用户消息的智能客户端。

## 功能

| 命令 | 说明 | 示例 |
|------|------|------|
| `/bash <命令>` | 执行 shell 命令，结果自动分段返回 | `/bash ls -la` |
| `/get <路径>` | 将文件发送给用户 | `/get /etc/hosts` |
| `/help` | 显示帮助 | `/help` |
| 发送图片/语音/文件 | 自动保存到本地 | (无命令) |

## 配置

配置文件路径：`~/.qqbot-gateway/client.json`

```json
{
  "gatewayUrl": "http://localhost:3001",
  "targetOpenid": "你的OpenID",
  "downloadsDir": "/home/user/Downloads",
  "cmdTimeout": 30000,
  "chunkSize": 1800,
  "chunkDelay": 300
}
```

| 字段 | 说明 | 默认值 |
|------|------|--------|
| `gatewayUrl` | Gateway HTTP 地址 | `http://localhost:3001` |
| `targetOpenid` | 只响应此用户的消息 | (必填) |
| `downloadsDir` | 附件保存目录 | `~/Downloads` |
| `cmdTimeout` | 命令执行超时(ms) | `30000` |
| `chunkSize` | 分段发送字符数 | `1800` |
| `chunkDelay` | 分段间延迟(ms) | `300` |

## 运行

### 手动运行

```bash
cd qqbot-gateway
npm run build
npm run start:client
```

### systemd 服务（推荐）

```bash
# 服务文件路径: /etc/systemd/system/qqbot-client.service

sudo systemctl start qqbot-client   # 启动
sudo systemctl stop qqbot-client    # 停止
sudo systemctl restart qqbot-client # 重启
sudo systemctl status qqbot-client  # 状态
journalctl -u qqbot-client -f       # 实时日志
```

### systemd 服务文件参考

```ini
[Unit]
Description=QQ Bot Client
After=network.target

[Service]
Type=simple
User=user
WorkingDirectory=/home/user/Desktop/qqbot-gateway
ExecStart=/usr/bin/node dist/client/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

## 使用示例

**执行命令并返回结果：**
```
你: /bash df -h
Bot: [1/1]
     Filesystem      Size  Used Avail Use% Mounted on
     /dev/root        94G   15G   79G  17% /
     ...
     [完成]
```

**获取文件：**
```
你: /get /etc/hostname
Bot: (收到文件: hostname)
```

**发送图片：**
```
你: (发送一张图片)
Bot: 已保存: 2026-03-21T19-30-00.jpg
```
