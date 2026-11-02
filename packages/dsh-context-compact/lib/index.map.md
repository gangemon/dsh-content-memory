# dsh-context-compact 符号地图

> 用途：改代码前先在这里找行号，再 `read <文件> <offset> <limit>` 精读那一段，别整文件读。
> 行号会随改动漂移；`grep -n "<符号名>" lib/index.js` 可随时校准。生成于 2026-11-03，刷新于 2026-11-04。

## lib/index.js（约 2260 行，ESM）

| 行 | 符号 | 职责 |
|---|---|---|
| 6 | 文件头注释 | 两个工具与注入机制的约定说明 |
| 26 | MODULES / `hostImport` | 宿主模块加载（schemastery、dsh-llm） |
| 39 | `name` | 插件名 `context-compact` |
| 41 | `inject` | 宿主服务依赖：tools、systemPrompt |
| 43–48 | CHECKPOINT_* / SUMMARY_* | 检查点框架标签 |
| 50–103 | `Config` | 全部配置项（阈值、动作、摘要模板、提示词模板、工具名/描述） |
| 104 | SETTINGS_FILE | 运行时覆盖存盘路径 |
| 110 | `readSettings` | 读运行时覆盖 |
| 120 | `writeSettings` | 写运行时覆盖 |
| 128 | `effectiveThreshold` | 阈值（配置 ∪ 运行时覆盖） |
| 135 | `effectiveAction` | 动作（compress/kill/context） |
| 142 | `effectiveTemplate` | 摘要模板选择 |
| 149 | `optionalService` | 取可选宿主服务 |
| 166 | `textOfMessage` | 消息文本抽取 |
| 176 | `clip` | 截断工具 |
| 181 | `previewOf` | 节点内容开头预览 |
| 192 | `structuredTextOf` | 消息结构化文本 |
| 219 | `fullTextOf` | 节点全文（供摘要/正则匹配） |
| 237 | `nodeKindOf` | 节点类型 u/a/t/s/d |
| 251 | `normalizeMatchText` | 空白折叠（严格级） |
| 256 | `stripLineNumberPrefix` | 去 `1682: ` / `12| ` 行号前缀 |
| 269 | `matchNormalizations` | **4 级归一化阶梯**：原样 → 忽略空白 → 去行号 → NFKC 全半角 |
| 318 | `suggestAnchor` | 取节点原文前 24 字生成可抄的 `re:^` 锚点（报错里用） |
| 340 | `locateExcludedSeqs` | 匹配池排除：重注入上下文 + 最近自有工具节点（断自指） |
| 379 | `nodeFingerprint` | 节点结构指纹（序号/类型/token，不含原文） |
| 404 | `locateFailure` | 定位失败报错（结构信息 + 试过的级别 + 可抄锚点，不回显原文） |
| 452 | `resolveLocate` | from/to 定位唯一 seq；内部 `findEndpoint` 逐级降级 + **开头优先** |
| 569 | `convergeSpan` | 两端自动收敛到不劈开工具步的安全切点（只往更早走） |
| 615 | `assertSpanUnambiguous` | 收敛后按生效级别复检区间内 from/to 唯一性 |
| 652 | `locateSpan` | 定位 + 收敛 + 复检三合一（工具调用入口），合并各级 notes |
| 667 | REGENERABLE_INJECTION_PATTERNS | 会被自动重注入的上下文模式 |
| 677 | `allRegenerableInjectionSeqs` | **全部**历史注入节点（匹配池排除用） |
| 697 | `latestRegenerableInjectionSeqs` | 每类最新注入 seq |
| 713 | `regenerableInjectionTag` | 注入标签 |
| 731 | `roughTokens` | 粗估 token |
| 735 | `messageTokens` | 单消息 token |
| 747 | `measureNodes` | 逐节点测量 |
| 779 | `protectedHeadSeq` | 头部保护边界 |
| 799 | `assertHeadExcluded` | 头部保护校验 |
| 809 | `validateSpan` | 区间合法性兜底（配对/越界/头部/重注入） |
| 844 | `parseSegmentArgs` | segments 参数解析 |
| 870 | `aggregateFolds` | 多段结果聚合 |
| 906 | `inspectEntryState` | 入口检查（可用性、失败原因） |
| 943 | `measurePressure` | 占用率/节点/小计 |
| 967 | `buildHintText` | **注入的压缩提示词**（节点清单 + 怎么压） |
| 1021 | `compressibleRanges` | 可折叠区间计算（含 keep 保护） |
| 1093 | `keepSeqsOf` | 保留 seq 集合 |
| 1101 | `pickRecommended` | 推荐区间 |
| 1111 | `render` | 工具输出渲染 |
| 1115 | `frameSummary` | 摘要包装成检查点 |
| 1136 | `hasLiveCheckpoint` | 是否已有生效检查点 |
| 1153 | `checkpointBodyOf` | 取检查点正文 |
| 1185 | `absorbAdjacentCheckpoints` | 相邻检查点吸收 |
| 1235 | scan_context 注册 | 节点清单工具（类型/token + 内容开头） |
| 1310 | compact_context 注册 | 压缩工具（from/to/segments） |
| 1682 | `panelSnapshot` | 面板数据（tokens = 整窗口、windowTokens、nodes、ranges） |
| 1904 | `/state` | 面板轮询数据 |
| 1924 | `/node` | 单节点正文 |
| 1957 | `/config` | 面板改阈值/动作 |
| 2017 | `/fold` | 面板手动折叠 |
| 2058 | `/ask` | 面板生成提示词 |
| 2126 | `/inbox-clear` | 清空待注入提示 |
| 2261 | `export default` | 插件导出 |

