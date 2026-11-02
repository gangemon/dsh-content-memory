# dsh-content-memory

DeepSeek Harness 的上下文压缩插件：让模型自己把过时的上下文折叠成摘要。

仓库内容就是插件本体 `packages/dsh-context-compact`，可直接装进 DSH profile 使用。

## 它做什么

- **`compact_context`**：模型给出摘要正文，用 `from`/`to` 正则定位被替换区间（写文件名、命令、报错原文这类独特片段即可），把区间替换成一个检查点；
- **`scan_context`**：列出 surface 上每个节点的类型、token 体积、内容开头，供模型挑选区间；
- **上下文面板**：右侧栏「上下文」tab，看 token 占用/可折叠区间，手动折叠不花模型 token，也能一键生成提示词；
- **自动注入**：占用超过阈值时，向模型注入压缩提示词（阈值、动作、提示词模板均可配置）。

## 安装

```bash
npm i -g dsh @deepseek-ai/dsh
cd <你的 profile 目录>
npm i dsh-context-compact
```

装好后在 profile 的 `cordis.patch.yml` 里启用（插件自带 patch 片段）。

## 使用

对话变长后直接说「压缩上下文」，或让模型调用 `compact_context`。面板在右侧栏「上下文」tab。

## 开发

- 源码：`packages/dsh-context-compact/lib/index.js`（宿主侧，ESM）、`lib/client.cjs`（浏览器端，无构建步骤）
- 改代码前先看 `lib/index.map.md`（符号地图：哪个函数在哪一行，常见改动去哪找）
- 打包：`cd packages/dsh-context-compact && npm pack`

## License

MIT
