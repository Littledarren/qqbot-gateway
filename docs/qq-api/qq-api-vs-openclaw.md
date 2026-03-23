# QQ 机器人 API 补充说明

> 基于 openclaw-qqbot 源码与官方文档对比，找出文档中未记录或记录不完整的接口。

---

## 一、OpenClaw 有但官方文档缺失的接口

### 1. 消息引用（message_reference）

**文档状态**: 标注"暂未支持"

**OpenClaw 实际实现**: 完全可用

```typescript
// OpenClaw api.ts:383-408
function buildMessageBody(
  content: string,
  msgId: string | undefined,
  msgSeq: number,
  messageReference?: string  // 文档未提及
): Record<string, unknown> {
  // ...
  if (messageReference && !currentMarkdownSupport) {
    body.message_reference = { message_id: messageReference };
  }
  return body;
}
```

**实际支持的事件 ID**: `INTERACTION_CREATE`, `C2C_MSG_RECEIVE`, `FRIEND_ADD`（文档只列出了 C2C 和群聊，未注明具体支持哪些事件 ID）

---

### 2. inputType 枚举值（input_notify.input_type）

**文档状态**: 注释掉，未出现在正文

**OpenClaw 实际实现**（来自源码注释）:

| input_type | 含义 |
|-----------|------|
| 1 | 对方正在输入... |
| 2 | 手动取消展示 |
| 3 | 对方正在讲话.. |
| 4 | 正在生成... |
| 5 | 正在想象... |

当前代码只用 `inputType: 1`，其他值未使用但文档完全未提。

---

### 3. event_id 支持的事件类型

**文档**:
```
msg_id   前置收到的用户发送过来的消息 ID，用于发送被动消息
event_id 前置收到的事件 ID，用于发送被动消息，支持事件：
  单聊: "INTERACTION_CREATE"、"C2C_MSG_RECEIVE"、"FRIEND_ADD"
  群聊: "INTERACTION_CREATE"、"GROUP_ADD_ROBOT"、"GROUP_MSG_RECEIVE"
```

**文档缺失**: 文档正文只写了 event_id 字段存在，但未明确列出支持的事件 ID 列表（这些信息只存在于示例代码注释中）

---

### 4. 被动回复限流细节

**文档**:
```
单聊: 被动消息有效时间为 60 分钟，每个消息最多回复 5 次
群聊: 被动消息有效时间为 5 分钟，每个消息最多回复 5 次
```

**OpenClaw 实现**（`outbound.ts`）:
```
实际限制: 每 message_id 1小时内最多回复 4 次（非 5 次）
超时处理: 超过 1 小时或超过次数后降级为主动消息发送
```

**差异**: 文档说 5 次，OpenClaw 实现的是 4 次且是 1 小时 TTL。

---

### 5. srv_send_msg 的 file_info 复用规则

**文档**:
```
file_info 不受发送的目标端影响，一个 file_info 可复用发送到多个群或多个用户
注意：用 /v2/groups/{group_openid}/files 上传的文件，仅能发到群聊内，
     用 /v2/users/{openid}/files 上传的文件，也仅能发送到单聊
```

**实际测试补充**: 同一 file_info 在相同类型目标（c2c->c2c 或 group->group）之间确实可以复用，但跨类型不行。

---

### 6. message_reference 与 msg_id 的互斥关系

**文档**: 两者都标注为"可选"，未说明互斥

**OpenClaw 实际行为**: `message_reference` 和 `msg_id` 可以同时使用，`msg_id` 用于回复，`message_reference` 用于引用（REFIDX）。

---

## 二、OpenClaw 有但官方文档完全没有的接口

### 7. 视频消息

```
POST /v2/users/{openid}/files   (file_type=2)
POST /v2/groups/{group_openid}/files  (file_type=2)
```

OpenClaw 完整实现了 `sendC2CVideoMessage` / `sendGroupVideoMessage`，文档的富媒体消息页只提到"视频：mp4"，但没有单独的 API 说明页。

**视频格式要求**（从 OpenClaw 源码反推）: mp4

---

### 8. 频道私信（DM）

```
POST /dms/{guild_id}/messages
```

OpenClaw 有 `sendDmMessage` 函数。官方文档路径存在但示例和数据结构不完整（文档只有简要说明）。

---

### 9. refIdx 自动缓存钩子（`onMessageSent`）

OpenClaw api.ts 有一个 `onMessageSent` 回调钩子，当消息发送成功且 QQ 返回 `ext_info.ref_idx` 时触发。这使得 bot 发出的消息能被自动记录到 ref-index-store，供后续引用。

**文档完全未提及**: 没有任何官方文档描述 ref_idx 的用途或生命周期。

---

### 10. Markdown 消息开关（`initApiConfig`）

OpenClaw 支持通过 `initApiConfig({ markdownSupport: true })` 切换 msg_type：
- Markdown OFF: `msg_type=0`, `content=string`
- Markdown ON: `msg_type=2`, `markdown={ content: string }`

**文档只说了 msg_type=2 是 markdown**，未说明如何启用以及 content 和 markdown 字段的互斥关系。

---

### 11. 后台 Token 自动刷新

OpenClaw 的 `startBackgroundTokenRefresh` 在 Token 过期前主动刷新，避免请求时才发现 Token 过期。

**文档完全未提及**：Token 过期处理策略完全由调用方自行实现。

---

## 三、OpenClaw 有但 qqbot-gateway 缺少的接口

以下接口在 OpenClaw 源码中已实现，但我们的 qqbot-gateway 尚未提供：

| 接口 | 说明 | 优先级 |
|------|------|--------|
| `sendDmMessage` | 频道私信 | P1 |
| `sendC2CVideoMessage` / `sendGroupVideoMessage` | 视频消息 | P2 |
| `messageReference` 参数 | 引用消息（REFIDX） | P1（已在 gateway 实现，api.ts 缺少） |
| `initApiConfig` + Markdown 模式 | msg_type=2 支持 | P2 |
| `getTokenStatus` | Token 缓存状态监控 | P3 |
| `sendPhoto` / `sendVoice` 等 Telegram 风格接口 | 目标解析 + 媒体类型自动判断 | P2 |
| 消息回复限流器（4次/小时） | `checkMessageReplyLimit` | P1 |
| 批量发送 / 广播 | `sendBulkProactiveMessage` / `broadcastMessage` | P3 |
| 已知用户管理 | `listKnownUsers` / `getKnownUser` / `removeKnownUser` / `clearKnownUsers` | P1（gateway 有 store，缺 query 接口） |

---

## 四、建议补充到文档的要点

1. **被动回复限流**: 实际是 4 次/小时，不是 5 次
2. **event_id 支持列表**: 应明确列出每种消息类型支持哪些事件 ID
3. **inputType 枚举**: 取消注释，补充完整枚举值
4. **ref_idx 生命周期**: 文档完全没有，应说明 ref_idx 的有效期和用途
5. **file_info 复用规则**: 跨目标类型的限制应更明确
6. **message_reference 与 msg_id 可以同时使用**
