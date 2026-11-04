# dsh-content-memory

DeepSeek Harness 的上下文压缩插件：让模型自己把过时的上下文折叠成摘要。

仓库内容就是插件本体 `packages/dsh-context-compact`，可直接装进 DSH profile 使用。

## 它做什么

- **`compact_context`**：模型给出摘要正文和区间，把区间替换成一个检查点。区间用节点编号定位——`972`、`[#972]`、`[#972 1.2k]` 都认，`[#N 体积]` 这个标签就是插件自己打在消息开头的（`injectSeq` 打开时）。端点落在工具步中间会自动吸附到最近的合法边界；区间里夹着每步重新注入的上下文时，单段请求会自动切成多段、把它们原地保留。
- **`scan_context`**（可选，默认关）：列出 surface 上每个节点的类型、token 体积、内容开头。默认不注册——编号从消息头就能拿，扫一遍清单是额外开销。
- **上下文面板**：右侧栏「上下文」tab，看 token 占用/可折叠区间，手动折叠不花模型 token，也能一键生成提示词。
- **自动注入**：占用越过反思线（`promptThresholdPct`）时，向模型注入压缩提示词。反思线是「回头看一眼前缀」的刻度，不是压缩开关——压哪段由内容判据决定。

## 安装

```bash
npm i -g dsh @deepseek-ai/dsh
cd <你的 profile 目录>
```

三种装法选一种：

```bash
# 1. 直接从 GitHub 装子包（pnpm 需要能访问 codeload.github.com）
pnpm add "https://github.com/gangemon/dsh-content-memory.git#path:/packages/dsh-context-compact"

# 2. 从本地克隆装（仓库已 clone 到本地时；等价于符号链接，改源码即生效）
pnpm add /path/to/dsh-content-memory/packages/dsh-context-compact

# 3. 从打包好的 tgz 装
cd /path/to/dsh-content-memory/packages/dsh-context-compact && pnpm pack
cd <你的 profile 目录> && pnpm add /path/to/dsh-context-compact-0.1.0.tgz
```

装好后在 profile 的 `cordis.patch.yml` 里启用（插件自带 patch 片段）。

> 若第 1 种报 `codeload.github.com ... 404`：这是网络到 codeload 不通（git 本身能推拉不代表 codeload 通），pnpm 的 GitHub 依赖一律从 codeload 取 tarball。挂代理，或改用 2、3。

## 使用

对话变长后直接说「压缩上下文」，或让模型调用 `compact_context`。面板在右侧栏「上下文」tab。

## 开发

- 源码：`packages/dsh-context-compact/lib/index.js`（宿主侧，ESM）、`lib/client.cjs`（浏览器端，无构建步骤）
- 改代码前先看 `lib/index.map.md`（符号地图：哪个函数在哪一行，常见改动去哪找）
- 打包：`cd packages/dsh-context-compact && npm pack`

## License

MIT
