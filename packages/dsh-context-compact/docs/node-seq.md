# 节点编号（[#seq]）注入设计

给 surface 上的每个节点一个模型可见的编号，让「压哪一段」从「用我记得的原文去猜」变成「说编号」。

- 状态：**最小版已实现**（`injectSeq`，默认关闭）；完整版见下文。
- 当前实现：请求期覆盖 `session.deriveMessages()`，给每条 user / tool 消息加 `[#seq]` 前缀（不写日志）；可选的「节点索引消息」由 `injectSeqIndex` 单独控制。
- 实测日期：2026-02（按本机 `@deepseek-ai/dsh` 包核对）。

---

## 0. 先说通道：宿主为什么不能直接改消息

原计划的「给历史里每条 user / tool 消息前面加 `[#seq]`」在本机宿主上**没有支持的通道**，三条路都堵死：

| 想用的钩子 | 实际情况 |
| --- | --- |
| `ctx.on('llm/stream', (options, next) => …)` | 类型签名 `next: () => AsyncIterable<StreamChunk>`，`next` 不收参数；底层 `ctx.waterfall(this, 'llm/stream', options, () => this.adapterStream(options, prepared))` 的 fallback 闭包已经捕获了 `options`，`options.messages` 是 `session.deriveMessages()` 产物的冻结数组，改不了。 |
| `ctx.on('agent/pre-step', …)` | 只拿到 `claimed`（inbox 里本轮新消息）+ runtime context，**不含历史**；历史是在 pre-step 之后由 `buildRequest()` 调 `session.deriveMessages()` 现取的。 |
| `ctx.sessions.registerMessageProjection({ type: 'user/message', project })` | 投影分支 `kind: 'project'` **不会把节点 push 进 `state.nodes`**（`planSurfaceEvent` → `applySurfacePlan`），而 `user/message` / `tool/result` 本身是 surface 节点的来源。接管它们 = 把这两类事件从 surface 里踢出去，扫描/压缩全废。 |

同一张表也解释了为什么 `image/offload` 可以用投影：它不是 surface 节点，投影只改写它「指向的」已有节点。

**结论**：模型能看到的、可以每步往里加东西的**追加**通道只有 `agent/pre-step` 里追加一条 `createUserMessage`（和本插件已有的阈值提示、runtime context 快照同构）；而**改写已有消息**的通道在读取侧——请求是 `buildRequest()` 现取 `session.deriveMessages()` 建的，Session 实例没被冻结，`deriveMessages` 是原型方法，可以在实例上覆盖。这才是 `[#seq]` 真正该待的地方（见第 1 节）。

---

## 1. 最小版（已实现）

配置项：

| 字段 | 默认 | 含义 |
| --- | --- | --- |
| `injectSeq` | `false` | 是否给请求里的每条 user / tool 消息加 `[#seq]` 前缀 |
| `injectSeqIndex` | `false` | 是否另外注入一条「surface 节点索引」用户消息（越过阈值时） |
| `seqIndexMaxNodes` | `40` | 索引最多列多少个节点（取 surface 尾部） |
| `seqIndexPreviewChars` | `40` | 每行预览字数 |

### 1.1 打标（`injectSeq`）

实现：`installSeqTagger`（`lib/index.js`）。`agent/pre-step` 里每个会话第一次出现时装一次，覆盖该会话实例的 `deriveMessages`：

1. `orig()` 拿到原数组（顺序 = surface 节点顺序）；
2. 遍历 `session.surface.nodes`，用 `session.deriveEventMessage(session.log[seq])` 反查「消息对象 → seq」（消息是冻结的、身份稳定，所以 WeakMap 可靠）；
3. 只给 `role === 'user'` / `'tool'` 的消息在**第一个文本块**前加 `[#seq]\n`（没有文本块就在最前面插一个），`assistant` / `system` 原样放过；
4. 标记结果按源消息对象缓存（WeakMap），同一条消息永远复用同一个标记对象，不会每次请求都造新对象。

效果（和请求里看到的一致）：

```
user: [#301] 给 compact_context 加一个 dryRun 参数
tool: [#305] <path>E:\…\lib\index.js</path> …
assistant: （无标记）
```

性质：

- **请求期生效，不落盘**：不写会话日志、不动 surface 节点，`scan_context` / `compact_context` 的编号与它同源（都是 seq）。
- 关掉配置重启即彻底消失；没有「写进去就删不掉」的残留。
- 成本：每条消息 `3~5` token（`[#301]` 6 个字符），一百条消息约 400 token。
- 宿主的 message projection（如 image/offload）在我们之前生效，我们只是在它的结果上克隆一条 —— 两者不冲突。

### 1.2 节点索引消息（`injectSeqIndex`）

`buildSeqIndexText` 生成的整段索引，作为一条独立 user 消息注入（`source.kind = context-compact-seq`），仅在越过 `promptThresholdPct` 且内容变化时发一次（`lastSeqIndex` 去重）：

