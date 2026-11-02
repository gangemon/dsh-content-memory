# dsh-context-compact 符号地图

> 用途：改代码前先在这里找行号，再 `read <文件> <offset> <limit>` 精读那一段，别整文件读。
> 行号会随改动漂移；`grep -n "<符号名>" lib/index.js` 可随时校准。生成于 2026-11-03。

## lib/index.js（约 1800 行，ESM）

| 行 | 符号 | 职责 |
|---|---|---|
| 6 | 文件头注释 | 两个工具与注入机制的约定说明 |
| 21–37 | MODULES / hostImport | 宿主模块加载（schemastery、dsh-llm） |
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
| 249 | `resolveLocate` | **from/to 正则 → seq 区间**（含歧义/未命中报错） |
| 287 | REGENERABLE_INJECTION_PATTERNS | 会被自动重注入的上下文模式 |
| 294 | `latestRegenerableInjectionSeqs` | 每类最新注入 seq |
| 310 | `regenerableInjectionTag` | 注入标签 |
| 328 | `roughTokens` | 粗估 token |
| 332 | `messageTokens` | 单消息 token |
| 344 | `measureNodes` | 逐节点测量 |
| 376 | `protectedHeadSeq` | 头部保护边界 |
| 396 | `assertHeadExcluded` | 头部保护校验 |
| 406 | `validateSpan` | 区间合法性（配对/越界/头部/重注入） |
| 435 | `parseSegmentArgs` | segments 参数解析 |
| 461 | `aggregateFolds` | 多段结果聚合 |
| 495 | `inspectEntryState` | 入口检查（可用性、失败原因） |
| 532 | `measurePressure` | 占用率/节点/小计 |
| 556 | `buildHintText` | **注入的压缩提示词**（节点清单 + 怎么压） |
| 610 | `compressibleRanges` | 可折叠区间计算（含 keep 保护） |
| 682 | `keepSeqsOf` | 保留 seq 集合 |
| 690 | `pickRecommended` | 推荐区间 |
| 700 | `render` | 工具输出渲染 |
| 704 | `frameSummary` | 摘要包装成检查点 |
| 725 | `hasLiveCheckpoint` | 是否已有生效检查点 |
| 742 | `checkpointBodyOf` | 取检查点正文 |
| 774 | `absorbAdjacentCheckpoints` | 相邻检查点吸收 |
| 807 | `apply` | **插件主体**：注册两个工具 + 注入 + 服务 + 路由 |
| ~830 | scan_context 注册 | 节点清单工具（类型/token + 内容开头） |
| ~1000 | compact_context 注册 | 压缩工具（from/to/segments） |
| ~1100 | 自动注入 timer | 超阈值时注入提示词 |
| ~1300 | `/context-compact/state` | 面板数据接口 |
| ~1500 | `/context-compact/fold` | 面板手动折叠 |
| ~1620 | `/context-compact/ask` | 面板生成提示词 |
| ~1700 | `/context-compact/config` | 面板改阈值/动作 |
| 1844 | `export default` | 插件导出 |

## lib/client.cjs（约 1842 行，classic script，无打包步骤）

外层 `window.__ModuleLoader__.load({ id: 'dsh-context-compact', factory })`，工厂体在首次 import 时执行。

| 行 | 符号 | 职责 |
|---|---|---|
| 19–40 | 常量 | TAB_ID/TAB_KIND/TAB_TITLE/ROUTE_BASE/各 URL/超时/刷新间隔/MAX_NODE_ROWS |
| 45–210 | `CSS` | 面板全部样式（字符串模板） |
| 225 | `h` = React.createElement | 无 JSX，统一用 h |
| 228 | `injectStyles` | 注入 <style>（幂等） |
| 281 | `errorText` | 错误文案 |
| 289 | `formatNum` / 296 `formatWindow` | 数字/窗口格式化 |
| 303 | `ratioOf` | 占用率 |
| 310 | `KIND_LABELS` / 320 `kindLabel` | 节点类型标签 |
| 326 | `isFailure` | 失败判定 |
| 333 | `Card` / 337 `Empty` | 小卡片、空态 |
| 347 | `Hero` | 顶部圆环 + 阈值 |
| 541 | `ContextMap` | **主视图**：圆环/分段/时间轴/图例/点选区间 |
| 1022 | `ErrorBanner` | 错误条 |
| 1038 | `PanelBoundary` | class 错误边界 |
| 1066 | `Sheet` | 右侧抽屉（手动折叠表单、提示词、改动记录） |
| 1522 | `FoldCard` | 单条折叠记录 |
| 1563 | `Panel` | **面板主体**：轮询 state、动作、模式状态机 |
| 1793 | `inject` | 客户端服务依赖：slots、sidebarRightTabs |
| 1796 | `apply` | 注册 tab 类型/body/title |

## 常见改动定位

- 改阈值默认/范围 → index.js `Config@50`；面板改阈值走 `/config@~1700`
- 改注入提示词怎么写 → `buildHintText@556`
- 改节点清单格式 → `buildHintText@556` 末段 + `previewOf@181`
- 改压缩工具参数 → compact_context 注册（~1000）+ `Config` 的 `toolName/toolDescription`
- 改 from/to 匹配规则/报错 → `resolveLocate@249`、`validateSpan@406`
- 改圆环/地图外观 → client.cjs `ContextMap@541` + `CSS@45–210`
- 改手动折叠表单 → `Sheet@1066`
- 改折叠记录列表 → `FoldCard@1522`
