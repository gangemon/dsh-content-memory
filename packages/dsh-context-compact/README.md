# dsh-context-compact

让模型自己决定在哪里压缩上下文：按消息上的节点编号指定区间，直接把检查点摘要写进去。

## 工具

- `compact_context` — 把一段或几段节点整体替换成检查点，`summary` 就是替换后留下的全部内容。`dryRun: true` 只做校验，不落盘。
  - 单段：`{ start, end, summary, dryRun? }`
  - 多段：`{ segments: [{ start, end, summary }, …], dryRun? }` —— 一次调用折多段
- `scan_context` — 可选，列出 surface 上每个节点的 `seq`、类型、体积、预览，并给出推荐的 `[start, end]`。默认**不注册**（`scanTool: false`）：编号从消息开头的 `[#N 体积]` 就能拿到，再扫一遍清单是额外开销。要用时在配置里打开。

## 定位区间

`start` / `end` 认节点编号，三种写法等价：`972`、`[#972]`、`[#972 1.2k]`。编号来自消息开头的标签，和 `compact_context` 内部用的是同一套 surface 序号。

- `end` 省略 = 保留尾部之前最后一个平衡边界（不用自己数到哪）。
- 端点落在工具调用与结果中间时自动吸附到最近的合法边界，移动结果写在返回的 `notes` 里（`snapSpan: false` 则直接报错）。
- `from` / `to` 正则只在没有编号可用时兜底。

先 `compact_context --dryRun` 预演，最后去掉 `dryRun` 真压。

## 单段会自动分段

区间里夹着「每一步都会被重新注入」的上下文（system-reminder、runtime context 快照、面板提示）时，单段请求会自动切成多段：这些节点原地保留，两侧各成一段，返回 `segmentCount > 1`。规则是每类注入只保护**最新的一条**——要压掉更早的同类注入，先把区间起点放到最新那条之后，再分次调用。

## 多段：一次调用折多段

`segments` 里的每一段各带自己的 `summary`。调用时先逐段预演（边界、体积、摘要长度全部检查一遍），全部通过才按 surface 顺序逐段落盘——不会出现「压到第三段才发现第二段非法」。每段仍是一个独立的 compaction 事务，和连调 N 次工具等价，只是省掉 N 轮模型往返。

- 段与段不能重叠（重叠直接报错，请合成一段）。
- 靠前段先生效，紧邻的旧检查点会被自动并进后一段（整段只留一个壳）。
- 单次最多 `maxSegments` 段（默认 20），每段仍受 `maxSpanNodes` 限制。
- 中途某段落盘失败会报「前 N 段已落盘，无法回滚」，按报错重试剩下的段即可。

返回：`{ ok, multi: true, segmentCount, segments: [{ index, startSeq, endSeq, replacedNodes, shadowedTokens, summaryTokens, savedTokens, compactionId, warning }], totalShadowedTokens, totalSummaryTokens, totalSavedTokens, compactionIds, warning }`。

## 会拒绝的情况

| 情况 | 报错含义 |
| --- | --- |
| 区间端点不在 surface 上 / start>end | 用消息开头的 `[#N]` 编号，别推算 |
| 切断了工具调用与结果的配对 | 把整个调用-结果对一起纳入或一起排除 |
| 两段重叠 | 把重叠的段合成一段 |
| 段数超过 `maxSegments` | 分批调用 |
| 另一段压缩正在进行 | 等它结束 |
| 区间太小（`minShadowTokens`） | 选大一点 |
| 摘要不比原文短（`requireShrink`） | 摘要写短些 |

## 再次压缩

已生成的检查点在 surface 上就是一个普通节点，所以「压缩过的检查点再被压缩」不需要特殊支持：把那个检查点所在区间选进去就行，其间可以夹新的对话。

## 策略配置

配置页字段即 `Config` schema，宿主自动生成表单：

| 字段 | 作用 |
| --- | --- |
| `enabled` | 总开关 |
| `toolName` / `scanToolName` | 两个工具的名字 |
| `scanTool` | 是否注册 `scan_context`（默认关） |
| `keepTailNodes` | 尾部保留多少节点不参与推荐区间 |
| `protectRegenerableInjections` | 压缩区间是否自动避开每步重新注入的上下文（默认开） |
| `snapSpan` | 端点落在工具步中间时是否自动吸附到平衡边界（默认开） |
| `maxSpanNodes` | 单段最多替换多少节点（多段模式下逐段计算） |
| `maxSegments` | 一次调用最多折几段（默认 20） |
| `minShadowTokens` | 区间体积下限，太小不值得压 |
| `requireShrink` | 要求摘要严格短于被替换内容 |
| `summaryLanguage` | 摘要语言，默认「与对话相同的语言」 |
| `summaryStyle` | 摘要写法，默认按主题分节、先结论、保留路径/命令/失败现场 |
| `extraRules` | 追加硬规则，拼在策略末行，优先级最高 |
| `injectPrompt` | 是否把策略注入系统提示词 |
| `sectionOrder` | 注入段在 system prompt 中的排序位 |
| `promptThresholdPct` | 反思线（默认 70，0 = 每轮都提醒）；它是回头看的刻度，不是压缩开关 |
| `triggerAction` | 越过反思线后做什么：`inject` 只提醒、`fold` 由面板直接折叠、`off` 只显示 |
| `contextWindowTokens` | 估算占用率用的窗口大小（默认 80000） |
| `maxHintRanges` | 提示词里最多列几个提示方向（默认 12） |
| `injectSeq` | 请求期给每条 user / tool 消息加 `[#seq 体积]` 前缀（不写日志，默认关，见 [docs/node-seq.md](docs/node-seq.md)） |
| `injectSeqIndex` | 越过反思线时额外注入一条 `[#seq]` 节点索引消息（默认关） |
| `seqIndexMaxNodes` / `seqIndexPreviewChars` | 节点索引最多列几个节点、每行预览多少字（默认 40 / 40） |

`injectPrompt` 打开时，上面这些字段组成的策略文本会作为系统提示词的一段注入。平时只说规则；占用越过 `promptThresholdPct`（反思线）时，提示词里换用完整版指南——提醒按「重建成本 × 重建概率 < 释放 token × 剩余轮数」判断压哪段、留哪段，并说明怎么用 `[#N]` 定位。**不注入节点清单、不预切可压区间**，编号由模型从自己看到的消息头里取。

## 安装

```powershell
plugin_manager action: install_bundle target: E:\Ai\退注意力\packages\dsh-context-compact
```

包自身不带 `node_modules`，`@deepseek-ai/*` 通过 `DSH_MODULES`（默认宿主安装目录）动态解析。
