# 请求期 `[#seq 体积]` 打标

> 插件：`packages/dsh-context-compact`
> 开关：`injectSeq`（默认 `false`）

## 1. 一句话

发请求前，给每条进入 `messages` 的消息（系统提示词是独立字段，不在其中），把它在 surface 上的节点号和体积前置到第一个文本块：

```
[#812 1.2k]
<原始内容>
```

只改这一次请求的副本；会话日志、surface 节点、GUI 里看到的"原始内容"全部保持干净。

## 2. 为什么要做

编号让模型直接用 `start`/`end` 定位；体积让模型直接判断"这段值不值得压"，不必为了算大小再扫一遍节点表（早先正是因此多调了一次 `scan_context`）。

体积来自 `meter.measure(session)` 的节点表，量不到时退回按字符估算；小于 1000 原样显示（`340`），更大的收成 `1.2k`。抄标签时不必删掉体积：`parseSeqRef` 接受 `[#812 1.2k]`、`[#812]`、`#812`、`812`。

打标是**可读性辅助**，不是压缩的前提：`scan_context` 本来就返回全部节点，没有标签也能压缩。

## 3. 挂点：必须包 `session.deriveMessages`

第一版把打标写在 `agent/pre-step` 的 `decision.messages` 上，结果一条都没打上。原因在 `@deepseek-ai/dsh-agent-loop/lib/index.js`：

```js
// preStep(), L906
const claimed = this.inbox.claim(target, position.turn);
// preStep(), L909 —— 这里只是「本次新声明的消息」+ 运行时上下文
const decision = await this.dispatch.waterfall('agent/pre-step', { messages: claimed, ... }, ...)
```

而模型真正收到的完整历史在请求组装处，L1274：

```js
const boundaryMessages = session.deriveMessages();
// ...
return markAgentLoopRequest(Object.freeze({ ...header.config, messages: boundaryMessages, ... }));
```

所以唯一可靠的挂点是 `session.deriveMessages()`：在 pre-step 里装一次 own property 包装，之后每次组装请求都会经过它。

```js
function installSeqTagger(session) {
  if (session[SEQ_TAGGER] === true || typeof session.deriveMessages !== 'function') return;
  const original = session.deriveMessages;
  session[SEQ_TAGGER] = true;
  session.deriveMessages = function deriveMessagesWithSeq() {
    return tagRequestMessages(this, original.call(this)).messages;
  };
}
```

## 4. 编号怎么来

seq 是节点在 surface 上的绝对位置，和 `scan_context` / `compact_context` 的编号同源：

```js
for (const seq of session.surface.nodes) {
  const message = session.deriveEventMessage(session.log[seq]);
  seqOf.set(message, seq);          // 身份匹配
  byId.set(message.id, seq);        // id 兜底（重复 id 直接作废）
}
```

两层匹配：先按对象身份（`WeakMap`），命中不了再按 `message.id`。只留一层会在消息对象被复制的路径上静默全落空——这正是第一版看起来"没生效"的原因之一。

## 5. 覆盖范围

| 来源 | 打标 | 说明 |
|---|---|---|
| `user` 消息 | ✅ | 没有文本块时允许插一个纯文本块 |
| `tool` 结果 | ✅ | 同上 |
| 运行时上下文快照（cwd / 文件策略 / 时区） | ✅ | 以 `user/message` 追加进 surface（`dsh-agent-loop/lib/index.js:1069/1073`） |
| 插件自身的"占用 85%"提示 | ✅ | 也是普通 `user/message` 节点 |
| `assistant` 输出 | ✅ | **只在已有文本块时**前置，不插新块 |
| `developer` 消息 | ✅ | 规则同 assistant |
| `system` 消息（历史里落盘的） | ✅ | 规则同 assistant；字符串正文直接前置 |
| 系统提示词（请求独立字段） | ❌ | 不经过 `messages`，插件碰不到 |

除 `user` / `tool` 外都不插新块：避免把纯文本块塞到 `tool_use` 前面（个别 provider 会报"tool_use 必须紧跟 assistant"），也避免往只接受字符串的 system 位塞数组。

判定规则是「`role` 是非空字符串就打标」，所以未来新增的角色也会自动覆盖，不需要再改这里。