## lib/client.cjs（约 1896 行，classic script，无打包步骤）

外层 `window.__ModuleLoader__.load({ id: 'dsh-context-compact', factory })`，工厂体在首次 import 时执行。

| 行 | 符号 | 职责 |
|---|---|---|
| 19–40 | 常量 | TAB_ID/TAB_KIND/TAB_TITLE/ROUTE_BASE/各 URL/超时/刷新间隔/MAX_NODE_ROWS |
| 45–228 | `CSS` | 面板全部样式（含 `.ccc-seg.is-overhead` 斜纹开销段） |
| 225 | `h` = React.createElement | 无 JSX，统一用 h |
| 230 | `injectStyles` | 注入 <style>（幂等） |
| 283 | `errorText` | 错误文案 |
| 291 | `formatNum` / 298 `formatWindow` | 数字/窗口格式化 |
| 305 | `ratioOf` | 占用率 |
| 312 | `KIND_LABELS` / 322 `kindLabel` | 节点类型标签 |
| 328 | `isFailure` | 失败判定 |
| 335 | `Card` / 339 `Empty` | 小卡片、空态 |
| 349 | `Hero` | 顶部圆环 + 阈值 |
| 543 | `ContextMap` | **主视图**：圆环/分段/时间轴/图例/点选区间；条带按整窗口 token 铺，末尾接 overhead 斜纹段 |
| 1065 | `ErrorBanner` | 错误条 |
| 1081 | `PanelBoundary` | class 错误边界 |
| 1109 | `Sheet` | 右侧抽屉（手动折叠表单、提示词、改动记录） |
| 1565 | `FoldCard` | 单条折叠记录 |
| 1606 | `Panel` | **面板主体**：轮询 state、动作、模式状态机 |
| 1837 | `inject` | 客户端服务依赖：slots、sidebarRightTabs |
| 1840 | `apply` | 注册 tab 类型/body/title |

## 常见改动定位

- 改阈值默认/范围 → index.js `Config@50`；面板改阈值走 `/config@1957`
- 改注入提示词怎么写 → `buildHintText@967`
- 改节点清单格式 → `buildHintText@967` 末段 + `previewOf@181`
- 改压缩工具参数 → compact_context 注册（1310）+ `Config` 的 `toolName/toolDescription`
- 改 from/to 匹配规则/归一化/报错 → `matchNormalizations@269`、`resolveLocate@452`、`locateFailure@404`、`locateSpan@652`
- 改两端平衡/收敛行为 → `convergeSpan@569` + `validateSpan@809`（兜底）
- 改圆环/地图外观 → client.cjs `ContextMap@543` + `CSS@45–228`
- 改手动折叠表单 → `Sheet@1109`
- 改折叠记录列表 → `FoldCard@1565`