```
surface 节点索引（编号只用于定位；不要把 [#编号] 抄进回复或摘要）：
（只列最近 40 个节点，共 57 个；更早的省略）
[#301] user/message 给 compact_context 加一个 dryRun 参数
[#305] tool/result E:\Ai\退注意力\packages\dsh-context-compact\lib\index.js…
```

它和 `injectSeq` 是互补的：打标让每条消息自带编号（永远在场），索引给一张总览（只在压力大时发一次）。两者都默认关闭，按需开。

与现有工具的关系：

- `scan_context` 本来就返回每个节点的 `seq`，打标让这个编号**常驻**在对话里，不必模型主动调用。
- `compact_context` 的 `from` / `to` **仍按内容正则定位**，编号目前只是参照，没有接进定位逻辑（见完整版第 3 节，这是下一步的主要工作）。

---

## 2. 完整版：模式与语义

### 2.1 开关三态

`injectSeq` 从 boolean 升级为枚举：

| 值 | 行为 |
| --- | --- |
| `off`（默认） | 不注入任何编号 |
| `threshold` | 越过阈值时注入一次（= 现在的最小版） |
| `always` | 每条请求都注入，且只在节点集合变化时刷新 |

`always` 的代价是线性的：每步一条，40 节点约 400 token / 步。只适合「每步都在压缩」的长任务。

### 2.2 编号本身就是 seq，不重新编号

编号直接用 `session.surface.nodes` 里的 `seq`（`SessionSeq`，单调递增、压缩后会跳号）。理由：

1. `seq` 已经是 `scan_context` / 面板 / 日志的共同主键，模型说「#341」人和工具都能对上；
2. 不跳号的连续编号（1..N）在压缩后会整体重排，和面板、日志全部错位，反而更难对。

代价：编号有空洞（压缩后 305 → 341）。这不用解释太多，索引消息里给出「共 N 个，只列最近 40 个」就够。

### 2.3 只跳 system 与 node 0

- node 0 是 system prompt（`assertSystemHeadRewrite` 保护的那个），压缩永远不碰它，编号会诱导模型去压；
- 每步重新注入的 runtime context 快照 / 本插件自己的阈值提示属于「再生节点」（`latestRegenerableInjectionSeqs`），编号同理不列。

索引里统一用 `keep` 标记（与 `scan_context` 的 `keep` 字段一致），而不是直接隐藏 —— 隐藏会让模型对「为什么少了几个号」做无谓推理。

### 2.4 写法规则（写进提示词）

```
编号 [#seq] 只用来指代节点，不要抄进回复、摘要或任何工具参数。
指代示例：压 #301 到 #305；不要写「压第 2 条」。
```

不写这条规则，模型会在摘要里复制 `[#341]`，摘要因此被污染，且压缩后的检查点又会被当成新节点编号，越滚越脏。

### 2.5 adapter 兼容性

| 通道 | 影响 |
| --- | --- |
| OpenAI / DeepSeek chat completions | 无碍：`[#341]` 就是普通文本前缀 |
| Anthropic messages | 无碍：`tool_result` 的 content 是文本 block 数组，前缀合法 |
| Gemini | 需实测：`parts` 结构对纯文本前缀应无碍，但工具结果回传格式有差异 |
| 任何带前缀缓存的 provider | 有代价：编号变了前缀就变，prompt cache 命中率下降 |

这也是「不改历史消息、只追加一条索引消息」的另一个好处：历史消息保持字节不变，缓存前缀不动。

---

## 3. 下一步：让编号真正参与定位

现在 `from` / `to` 是内容正则（见 README「定位」一节）。编号进来后可以加一条新写法：

```
from: "#301"
to:   "#305"
```

实现要点（都在这一个包里，不需要宿主改动）：

1. `resolveLocate` 之前加一层：`/^#(\d+)$/` 命中就直接当 seq 用，跳过 `matchNormalizations` 的全文扫描；
2. 仍然走 `convergeSpan` / `validateSpan` 的平衡切点与保护检查，编号不绕过任何安全约束；
3. `compact_context` 的 schema 描述里并列写出两种写法，编号写法排在正则之前（更容易写对），但注明「编号必须来自节点索引或 scan_context，不要凭空猜」；
4. 面板 `/fold` 路由已经在用 `previewOf` + seq，改成传编号即可。

判断标准：模型用编号定位的失败率应显著低于内容正则（`locateFailure` 里按 `kind` 统计）。这个对比数据出来之前，先不要删正则那条路。

---

## 4. 回看清单（做完后要回答的问题）

1. 注入索引后，模型引用节点的方式有没有变？还有多少调用在写内容正则？
2. `threshold` 模式下，编号够不够用？需不需要 `always`？
3. 摘要里有没有被抄进 `[#编号]`？如果有，2.4 的规则要更硬（改到工具 schema 描述里）。
4. 索引消息自身变成 surface 节点（每档一条），是否值得在压缩时自动跳过？目前 `protectRegenerableInjections` 已经覆盖同类节点。
