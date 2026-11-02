# dsh-context-compact

让模型自己决定在哪里压缩上下文：先扫描 surface，再指定区间，直接把检查点摘要写进去。

## 两个工具

- `scan_context` — 列出 surface 上每个节点：`seq`、事件类型、估算 token 体积、预览、是否为保留尾部；并给出推荐的 `[start, end]`（`compressible`）。
- `compact_context` — 把一段或几段节点整体替换成检查点，`summary` 就是替换后留下的全部内容。`dryRun: true` 只做校验，不落盘。
  - 单段：`{ start, end, summary, dryRun? }`
  - 多段：`{ segments: [{ start, end, summary }, …], dryRun? }` —— 一次调用折多段

先跑 `scan_context`，再 `compact_context --dryRun`，最后去掉 `dryRun` 真压。

## 多段：一次调用折多段

`segments` 里的每一段各带自己的 `summary`。调用时先逐段预演（边界、体积、摘要长度全部检查一遍），全部通过才按 surface 顺序逐段落盘——不会出现「压到第三段才发现第二段非法」。每段仍是一个独立的 compaction 事务，和连调 N 次工具等价，只是省掉 N 轮模型往返。

- 段与段不能重叠（重叠直接报错，请合成一段）。
- 靠前段先生效，紧邻的旧检查点会被自动并进后一段（整段只留一个壳）。
- 单次最多 `maxSegments` 段（默认 12），每段仍受 `maxSpanNodes` 限制。
- 中途某段落盘失败会报「前 N 段已落盘，无法回滚」，按报错重试剩下的段即可。

返回：`{ ok, multi: true, segmentCount, segments: [{ index, startSeq, endSeq, replacedNodes, shadowedTokens, summaryTokens, savedTokens, compactionId, warning }], totalShadowedTokens, totalSummaryTokens, totalSavedTokens, compactionIds, warning }`。

## 会拒绝的情况

| 情况 | 报错含义 |
| --- | --- |
| 区间端点不在 surface 上 / start>end | 先 `scan_context` 拿准确的 seq |
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
| `keepTailNodes` | 尾部保留多少节点不参与推荐区间 |
| `maxSpanNodes` | 单段最多替换多少节点（多段模式下逐段计算） |
| `maxSegments` | 一次调用最多折几段（默认 12） |
| `minShadowTokens` | 区间体积下限，太小不值得压 |
| `requireShrink` | 要求摘要严格短于被替换内容 |
| `summaryLanguage` | 摘要语言，默认「与对话相同的语言」 |
| `summaryStyle` | 摘要写法，默认按主题分节、先结论、保留路径/命令/失败现场 |
| `extraRules` | 追加硬规则，拼在策略末行，优先级最高 |
| `injectPrompt` | 是否把策略注入系统提示词 |
| `sectionOrder` | 注入段在 system prompt 中的排序位 |
| `promptThresholdPct` | 占用率达到该百分比时，把可压缩的 seq 区间一起注入提示词（默认 70，0 = 每轮都注入） |
| `contextWindowTokens` | 估算占用率用的窗口大小（默认 80000） |
| `maxHintRanges` | 提示词里最多列几个可压缩区间（默认 12） |

`injectPrompt` 打开时，上面这些字段组成的策略文本会作为系统提示词的一段注入：平时只说规则；一旦占用越过 `promptThresholdPct`，这段文本里会多出一份**当前可以直接压的 `[start, end]` 清单**（两端已对齐工具配对、已排除尾部保留节点、已按 `minShadowTokens` 过滤），模型照抄区间即可调用 `compact_context`。`scan_context` 返回的 `compressible` 字段是同一份清单。

## 安装

```powershell
plugin_manager action: install_bundle target: E:\Ai\退注意力\packages\dsh-context-compact
```

包自身不带 `node_modules`，`@deepseek-ai/*` 通过 `DSH_MODULES`（默认宿主安装目录）动态解析。