系统提示词打不了标，也不需要：它是稳定前缀，不是可压缩区间；往里加编号还会让前缀每次都变，提示词缓存全废。

## 6. 性质与边界

**不落盘，但不丢信息**。seq 来自持久化日志的绝对位置，重启前后同一节点号码不变，所以标签每次请求现算也不会错位。

**压缩会作废旧号**。区间被折叠后，那些节点从 surface 消失，号码从节点表里蒸发；检查点本身是一个新追加的节点，拿到一个更大的新号，下次请求会带 `[#新号]`。正文里残留的旧 `#N` 只是悬空引用，用它会报错（错误里会带上当前区间范围）。

**定位默认走编号**。`compact_context` 的默认定位方式就是这些编号：

```jsonc
{ "start": 812, "end": 940, "summary": "…" }          // 单段，start/end 也可写 "[#812]"
{ "segments": [{ "start": 812, "end": 940, "summary": "…" }] }
{ "start": 812, "summary": "…" }                       // end 省略 = 保留尾部前最后一个平衡边界
```

内容锚点 `from` / `to` 退为兜底（压缩区间正好起于无编号的系统提示词头部、或你手里没有编号时），写法仍是结构化正则，锚点里不要带 `[#N]` 前缀——正则是拿日志原文比的。

**一次调用压完整个区间**。区间里夹着"每步会被自动重新注入"的节点（system-reminder、runtime-context 快照）时，`splitSpanAtProtected` 把这些节点留在原处、把两侧各自成段，内部按多段事务提交：调用方只给一个 `start`/`end`，不必自己找缝隙补第二次调用。承载完整摘要的段取体积最大的那段，其余段写 `COMPANION_SUMMARY` 一句话指路；体积低于 `minShadowTokens` 的碎段原样留下。

**scan_context 默认不注册**（`cfg.scanTool: false`）。模型从消息开头的 `[#N 体积]` 直接拿编号，扫描工具给的是同源但更贵的另一份清单（见过一次 13k token 的节点列表），开着容易变成"先扫再压"的固定动作。

**system 提示词不参与**。打标只发生在 `messages` 上，系统提示词那段始终原样。

## 7. 验证

诊断日志：`C:\Users\Administrator\.dsh\seq-tagger.log`

```
tagger installed for session session-…
deriveMessages session-… 消息 82 条，命中 45（ok）
```

命中数小于总数属正常：assistant / system 里没有文本块的、以及非 surface 消息本来就不打标。

## 8. 生效

改完必须重启宿主。用工作区外的脚本经 WMI 在宿主进程树外创建（否则重启脚本会跟着被杀的宿主一起死）：

```powershell
Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
  CommandLine = 'powershell.exe -NoProfile -WindowStyle Hidden -File "C:\Users\Administrator\.dsh\restart-now.ps1"'
}
```

脚本内容：sleep 20s 留给答复送达 → 杀 3080 监听进程 → 后台起 `node <dsh>/lib/bin.js web` → 轮询端口直到监听。

## 9. 配置

`C:\Users\Administrator\.dsh\profiles\web\cordis.patch.yml` 里按 id 覆盖 `context-compact` 时，config 是**整块替换**（`--dump-config` 不做 schema 合并），必须抄全所有字段再加 `injectSeq: true`，否则丢字段会退回默认值。

新增字段 `scanTool`（默认 `false`）：需要节点清单时在 config 里写 `scanTool: true` 才注册扫描工具。

验证：

```powershell
node "C:\Users\Administrator\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh\lib\bin.js" --profile web --dump-config
```

## 10. 踩过的坑

1. **改 `decision.messages`**：那是本次新声明的消息，不是历史，改了白发。
2. **只按对象身份匹配**：消息被复制的路径上全部落空，且没有任何报错，表现就像"开关没生效"。
3. **改完不重启**：ESM 模块已在进程里，改源码对当前进程无效。
4. **靠 GUI 的"原始内容"判断是否生效**：那里读的是日志，永远没有标签——这恰恰是设计目标。
5. **锚点带 `[#N]` 去 `compact_context`**：匹配不到，压缩失败。
