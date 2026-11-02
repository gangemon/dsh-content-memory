/**
 * dsh-context-compact
 *
 * 让模型自己能压缩上下文：
 *   1. `scan_context`    —— 列出 surface 上每个节点（类型 / 体积 / 内容开头），供挑选区间；
 *   2. `compact_context` —— 模型直接给出检查点摘要正文，用 from/to 按内容定位被替换区间，替换成一个检查点。
 *
 * 事务协议与 `@deepseek-ai/dsh-compaction-basic` 一致：
 *   compaction/start → compaction/summary → user/message(surfaceOp replace) → compaction/end
 * 因此已存在的检查点节点也能再次被压缩（它只是区间里的一个普通节点）。
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// 本插件以 link: 方式挂在 profile 里，自身没有 node_modules，
// 而 @deepseek-ai/* 是宿主的运行时包 —— 按 DSH_MODULES 约定锚定到宿主目录解析。
const MODULES = process.env.DSH_MODULES
  ?? 'C:\\Users\\Administrator\\AppData\\Roaming\\npm\\node_modules\\@deepseek-ai\\dsh\\node_modules';

const hostRequire = createRequire(path.join(MODULES, 'anchor.cjs'));

function hostImport(spec) {
  return import(pathToFileURL(hostRequire.resolve(spec)).href);
}

const z = (await hostImport('@deepseek-ai/schemastery')).default;
const { createUserMessage } = await hostImport('@deepseek-ai/dsh-llm');
const {
  CompactionId,
  compactCheckpointSource,
  toolPairingBalancedAfter,
  toolPairingBalancedBefore,
} = await hostImport('@deepseek-ai/dsh-compaction');

export const name = 'context-compact';

export const inject = ['tools', 'systemPrompt'];

const CHECKPOINT_PREAMBLE =
  '这是一份由压缩工具生成的检查点，把更早的一段对话折叠成了摘要。把摘要里记录的内容当作已经发生过的事实继续工作，不要复述它。';
// 同一次多段压缩里，第二段起不再重复整句前言：一句话说明它同样是被折叠的历史即可。
const CHECKPOINT_CONTINUATION = '（续）这段同样是被折叠的历史摘要，按已发生事实对待：';
const SUMMARY_OPEN_TAG = '<compacted-summary>';
const SUMMARY_CLOSE_TAG = '</compacted-summary>';

export const Config = z.object({
  enabled: z.boolean().default(true).description('是否注册压缩工具'),
  toolName: z.string().default('compact_context').description('压缩工具的模型可见名称'),
  scanToolName: z.string().default('scan_context').description('扫描工具的模型可见名称'),
  keepTailNodes: z
    .number()
    .default(4)
    .description('尾部保留节点数：scan 会把最后 N 个节点标成不推荐压缩'),
  protectRegenerableInjections: z
    .boolean()
    .default(true)
    .description('压缩区间自动避开每步会被重新注入的上下文（system-reminder、runtime context 快照等），把它们留在原处不折叠'),
  maxSpanNodes: z.number().default(400).description('单段允许压缩的最大节点数（多段模式下逐段计算）'),
  maxSegments: z.number().default(20).description('一次调用最多折叠几段（segments 数组的长度上限）'),
  minShadowTokens: z
    .number()
    .default(400)
    .description('被替换区间的体积下限（估算 token），低于它不划算'),
  requireShrink: z
    .boolean()
    .default(true)
    .description('要求摘要必须比被替换内容小，否则拒绝提交'),
  summaryLanguage: z.string().default('与对话相同的语言').description('摘要使用什么语言'),
  summaryStyle: z
    .string()
    .default('按主题分节；先写结论；保留文件路径、命令、失败现场原文；删掉过程性寒暄与重复确认')
    .description('摘要应该怎么写（会注入系统提示词）'),
  extraRules: z.string().default('').description('额外压缩硬规则（会注入系统提示词，可留空）'),
  injectPrompt: z.boolean().default(true).description('是否把策略注入系统提示词'),
  sectionOrder: z.number().default(60).description('系统提示词中的位置顺序'),
  promptThresholdPct: z
    .number()
    .default(70)
    .description('上下文占用达到该百分比时向模型注入压缩提示词；0 表示每次都注入'),
  triggerAction: z
    .union(['inject', 'fold', 'off'].map((value) => z.const(value)))
    .default('inject')
    .description('阈值触发后做什么：inject 只注入提示词让模型自己决定，fold 由面板直接折叠建议区间，off 只显示不提示'),
  injectTemplate: z
    .string()
    .default(
      '上下文占用约 {pct}%（约 {tokens} token），已过 {threshold}% 阈值：旧内容在稀释注意力、挤占任务窗口，'
        + '压缩是把过时上下文折叠成摘要、腾出空间给当前任务。下面是当前 surface 的完整节点清单，'
        + '压哪一段、压多少由你判断。',
    )
    .description('阈值触发时注入给模型的提示词（开场白）；占位符：{pct} {tokens} {threshold} {tool}。插件会在其后固定追加方法性的「压多少」行与完整节点清单，不会预切可压区间'),
  contextWindowTokens: z
    .number()
    .default(80000)
    .description('估算占用率用的上下文窗口大小（token）；与实际窗口不一致时按比例调整'),
  maxHintRanges: z.number().default(12).description('提示词里最多列多少个可压缩区间'),
});

// ---- 面板可改的设置（目前只有阈值）：存成 JSON，重启后仍然有效 -------------
const SETTINGS_FILE = path.join(
  process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh'),
  'context-compact.settings.json',
);

/** 读设置文件；不存在或坏了都当空对象。 */
function readSettings() {
  try {
    const parsed = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    return parsed !== null && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** 合并写入设置并返回整体。 */
function writeSettings(patch) {
  const merged = { ...readSettings(), ...patch };
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(merged, null, 2), 'utf8');
  return merged;
}

/** 阈值：面板改过就用面板的值，否则用 profile 里的配置。 */
function effectiveThreshold(cfg) {
  const override = Number(readSettings().promptThresholdPct);
  if (Number.isFinite(override) && override >= 1 && override <= 100) return override;
  return cfg.promptThresholdPct;
}

/** 阈值触发后的动作：面板改过就用面板的值。 */
function effectiveAction(cfg) {
  const saved = readSettings().triggerAction;
  if (saved === 'inject' || saved === 'fold' || saved === 'off') return saved;
  return cfg.triggerAction;
}

/** 注入文案：面板里改过（含清空）就以面板为准。 */
function effectiveTemplate(cfg) {
  const saved = readSettings().injectTemplate;
  if (typeof saved === 'string' && saved.trim().length > 0) return saved;
  return cfg.injectTemplate;
}

/** 读一个可选服务（不存在时返回 undefined，不抛）。 */
function optionalService(ctx, key) {
  if (ctx === undefined || ctx === null) return undefined;
  try {
    if (typeof ctx.get === 'function') {
      const viaGet = ctx.get(key);
      if (viaGet !== undefined && viaGet !== null) return viaGet;
    }
  } catch {
    // 服务未挂载时 get 可能抛，退回到属性访问
  }
  try {
    return ctx[key];
  } catch {
    return undefined;
  }
}

function textOfMessage(message) {
  if (message === null || message === undefined) return '';
  const content = message.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block) => (block && block.type === 'text' && typeof block.text === 'string' ? block.text : ''))
    .join(' ');
}

function clip(text, max) {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max)}…`;
}

function previewOf(session, seq) {
  let message;
  try {
    message = session.deriveEventMessage(session.eventAt(seq));
  } catch {
    return '';
  }
  return clip(textOfMessage(message), 160);
}

/** 纯文本为空（只有 tool_use / tool_result / 其它结构化块）时的回退：把消息序列化成可读文本。 */
function structuredTextOf(message, max = 20000) {
  if (message === null || message === undefined) return '';
  const seen = new WeakSet();
  let text;
  try {
    text = JSON.stringify(
      message,
      (key, value) => {
        if (typeof value === 'string') {
          if (/^data:[\w/+.-]+;base64,/.test(value)) return `[base64 数据，${value.length} 字符]`;
          return value.length > 4000 ? `${value.slice(0, 4000)}…（共 ${value.length} 字符）` : value;
        }
        if (typeof value === 'object' && value !== null) {
          if (seen.has(value)) return '[循环引用]';
          seen.add(value);
        }
        return value;
      },
      2,
    );
  } catch {
    return '';
  }
  return text.length <= max ? text : `${text.slice(0, max)}\n…（已截断，共 ${text.length} 字符）`;
}

/** 详情卡展开用：取节点完整文本，保留换行（不要用 clip，它会把换行压成空格）。 */
function fullTextOf(session, seq, max = 20000) {
  let message;
  try {
    message = session.deriveEventMessage(session.eventAt(seq));
  } catch {
    return '';
  }
  const raw = textOfMessage(message);
  // 纯文本通道为空时不要显示空白：结构化内容（工具调用、工具结果、附件）同样有信息量。
  if (raw.trim().length === 0) {
    const structured = structuredTextOf(message, max);
    return structured === ''
      ? '（该节点没有可展示的内容：消息为空。）'
      : `（该节点没有纯文本；以下是结构化内容）\n\n${structured}`;
  }
  return raw.length <= max ? raw : `${raw.slice(0, max)}\n…（已截断，共 ${raw.length} 字符）`;
}

function nodeKindOf(session, seq) {  try {
    return session.eventAt(seq).type;
  } catch {
    return 'unknown';
  }
}

/**
 * 按内容定位压缩区间：`from` 匹配起点节点、`to` 匹配终点节点，都搜节点全文（字面量匹配，空白折叠；`re:` 前缀才当正则）。
 * 从 surface 靠前的节点开始找，`to` 在起点之后找。匹配不到直接报错，不猜。
 * 这样调用方只需要写「从这条消息到那条消息」，不必知道 surface 的 seq 编号。
 */
/** 匹配用的规范化文本：折叠所有空白并去首尾，使模型从预览（空白已压平）里
 *  复制的片段能直接命中原文（原文里可能是换行/多空格）。 */
function normalizeMatchText(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

/** 去掉工具输出里的行号前缀（`1682: `、`12| `），保留其余内容。 */
function stripLineNumberPrefix(text) {
  return text.replace(/(^|\n)[ \t]*\d+[:|][ \t]?/g, '$1');
}

/**
 * 定位匹配的归一化阶梯：**严格级在先，只有在更严格的级一个都没命中时才降级**。
 * 这样模型从上一条注入清单的预览里抄片段（空白被压平）、或从源码里抄带行号的
 * 一行、或用了全角标点，都能命中；而正常书写时仍走最严格的一级，
 * 不会因为宽松规则把无关节点也命中。
 *
 * 每一级都提供 `test`（包含）与 `atStart`（节点开头命中）两个判定，
 * 后者用来识别「这段内容就是该节点的开头」——复述副本永远不在开头。
 */
function matchNormalizations() {
  return [
    {
      name: '原样（空白折叠）',
      build: (needle) => {
        const want = normalizeMatchText(needle);
        return {
          test: (raw) => normalizeMatchText(raw).includes(want),
          atStart: (raw) => normalizeMatchText(raw).startsWith(want),
        };
      },
    },
    {
      name: '忽略所有空白',
      build: (needle) => {
        const want = String(needle).replace(/\s+/g, '');
        return {
          test: (raw) => String(raw).replace(/\s+/g, '').includes(want),
          atStart: (raw) => String(raw).replace(/\s+/g, '').startsWith(want),
        };
      },
    },
    {
      name: '忽略行号前缀与空白',
      build: (needle) => {
        const want = stripLineNumberPrefix(String(needle)).replace(/\s+/g, '');
        return {
          test: (raw) => stripLineNumberPrefix(String(raw)).replace(/\s+/g, '').includes(want),
          atStart: (raw) => stripLineNumberPrefix(String(raw)).replace(/\s+/g, '').startsWith(want),
        };
      },
    },
    {
      name: '忽略全角半角与空白',
      build: (needle) => {
        const want = String(needle).normalize('NFKC').replace(/\s+/g, '');
        return {
          test: (raw) => String(raw).normalize('NFKC').replace(/\s+/g, '').includes(want),
          atStart: (raw) => String(raw).normalize('NFKC').replace(/\s+/g, '').startsWith(want),
        };
      },
    },
  ];
}

/**
 * 给某个节点生成「可以直接照抄」的定位片段：取它真实开头的第一行前 24 字，
 * 正则转义后加 `re:^`。只在定位失败的报错里给，把「猜锚」换成「抄锚」。
 */
function suggestAnchor(session, seq, maxLen = 24) {
  let raw = '';
  try {
    raw = fullTextOf(session, seq);
  } catch {
    return '';
  }
  const firstLine = String(raw).split('\n').map((line) => line.trim()).find((line) => line.length > 0);
  if (firstLine === undefined) return '';
  const head = firstLine.slice(0, maxLen);
  return `re:^${head.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`;
}

/**
 * 定位匹配池要跳过的节点（全部按事件元数据识别，不按内容识别）：
 *  1) 全部可再生注入节点——它们内嵌当时的节点清单，清单前缀就是节点开头；
 *  2) 本插件自己的工具步：tool/call(compact_context) + 配对 tool/result，
 *     以及紧随其后的 assistant 回复。
 * 第 2 条的后半段是关键：定位失败后，模型往往在回复正文里复述刚才用的
 * from/to 片段来解释失败，那条复述会变成新的命中源，并且随着每次失败继续累积。
 * 排除掉「自己的工具步 + 紧随的解释」，这条自我强化的链就断了。
 */
function locateExcludedSeqs(session, toolName) {
  const nodes = session.surface.nodes;
  const excluded = new Set(allRegenerableInjectionSeqs(session));
  const eventOf = (seq) => {
    try {
      return session.eventAt(seq);
    } catch {
      return undefined;
    }
  };
  for (let i = 0; i < nodes.length; i += 1) {
    const event = eventOf(nodes[i]);
    if (event === undefined || event.type !== 'tool/call') continue;
    if (event.data?.name !== toolName) continue;
    excluded.add(nodes[i]);
    let scanner = i + 1;
    // 配对结果紧跟在它的 tool/call 后面，中间不会插进别的工具事件。
    const paired = scanner < nodes.length ? eventOf(nodes[scanner]) : undefined;
    if (paired !== undefined && paired.type === 'tool/result') {
      excluded.add(nodes[scanner]);
      scanner += 1;
    }
    // 紧随其后的 assistant 回复：模型常在这里复述刚才的定位片段。
    for (; scanner < Math.min(nodes.length, i + 5); scanner += 1) {
      const next = eventOf(nodes[scanner]);
      if (next === undefined) continue;
      if (next.type === 'assistant/message') {
        excluded.add(nodes[scanner]);
        break;
      }
      if (next.type === 'tool/call') break;
    }
  }
  return excluded;
}

/** 节点的结构指纹：序号 + 事件类型 + 体积。**不含任何内容原文**——
 *  错误消息本身也会进入 surface，一旦回显片段，下一次定位就会同时命中
 *  「原节点」和「这条错误」，形成解不开的多命中。 */
function nodeFingerprint(session, seq) {
  const kind = (() => {
    try {
      return nodeKindOf(session, seq);
    } catch {
      return 'unknown';
    }
  })();
  const tokens = (() => {
    try {
      return roughTokens(fullTextOf(session, seq));
    } catch {
      return 0;
    }
  })();
  return `#${seq} [${kind}] 约 ${tokens} token`;
}

/**
 * 定位失败的统一出口：只报结构指纹与可执行动作。
 *
 * 契约提醒：报错里**不会回显你写的 from/to**，但会给出候选节点各自的
 * `re:^` 锚点——那是节点原文的开头，锚定后即使这段文字在别处被复述过，
 * 也不会再造成二次命中。
 */
function locateFailure(session, label, kind, hits, poolSize, context) {
  const ctx = context ?? {};
  const head = label === 'from'
    ? 'from（区间起点）'
    : 'to（区间终点，只在 from 命中的节点之后查找）';
  if (kind === 'miss') {
    const levels = Array.isArray(ctx.triedLevels) ? ctx.triedLevels : [];
    const tried = levels.length === 0
      ? ''
      : levels.length === 1 && levels[0] === 're:'
        ? 're: 正则对原文和它的折叠形式（去空白、去行号前缀）都试过，没有命中。'
        : `已按「${levels.join(' → ')}」逐级放宽，都没有命中。`;
    return new Error(
      `定位失败：${head} 没有匹配到任何节点。`
      + `${tried}当前可匹配节点 ${poolSize} 个`
      + '（已排除会被重新注入的上下文，以及最近的自有工具调用记录）。\n'
      + '字面量匹配是子串，空白/换行/行号前缀/全角差异都已自动容忍，不需要转义。\n'
      + '可执行的动作：\n'
      + '  1) 用 scan_context 看清真实节点，再从它的开头 12–24 字取片段（别抄注入清单里的预览）；\n'
      + '  2) 片段不要跨越节点边界，要落在同一个节点内部；\n'
      + '  3) 避开之前定位失败说明里出现过的短语——那些短语现在同时存在于多个节点里；\n'
      + '  4) 若这一端本来就不该由内容定位，试另一端的唯一片段，再取它附近的平衡切点。',
    );
  }
  const listed = hits.slice(0, 5).map((seq) => {
    const anchor = suggestAnchor(session, seq);
    return `  ${nodeFingerprint(session, seq)}${anchor ? `\n      可抄锚点 ${anchor}` : ''}`;
  }).join('\n');
  const scope = ctx.atStartOnly
    ? `（只统计「片段出现在该节点开头」的命中${ctx.allHitCount > hits.length ? `；包含片段的节点另有 ${ctx.allHitCount - hits.length} 个，是别处的复述` : ''}）`
    : '';
  return new Error(
    `定位失败：${head} 命中了 ${hits.length} 个节点${scope}，无法确定唯一位置。`
    + '压缩是破坏性操作，不会自动挑其中一个。\n'
    + `${listed}${hits.length > 5 ? `\n  …另有 ${hits.length - 5} 个` : ''}\n`
    + '可执行的动作：\n'
    + '  1) 直接照抄上面某个「可抄锚点」（已经是 re:^ 开头锚定的，最稳）；\n'
    + '  2) 或把片段加长到足以唯一；\n'
    + '  3) 若其中一条明显是助手自己在回复里复述的（会被标成 assistant/message），别选它；\n'
    + '  4) 用 scan_context 看清这些序号分别是什么，再从那里取片段。',
  );
}

/**
 * 按内容定位区间两端。
 *
 * 默认是**字面量**匹配（空白折叠后子串包含），不再把 from/to 当正则——
 * 模型不需要转义括号、星号、问号；想用正则时以 `re:` 开头显式声明。
 * 任一端命中多个节点时直接报错，只给结构指纹不给原文，
 * 也不默默取第一个（压缩是破坏性操作，选错区间比报错更糟）。
 */
function resolveLocate(session, from, to, options) {
  const opts = options ?? {};
  const nodes = session.surface.nodes;
  const excluded = opts.excluded instanceof Set
    ? opts.excluded
    : locateExcludedSeqs(session, opts.toolName);
  // 定位过程中的说明（降级匹配、开头优先），会并进结果的 warning。
  const notes = [];
  const readRawText = (seq) => {
    try {
      return fullTextOf(session, seq) ?? '';
    } catch {
      return '';
    }
  };
  const matcherOf = (pattern, label) => {
    if (typeof pattern !== 'string' || pattern.trim().length === 0) {
      throw new Error(`${label} 不能为空：给一段能匹配该端节点开头/中间的字面文本（空白、行号前缀差异会被自动容忍，不需要转义）`);
    }
    const useRegex = pattern.startsWith('re:');
    const source = useRegex ? pattern.slice(3) : pattern;
    if (useRegex) {
      // 显式写了正则就只走这一级：用户要的语义不该被自动放宽。
      let re;
      let anchored;
      try {
        re = new RegExp(source, 'i');
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`${label} 的 re: 正则无效：${JSON.stringify(source)}（${reason}）；也可以去掉 re: 直接给字面文本`);
      }
      try {
        anchored = new RegExp(`^(?:${source})`, 'i');
      } catch {
        anchored = re;
      }
      // 原文常以换行/空白开头，直接对原文跑 `^` 会落不到节点真正开头，
      // 所以先折叠成一行（顺便去掉行号前缀）再测；原文本身也试一遍，
      // 让模型写跨行正则（如 `a\s+b`）时仍然有效。
      const flatOf = (raw) => stripLineNumberPrefix(normalizeMatchText(raw));
      return {
        label,
        levels: [{
          name: 're:',
          test: (raw) => re.test(raw) || re.test(flatOf(raw)),
          atStart: (raw) => anchored.test(flatOf(raw)),
        }],
        // 命中片段长度：给「长度规则」兜底——太短的匹配说明模式不够挑剔。
        probe: (raw) => {
          const hit = re.exec(raw) ?? re.exec(flatOf(raw));
          return hit ? hit[0].length : null;
        },
      };
    }
    return {
      label,
      levels: matchNormalizations().map((level) => {
        const api = level.build(source);
        return { name: level.name, test: api.test, atStart: api.atStart };
      }),
    };
  };

  /**
   * 在一端找一个节点：由严到宽逐级匹配，第一级有命中的就用它。
   * 命中集里再按「片段是否落在节点开头」分层——复述副本永远在行中间，
   * 所以只有一个节点在开头命中时，那就是原文。多个仍报错，不猜。
   */
  const findEndpoint = (matcher, beginIndex) => {
    const tried = [];
    for (let li = 0; li < matcher.levels.length; li += 1) {
      const level = matcher.levels[li];
      const all = [];
      const atStart = [];
      for (let i = beginIndex; i < nodes.length; i += 1) {
        const seq = nodes[i];
        if (excluded.has(seq)) continue;
        const raw = readRawText(seq);
        if (!raw || !level.test(raw)) continue;
        all.push(seq);
        if (level.atStart(raw)) atStart.push(seq);
      }
      if (all.length === 0) {
        tried.push(level.name);
        continue;
      }
      const pool = atStart.length > 0 ? atStart : all;
      if (pool.length === 1) {
        if (li > 0) {
          notes.push(`${matcher.label} 在「${level.name}」这一级才匹配到 #${pool[0]}：原文与片段存在空白/行号/全角差异，已自动容忍`);
        }
        if (atStart.length === 1 && all.length > 1) {
          notes.push(`${matcher.label} 共含于 ${all.length} 个节点，只有 #${pool[0]} 的开头与片段一致（其余是别处的复述），已选它；写 re:^ 可省掉这条提示`);
        }
        const hitLen = typeof matcher.probe === 'function' ? matcher.probe(readRawText(pool[0])) : null;
        if (hitLen !== null && hitLen < 8) {
          notes.push(`${matcher.label} 命中的片段只有 ${hitLen} 个字符——太短的模式容易在别处误命中；下次把片段加长并带长度量词（如 re:^\\s*独特开头{12,}）`);
        }
        return { seq: pool[0], levelIndex: li };
      }
      throw locateFailure(session, matcher.label, 'ambiguous', pool, nodes.length - excluded.size, {
        levelName: level.name,
        atStartOnly: atStart.length > 0,
        allHitCount: all.length,
      });
    }
    throw locateFailure(session, matcher.label, 'miss', [], nodes.length - excluded.size, {
      triedLevels: tried,
    });
  };

  const matcherFrom = matcherOf(from, 'from');
  const matcherTo = matcherOf(to, 'to');
  const startHit = findEndpoint(matcherFrom, 0);
  const endHit = findEndpoint(matcherTo, nodes.indexOf(startHit.seq));
  return {
    start: startHit.seq,
    end: endHit.seq,
    matcherFrom,
    matcherTo,
    fromLevel: startHit.levelIndex,
    toLevel: endHit.levelIndex,
    excluded,
    notes,
  };
}

/**
 * 把已定位的两端收敛到「不劈开工具步」的最近安全切点：
 * 起点不均衡 → 往更早找（把整步包进区间，不会少压关键内容）；
 * 终点不均衡 → 往更早找（少压一段）。
 * 两个方向都只往更早走，绝不把区间扩到更晚的节点上，
 * 所以最坏结果是「压得比预期少」，而不是压坏别的步骤。
 */
function convergeSpan(session, start, end) {
  const nodes = session.surface.nodes;
  let startIdx = nodes.indexOf(start);
  let endIdx = nodes.indexOf(end);
  if (startIdx === -1) throw new Error(`定位到的起点 #${start} 不在当前 surface 上`);
  if (endIdx === -1) throw new Error(`定位到的终点 #${end} 不在当前 surface 上`);
  if (startIdx > endIdx) throw new Error(`起点 #${start} 在终点 #${end} 之后：from 要定位在 to 之前`);
  const notes = [];
  if (!toolPairingBalancedBefore(session, nodes[startIdx])) {
    let moved = -1;
    for (let i = startIdx - 1; i >= 0; i -= 1) {
      if (toolPairingBalancedBefore(session, nodes[i])) {
        moved = i;
        break;
      }
    }
    if (moved === -1) {
      throw new Error(
        `起点 #${start} 会把某个工具步劈开，往前也找不到安全切点；`
        + '请把 from 移到某个完整步骤开头的 assistant 消息或 user 消息上',
      );
    }
    notes.push(`起点 #${start} 会把工具步劈开，已前移到 #${nodes[moved]}`);
    startIdx = moved;
  }
  if (!toolPairingBalancedAfter(session, nodes[endIdx])) {
    let moved = -1;
    for (let i = endIdx - 1; i >= startIdx; i -= 1) {
      if (toolPairingBalancedAfter(session, nodes[i])) {
        moved = i;
        break;
      }
    }
    if (moved === -1) {
      throw new Error(
        `终点 #${end} 会把某个工具步劈开或该步还没结束，往前也找不到安全切点；`
        + '请把 to 移到这一步完全结束之后的节点内容上，或换一段更靠前的区间',
      );
    }
    notes.push(`终点 #${end} 会把工具步劈开或该步未结束，已收窄到 #${nodes[moved]}`);
    endIdx = moved;
  }
  return { start: nodes[startIdx], end: nodes[endIdx], startIdx, endIdx, notes };
}

/** 收敛后的区间复检：两端片段在区间内必须各自唯一，否则说明片段太宽泛。 */
function assertSpanUnambiguous(session, span, located) {
  const nodes = session.surface.nodes;
  // 注入容器里嵌着节点清单，区间内可能有它；复检时跳过，否则会误判「片段太宽泛」。
  const skip = located.excluded instanceof Set ? located.excluded : new Set();
  // 用定位当时实际生效的那一级复检：定位降级到「忽略空白」时，复检也该按同一口径，
  // 否则会用一个更严的级判出「0 命中」，把已经正确的区间误报成太宽泛。
  const levelOf = (matcher, index) => matcher.levels[Math.min(index ?? 0, matcher.levels.length - 1)];
  const checks = [
    ['from', levelOf(located.matcherFrom, located.fromLevel)],
    ['to', levelOf(located.matcherTo, located.toLevel)],
  ];
  for (const [label, level] of checks) {
    let hits = 0;
    for (let i = span.startIdx; i <= span.endIdx; i += 1) {
      const seq = nodes[i];
      if (skip.has(seq)) continue;
      let text = '';
      try {
        text = fullTextOf(session, seq) ?? '';
      } catch {
        text = '';
      }
      if (text && level.test(text)) hits += 1;
    }
    if (hits > 1) {
      throw new Error(
        `收敛后的区间里，${label} 片段又命中了 ${hits} 个节点（片段太宽泛）；`
        + `请换一段更独特的文本，或把 from/to 直接写在区间内部靠后的位置`,
      );
    }
  }
}

/**
 * 按内容定位 + 平衡收敛 + 唯一性复检，一次给出可直接提交的区间。
 * 调用方只需要 from/to，不需要知道 seq、也不需要自己处理工具配对。
 */
function locateSpan(session, from, to, options) {
  const located = resolveLocate(session, from, to, options);
  const span = convergeSpan(session, located.start, located.end);
  // 定位阶段的说明（自动降级、开头优先）同样要进 warning，别悄悄发生。
  span.notes = [...(located.notes ?? []), ...(span.notes ?? [])];
  assertSpanUnambiguous(session, span, located);
  return span;
}

/**
 * 每步会被 DSH 重新注入的上下文节点（system-reminder、runtime context 快照等）：
 * 折叠它们没有意义 —— 下一步同一段内容又会原样出现，历史里等于放了两份。
 * 压缩区间应当绕过它们、让它们留在原处；只有已经沉淀进 system prompt 头部
 * （稳定前缀）的才不再是「可再生」的，可以照常折叠。
 */
const REGENERABLE_INJECTION_PATTERNS = [
  ['system-reminder', /^<system-reminder>/i],
  ['runtime-context', /^Current runtime context\. This snapshot supersedes/i],
  // 压缩提示本身：每条都内嵌当时的完整节点清单，而清单的每条前缀就是节点开头。
  ['compact-hint', /^上下文占用约/],
];

/** 全部可再生注入节点（不只最新一条）。
 *  定位匹配池必须排除**全部**：历史上每条压缩提示里都嵌着当时的节点清单，
 *  拿清单里的前缀当 from/to，会在每一个注入消息里重复命中。 */
function allRegenerableInjectionSeqs(session) {
  const nodes = session.surface.nodes;
  const headSeq = protectedHeadSeq(session);
  const headIdx = headSeq === undefined ? -1 : nodes.indexOf(headSeq);
  const all = [];
  for (let i = 0; i < nodes.length; i += 1) {
    if (headIdx !== -1 && i <= headIdx) continue;
    const preview = previewOf(session, nodes[i]);
    for (const [, pattern] of REGENERABLE_INJECTION_PATTERNS) {
      if (pattern.test(preview)) {
        all.push(nodes[i]);
        break;
      }
    }
  }
  return all;
}

/** 每类可再生注入里「最新的一条」：只有它会在下一步被重新注入并取代旧快照。
 *  更早的同名注入已经被更新的取代，历史里留着只是过时内容，可以折叠。 */
function latestRegenerableInjectionSeqs(session) {
  const nodes = session.surface.nodes;
  const headSeq = protectedHeadSeq(session);
  const headIdx = headSeq === undefined ? -1 : nodes.indexOf(headSeq);
  const latest = new Map();
  for (let i = 0; i < nodes.length; i += 1) {
    if (headIdx !== -1 && i <= headIdx) continue;
    const preview = previewOf(session, nodes[i]);
    for (const [tag, pattern] of REGENERABLE_INJECTION_PATTERNS) {
      if (pattern.test(preview)) latest.set(tag, nodes[i]);
    }
  }
  return latest;
}

/** 返回可再生注入的标签（system-reminder / runtime-context）；不是则 undefined。 */
function regenerableInjectionTag(session, seq) {
  const nodes = session.surface.nodes;
  const index = nodes.indexOf(seq);
  if (index === -1) return undefined;
  const headSeq = protectedHeadSeq(session);
  if (headSeq !== undefined) {
    const headIdx = nodes.indexOf(headSeq);
    // 稳定前缀：位于 system prompt 头部或之前，已经沉淀，不再是「可再生」的。
    if (headIdx !== -1 && index <= headIdx) return undefined;
  }
  const preview = previewOf(session, seq);
  for (const [tag, pattern] of REGENERABLE_INJECTION_PATTERNS) {
    if (pattern.test(preview)) return tag;
  }
  return undefined;
}

/** 估算一段文本的 token（没有 meter 时的兜底）。 */
function roughTokens(text) {
  return Math.ceil(text.length / 3);
}

function messageTokens(meter, message, fallbackText) {
  if (meter && typeof meter.estimateMessage === 'function') {
    try {
      return meter.estimateMessage(message);
    } catch {
      /* 落到兜底 */
    }
  }
  return roughTokens(fallbackText);
}

/** surface 节点体积表：[{seq, kind, tokens, heuristicTokens}] */
function measureNodes(meter, session) {
  let nodes;
  if (meter && typeof meter.measure === 'function') {
    try {
      const measurement = meter.measure(session);
      if (measurement && Array.isArray(measurement.nodes)) nodes = measurement.nodes;
    } catch {
      /* 落到兜底 */
    }
  }
  if (nodes === undefined) {
    nodes = session.surface.nodes.map((seq) => {
      const preview = previewOf(session, seq);
      return { seq, tokens: roughTokens(preview), heuristicTokens: roughTokens(preview) };
    });
  }
  // kind 供注入清单标注节点类型（u/a/t/s/d）；meter 的节点表可能不带，从事件补。
  return nodes.map((node) => {
    if (node.kind !== undefined) return node;
    let kind;
    try {
      kind = session.eventAt(node.seq)?.type;
    } catch {
      /* 越界则留空，清单显示 ? */
    }
    return { ...node, kind };
  });
}

/** 当前 protected system head 的 seq：格式层禁止它被折叠。
 *  首个 system/message 成为头部；之后若有 system/message 在原位替换头部
 *  （surfaceOp replace startSeq..endSeq 恰好等于当前头部），头部会前移到该事件。 */
function protectedHeadSeq(session) {
  let head;
  for (let seq = 0; seq < session.seq; seq += 1) {
    const event = session.eventAt(seq);
    if (event.type !== 'system/message') continue;
    const op = event.surfaceOp;
    if (op === undefined || op === 'append') {
      if (head === undefined) head = event.seq;
    } else if (op.startSeq === head && op.endSeq === head) {
      head = event.seq;
    }
  }
  return head;
}

/**
 * 区间不得包含 protected system head。
 * 会话读取器对此有硬断言（compaction cannot shadow the protected system head），
 * 一旦违反整份历史就无法加载，所以必须在任何事件落盘之前拒绝。
 */
function assertHeadExcluded(session, seqs, start) {
  const headSeq = protectedHeadSeq(session);
  if (headSeq !== undefined && seqs.includes(headSeq)) {
    throw new Error(
      `区间起点 #${start} 把系统提示词头部（#${headSeq}）也框进了区间；压缩必须从头部之后开始`,
    );
  }
}

/** 区间的 tool-call/result 配对必须两端都平衡，否则会把一步劈开。 */
function validateSpan(session, start, end) {
  const nodes = session.surface.nodes;
  const startIdx = nodes.indexOf(start);
  const endIdx = nodes.indexOf(end);
  if (startIdx === -1) throw new Error(`定位到的起点 #${start} 不在当前 surface 上`);
  if (endIdx === -1) throw new Error(`end seq ${end} 不在当前 surface 上`);
  if (startIdx > endIdx) {
    throw new Error(`起点 #${start}（位置 ${startIdx}）在终点 #${end}（位置 ${endIdx}）之后`);
  }
  assertHeadExcluded(session, nodes.slice(startIdx, endIdx + 1), start);
  if (!toolPairingBalancedBefore(session, nodes[startIdx])) {
    throw new Error(
      `起点 #${start} 不是平衡边界：会把某一步的 tool-call 与结果劈开。`
      + '请把 from 换成更靠后、作为完整步骤开头的节点内容（例如该步之后的 assistant 消息或 user 消息）。',
    );
  }
  if (!toolPairingBalancedAfter(session, nodes[endIdx])) {
    throw new Error(
      `end seq ${end} 不是平衡边界：会把某一步劈开，或该步尚未结束。`
      + '请把 to 换成这一步完全结束之后的节点内容（通常是下一条 assistant 消息或 user 消息），或换一段更靠前的区间。',
    );
  }
  return {
    start,
    end,
    startIdx,
    endIdx,
    shadowedSeqs: nodes.slice(startIdx, endIdx + 1),
  };
}

/**
 * 解析多段参数：给了 `segments` 就是多段模式，返回 [{from, to, summary}]；
 * 没给返回 undefined（走单段）。两种写法不混用，混了就报错而不是猜。
 */
function parseSegmentArgs(a) {
  const raw = a.segments;
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw)) throw new Error('segments 必须是数组：[{from, to, summary}, …]');
  if (raw.length === 0) throw new Error('segments 不能是空数组：多段压缩至少给一段');
  if (a.from !== undefined || a.to !== undefined || a.summary !== undefined) {
    throw new Error('segments 与单段参数（from/to/summary）二选一');
  }
  return raw.map((item, index) => {
    const at = `segments[${index}]`;
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`${at} 必须是 {from, to, summary}`);
    }
    const summary = typeof item.summary === 'string' ? item.summary.trim() : '';
    if (summary.length === 0) throw new Error(`${at}.summary 不能为空：这一段的检查点内容就是你写的摘要`);
    if (item.from === undefined || item.to === undefined) {
      throw new Error(`${at} 需要 from 和 to：按内容定位区间两端（字面文本，空白折叠）`);
    }
    if (item.start !== undefined || item.end !== undefined) {
      throw new Error(`${at} 不再支持 start/end：用 from/to 按内容定位`);
    }
    return { from: String(item.from), to: String(item.to), summary };
  });
}

/** 多段模式的结果：逐段明细 + 合计。 */
function aggregateFolds(results, dryRun, requestedSpans) {
  const segments = results.map((result, index) => {
    const requested = requestedSpans === undefined ? undefined : requestedSpans[index];
    return {
      index,
      startSeq: dryRun && requested !== undefined ? requested.start : result.startSeq,
      endSeq: dryRun && requested !== undefined ? requested.end : result.endSeq,
      startIndex: result.startIndex,
      endIndex: result.endIndex,
      replacedNodes: result.replacedNodes,
      shadowedTokens: result.shadowedTokens,
      summaryTokens: result.summaryTokens,
      savedTokens: result.savedTokens,
      compactionId: result.compactionId,
      warning: result.warning,
    };
  });
  const total = (pick) => segments.reduce((sum, item) => sum + (Number(pick(item)) || 0), 0);
  return {
    ok: true,
    dryRun,
    multi: true,
    segmentCount: segments.length,
    totalShadowedTokens: total((item) => item.shadowedTokens),
    totalSummaryTokens: total((item) => item.summaryTokens),
    totalSavedTokens: total((item) => item.savedTokens),
    compactionIds: segments.map((item) => item.compactionId).filter((id) => typeof id === 'string' && id.length > 0),
    segments,
    warning: segments
      .map((item) => item.warning)
      .filter((text) => typeof text === 'string' && text.length > 0)
      .join('；'),
  };
}

/** 当前是否已有另一个压缩事务占着锁；同时读出当前打开的轮次号。 */
function inspectEntryState(session) {
  let openTurn = null;
  let openTurnKnown = false;
  let unmatchedCompactionStart;
  let compactionKnown = false;
  let latestEndSeedSeq;
  for (let seq = session.seq - 1; seq >= 0; seq -= 1) {
    const event = session.eventAt(seq);
    if (latestEndSeedSeq === undefined && event.type === 'session/end-seed') latestEndSeedSeq = event.seq;
    if (!compactionKnown) {
      if (event.type === 'compaction/start') {
        unmatchedCompactionStart = event;
        compactionKnown = true;
      } else if (event.type === 'compaction/end') {
        compactionKnown = true;
      }
    }
    if (!openTurnKnown) {
      if (event.type === 'turn/start') {
        openTurn = event.data.turn;
        openTurnKnown = true;
      } else if (event.type === 'turn/end') {
        openTurnKnown = true;
      }
    }
    if (openTurnKnown && compactionKnown && latestEndSeedSeq !== undefined) break;
  }
  if (
    unmatchedCompactionStart !== undefined &&
    !(latestEndSeedSeq !== undefined && latestEndSeedSeq > unmatchedCompactionStart.seq)
  ) {
    throw new Error('另一次压缩正在进行中（会话压缩锁已被占用），请稍后再试');
  }
  return { openTurn };
}

/** 当前上下文占用估算：{tokens, ratio}。拿不到 meter 时按 surface 粗估。 */
function measurePressure(meter, session, cfg) {
  const window = cfg.contextWindowTokens > 0 ? cfg.contextWindowTokens : 80000;
  let tokens = 0;
  if (meter && typeof meter.measure === 'function') {
    try {
      const measurement = meter.measure(session);
      if (measurement && typeof measurement.totalTokens === 'number') tokens = measurement.totalTokens;
    } catch {
      /* 落到兜底 */
    }
  }
  if (tokens === 0) {
    tokens = session.surface.nodes
      .map((seq) => roughTokens(previewOf(session, seq)))
      .reduce((total, value) => total + value, 0);
  }
  return { tokens, ratio: tokens / window };
}

/**
 * 注入/面板共用的提示文本：模板 + 方法性的「压多少」+ 完整节点清单。
 * 不给预切的 [start, end] 区间——可压性是策略判断，不是硬编码规则；
 * 模板里的 {pct} {tokens} {threshold} 由调用方传入，未传则保留原样。
 */
function buildHintText(session, cfg, meter, pct, tokens, threshold) {
  const template = effectiveTemplate(cfg)
    .replaceAll('{pct}', pct === null || pct === undefined ? '{pct}' : String(pct))
    .replaceAll('{tokens}', tokens === null || tokens === undefined ? '{tokens}' : String(tokens))
    .replaceAll('{threshold}', threshold === null || threshold === undefined ? '{threshold}' : String(threshold));
  let measured = [];
  try {
    measured = measureNodes(meter, session);
  } catch {
    measured = [];
  }
  const totalTokens = measured.reduce((sum, node) => sum + (node.tokens ?? 0), 0);
  const keepFrom = Math.max(0, measured.length - Math.max(0, cfg.keepTailNodes));
  const KIND_ABBR = {
    'user/message': 'u',
    'assistant/message': 'a',
    'tool/result': 't',
    'system/message': 's',
    'developer/message': 'd',
  };
  const preview = (seq) => {
    try {
      return previewOf(session, seq).replace(/\s+/g, ' ').slice(0, 24);
    } catch {
      return '';
    }
  };
  const atoms = measured.map(
    (node, index) =>
      `${KIND_ABBR[node.kind] ?? '?'}${node.tokens ?? 0}${index >= keepFrom ? '!' : ''} ${preview(node.seq)}`,
  );
  const rows = [];
  let line = '';
  for (const atom of atoms) {
    if (line.length + atom.length + 1 > 150) {
      rows.push(line);
      line = atom;
    } else {
      line = line.length === 0 ? atom : `${line} ${atom}`;
    }
  }
  if (line.length > 0) rows.push(line);
  return [
    template,
    `压多少：先看节点清单里的 token 分布，挑最旧、最大、已被后续信息取代的连续段；同一主题能一次压掉的别拆成多次小折；压完看占用，仍在阈值之上就继续下一段，回到阈值下方就停——不必追求某个固定比例。优先压：大块 tool 输出（源码、目录树、长日志）、已完成任务的探索与试错、重复确认；必须留：当前任务的决定、文件路径、命令、报错原文、用户明确要求。`,
    `节点清单（类型/token + 内容开头；u=user a=assistant t=tool/result s=system d=developer；! =尾部保留）：共 ${measured.length} 个，合计约 ${totalTokens} token。压哪一段、压多少由你判断：挑最旧、最大、已被后续信息取代的连续区间，按内容里独特的一段写 from/to（字面文本、空白折叠、不用转义）。首选复杂正则锚开头：re:^\\s*独特开头 后接长度量词（如 {12,} 或 [\\s\\S]{12,80}），把匹配长度钉死——短片段必然多命中，别用 .* 或 .+（跨节点贪心），跨行用 [\\s\\S]，可用 (?:a|b) 分支；节点开头最不易重复，副本都在行中间，锚定后不误命中。两端若落在工具步中间会自动收敛到最近的安全切点；同一主题能一次压掉的别拆成多次小折，多段用 segments 一次压掉。`,
    ...rows,
  ].join('\n');
}

/**
 * 当前 surface 上可以直接压缩的区间：两端都对齐工具配对，排除尾部保留节点，
 * 每段不超过 maxSpanNodes，且不小于 minShadowTokens。
 */
function compressibleRanges(session, cfg, meter, options) {
  // cap 只限制「列给模型看的提示词」：面板要的是全量，否则没被列进来的地方会被误标成不可压。
  const cap = options !== undefined && typeof options.cap === 'number' ? options.cap : Math.max(1, cfg.maxHintRanges);
  const nodes = session.surface.nodes;
  // 数组顺序不保证按 seq 递增：折叠后检查点会被插回被替换区间原来的位置，
  // 于是后面的节点携带比它更旧的 seq。而 fold 落盘用的是按 seq 的区间
  // （surfaceOp replace startSeq..endSeq），所以这里先按 seq 排序再切，
  // 否则会切出 start > end 的倒置区间，交给宿主必然失败。
  const seqs = [...nodes].sort((a, b) => a - b);
  const keep = Math.max(0, cfg.keepTailNodes);
  const limit = seqs.length - keep; // 尾部保留节点（seq 最新的那些）不参与
  const measured = measureNodes(meter, session);
  const priceOf = (seq) => measured.find((node) => node.seq === seq)?.heuristicTokens ?? 0;
  // 受保护的 system 头部永远不能进区间：压缩从它之后一格开始
  const headSeq = protectedHeadSeq(session);
  const headIdx = headSeq === undefined ? -1 : seqs.indexOf(headSeq);
  const floor = headIdx + 1;

  const ranges = [];
  let startIdx = -1;
  let tokens = 0;
  // 只有「每类注入里最新的一条」才是下一步会被重新注入的；更早的旧快照可折叠。
  const regenerableSeqSet = cfg.protectRegenerableInjections
    ? new Set([...latestRegenerableInjectionSeqs(session).values()])
    : new Set();
  const regenerable = (seq) => regenerableSeqSet.has(seq);
  for (let i = floor; i < limit; i += 1) {
    // 可再生注入节点做屏障：区间在它前面闭合、从它后面重新开始，
    // 它自己留在原处不被折叠（下一步 DSH 会把它重新注入，折了历史里就是两份）。
    if (regenerable(seqs[i])) {
      if (
        startIdx !== -1
        && i > startIdx
        && tokens >= cfg.minShadowTokens
        && toolPairingBalancedAfter(session, seqs[i - 1])
      ) {
        ranges.push({
          start: seqs[startIdx],
          end: seqs[i - 1],
          fromIndex: startIdx,
          toIndex: i - 1,
          nodes: i - startIdx,
          tokens,
        });
      }
      startIdx = -1;
      tokens = 0;
      continue;
    }
    if (startIdx === -1) {
      if (!toolPairingBalancedBefore(session, seqs[i])) continue;
      startIdx = i;
      tokens = 0;
    }
    tokens += priceOf(seqs[i]);
    const span = i - startIdx + 1;
    const closeable = toolPairingBalancedAfter(session, seqs[i]);
    if (!closeable) continue;
    const mustClose = span >= cfg.maxSpanNodes || i === limit - 1;
    const bigEnough = tokens >= cfg.minShadowTokens;
    if (!bigEnough && !mustClose) continue;
    if (bigEnough) ranges.push({ start: seqs[startIdx], end: seqs[i], fromIndex: startIdx, toIndex: i, nodes: span, tokens });
    startIdx = -1;
    tokens = 0;
  }
  return Number.isFinite(cap) ? ranges.slice(0, cap) : ranges;
}

/**
 * 尾部保留按 seq 算：surface 数组顺序会把折叠出来的检查点插回它原来的旧位置，
 * 拿数组下标当「最新」会把中间的旧节点误标成保留、把真正最新的漏掉。
 */
function keepSeqsOf(seqs, keep) {
  const n = Math.max(0, Math.floor(Number(keep) || 0));
  if (n === 0) return new Set();
  const sorted = [...seqs].sort((a, b) => a - b);
  return new Set(sorted.slice(Math.max(0, sorted.length - n)));
}

/** 面板首推的区间：省得最多的那一段（并列时取靠前的）。 */
function pickRecommended(ranges) {
  let best;
  for (const range of ranges) {
    if (best === undefined || range.tokens > best.tokens) best = range;
  }
  return best === undefined
    ? { start: 0, end: 0, tokens: 0 }
    : { start: best.start, end: best.end, tokens: best.tokens };
}

function render(args, value) {
  return [{ type: 'text', text: JSON.stringify(value, null, 2) }];
}

function frameSummary(summaryText, options) {
  // 前言只认一份：surface 上已有活着的检查点（会把旧前言压掉的合并不算）时不再重复注入，
  // 直接给摘要标签——同一句「这是一份由压缩工具生成的检查点…」在上下文里出现一次就够。
  const banner = options?.skipPreamble === true
    ? ''
    : options?.continuation === true
      ? CHECKPOINT_CONTINUATION
      : CHECKPOINT_PREAMBLE;
  const head = banner === '' ? SUMMARY_OPEN_TAG : `${banner}\n\n${SUMMARY_OPEN_TAG}`;
  return [
    { type: 'text', text: head },
    { type: 'text', text: summaryText },
    { type: 'text', text: SUMMARY_CLOSE_TAG },
  ];
}

/**
 * 注入去重：surface 上是否还有「不会被这次压缩替换掉」的检查点消息。
 * 有则新检查点省略前言那句「这是一份由压缩工具生成的检查点…」，
 * 避免同一句声明随每次折叠在上下文里重复出现。
 */
function hasLiveCheckpoint(session, excludeSeqs) {
  const excluded = excludeSeqs instanceof Set ? excludeSeqs : new Set(excludeSeqs ?? []);
  for (const seq of session.surface.nodes) {
    if (excluded.has(seq)) continue;
    let message;
    try {
      message = session.deriveEventMessage(session.eventAt(seq));
    } catch {
      continue;
    }
    const text = textOfMessage(message).trim();
    if (text.startsWith(CHECKPOINT_PREAMBLE) || text.startsWith(CHECKPOINT_CONTINUATION)) return true;
  }
  return false;
}

/** 这个节点是不是我们自己折出来的检查点；是的话取出壳里面的正文。 */
function checkpointBodyOf(session, seq) {
  let message;
  try {
    message = session.deriveEventMessage(session.eventAt(seq));
  } catch {
    return undefined;
  }
  const text = textOfMessage(message).trim();
  const prefix = text.startsWith(CHECKPOINT_PREAMBLE)
    ? CHECKPOINT_PREAMBLE
    : text.startsWith(CHECKPOINT_CONTINUATION)
      ? CHECKPOINT_CONTINUATION
      : text.startsWith(SUMMARY_OPEN_TAG)
        ? ''
        : undefined;
  if (prefix === undefined) return undefined;
  const open = text.indexOf(SUMMARY_OPEN_TAG);
  const close = text.lastIndexOf(SUMMARY_CLOSE_TAG);
  const body = open >= 0 && close > open
    ? text.slice(open + SUMMARY_OPEN_TAG.length, close)
    : text.slice(prefix.length);
  return { seq, body: body.trim() };
}

/**
 * 合并复用：折叠区间两端紧邻的旧检查点，直接并进来而不是再套一层壳。
 *
 * 每折一次都留一句「这是一份由压缩工具生成的检查点…」，相邻两次折叠就变成两层
 * 前言套娃：既白花 token，又让模型从头读两遍规则。这里把旧检查点的正文原样接在
 * 新摘要前面，整段只保留一个壳。位置顺序合法即可（surfaceOp 按位置定位，不要求
 * seq 数值递增），所以旧检查点 seq 比后续节点大也能并进来。
 */
function absorbAdjacentCheckpoints(session, start, end, maxNodes) {
  const nodes = session.surface.nodes;
  let lo = nodes.indexOf(start);
  let hi = nodes.indexOf(end);
  if (lo === -1 || hi === -1 || lo > hi) return { start, end, bodies: [] };
  const bodies = [];
  for (;;) {
    const before = lo > 0 ? checkpointBodyOf(session, nodes[lo - 1]) : undefined;
    if (before !== undefined) {
      bodies.unshift(before.body);
      lo -= 1;
      continue;
    }
    const after = hi + 1 < nodes.length ? checkpointBodyOf(session, nodes[hi + 1]) : undefined;
    if (after !== undefined) {
      bodies.push(after.body);
      hi += 1;
      continue;
    }
    break;
  }
  if (bodies.length === 0) return { start, end, bodies: [] };
  if (hi - lo + 1 > maxNodes) return { start, end, bodies: [] };
  const mergedStart = nodes[lo];
  const mergedEnd = nodes[hi];
  try {
    validateSpan(session, mergedStart, mergedEnd);
  } catch {
    return { start, end, bodies: [] };
  }
  return { start: mergedStart, end: mergedEnd, bodies };
}

export function apply(ctx, config) {
  const cfg = { ...config };
  if (!cfg.enabled) return;

  // tokenMeter 可能比本插件晚注册：apply 时取一次会永久拿到 undefined。
  // 改为每次使用时惰性解析，并缓存最近一次成功拿到的实例。
  let meterCache;
  const meterOf = () => {
    const live = optionalService(ctx, 'tokenMeter');
    if (live !== undefined && live !== null) {
      meterCache = live;
      return live;
    }
    return meterCache;
  };

  // ---- 工具 1：扫描 surface ----------------------------------------------
  ctx.tools.register({
    name: cfg.scanToolName,
    description:
      '列出当前会话 surface 上的每个节点：seq、事件类型、估算 token 体积、内容预览。' +
      '压缩上下文前先用它挑出一段可折叠的区间，按内容里独特的一段写 from/to 交给 compact_context（字面量匹配，空白折叠，不用转义；from 匹配起点、to 匹配终点）。' +
      '能压就多压：优先一次把多段写成 segments 一起传进去，而不是一段一段来。' +
      '工具调用与工具结果必须成对落在区间内，否则压缩会被拒绝。',
    parameters: {
      type: 'object',
      properties: {
        offset: { type: 'integer', description: '从第几个可见节点开始列（默认 0）' },
        limit: { type: 'integer', description: '最多列多少个节点（默认 40）' },
        previewChars: { type: 'integer', description: '每个节点预览多少字符（默认 100）' },
      },
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          totalTokens: { type: 'number' },
          nodeCount: { type: 'number' },
          recommendedStart: { type: 'integer', description: '推荐区间起点（仅展示用，压缩请用 from/to）；0 表示当前没有可压缩区间' },
          recommendedEnd: { type: 'integer', description: '推荐区间终点（仅展示用，压缩请用 from/to）；0 表示当前没有可压缩区间' },
          nodes: { type: 'array', items: { type: 'object', additionalProperties: true } },
          compressible: { type: 'array', items: { type: 'object', additionalProperties: true } },
        },
        additionalProperties: true,
      },
      render,
    },
    async execute(args, exec) {
      const agent = exec.agent;
      if (agent === undefined) throw new Error('没有可用的会话上下文（agent 缺失）');
      const session = agent.session;
      const a = args ?? {};
      const offset = Math.max(0, Number(a.offset ?? 0));
      const limit = Math.max(1, Math.min(400, Number(a.limit ?? 40)));
      const previewChars = Math.max(0, Math.min(1000, Number(a.previewChars ?? 100)));
      const meter = meterOf();
      const measured = measureNodes(meter, session);
      const nodes = session.surface.nodes;
      const keep = Math.max(0, cfg.keepTailNodes);
      const keepSet = keepSeqsOf(nodes, keep);
      const rows = [];
      let totalTokens = 0;
      for (let i = 0; i < nodes.length; i += 1) {
        const seq = nodes[i];
        const m = measured.find((node) => node.seq === seq);
        const tokens = m ? (m.tokens ?? m.heuristicTokens ?? 0) : 0;
        totalTokens += tokens;
        if (i < offset || i >= offset + limit) continue;
        rows.push({
          index: i,
          seq,
          kind: nodeKindOf(session, seq),
          tokens,
          keep: keepSet.has(seq),
          preview: previewChars === 0 ? '' : clip(previewOf(session, seq), previewChars),
        });
      }
      const candidateEnd = nodes.length - 1 - keep;
      return {
        nodeCount: nodes.length,
        totalTokens,
        keepTailNodes: keep,
        recommendedStart: nodes.length > keep + 1 ? nodes[0] : 0,
        recommendedEnd: candidateEnd > 0 ? nodes[candidateEnd] : 0,
        compressible: compressibleRanges(session, cfg, meter),
        nodes: rows,
      };
    },
  });

  // ---- 工具 2：按区间压缩，摘要由模型直接写 --------------------------------
  ctx.tools.register({
    name: cfg.toolName,
    description:
      '把 surface 上的一段或几段区间各替换成一个检查点：你写的 summary 就是该段替换后保留的全部内容，被替换的节点从此不再进入上下文。' +
      '单段用 from/to/summary 按内容定位；多段用 segments: [{from, to, summary}, …]，一次调用把多段一起折掉，不用反复调用。' +
      'from 匹配起点节点全文、to 匹配终点节点全文，给一段能唯一命中该节点的独特文本即可（文件名、命令、报错原文）；字面量匹配不需要转义，空白/换行/行号前缀/全角半角差异会被自动容忍（由严到宽逐级放宽，只有上一级零命中才降级）；并且若片段恰好落在唯一一个节点的开头，会优先选它（复述副本永不在开头），该判断会写进 warning。要从节点开头锚定就写 re: 前缀，并自己吸收原文开头的换行/缩进。提高命中率靠复杂正则：re:^\\s*独特开头 后接长度量词（{12,}、[\\s\\S]{12,80}），别用 .* / .+（跨节点贪心），跨行用 [\\s\\S]，可用 (?:a|b) 分支。host 会把原文和「折叠成一行、去掉行号前缀」的文本各试一次，但那只是兜底，别依赖它。' +
      '规则：①每段两端必须是平衡边界；②摘要必须明显短于被替换内容；③区间里可以包含之前生成的检查点（可以再次压缩）；' +
      '④当前轮次也可以压缩（只要区间结束于一个已闭合的步骤）；⑤压缩后你自己的摘要不能引用被删掉的原话，只保留结论、路径、命令与失败现场。',
    parameters: {
      type: 'object',
      properties: {
        from: { type: 'string', description: '单段模式：定位起点节点。写一段能唯一命中该节点内容的话即可，空白/行号/全角差异会被自动容忍，不需要转义；片段若落在某节点开头会优先选它。也可写复杂正则显式锚定节点开头：re:^\\s*独特开头 后接长度量词（如 {12,}、[\\s\\S]{12,80}），把匹配长度钉死，\\s* 吸收原文开头的换行/缩进；别用 .* / .+（跨节点贪心），跨行用 [\\s\\S]，可用 (?:a|b) 分支（注入清单与助手复述的副本都落在行中间，锚定后不会误命中）。多命中会报错并列候选，不自动选' },
        to: { type: 'string', description: '单段模式：定位终点节点，只在 from 命中的节点之后查找。写法同 from：字面文本或 re:^片段，须唯一命中' },
        summary: { type: 'string', description: '单段模式：检查点正文，替代被压缩区间的全部内容' },
        segments: {
          type: 'array',
          description: '多段模式：一次调用折多段，每段自带 from/to 加 summary；与单段参数二选一',
          items: {
            type: 'object',
            properties: {
              from: { type: 'string', description: '这一段的起点：字面文本即可（空白/行号/全角差异自动容忍），或用复杂正则 re:^\\s*独特开头 并带长度量词（如 {12,}）显式锚定、钉死匹配长度' },
              to: { type: 'string', description: '这一段的终点：写法同 from，须唯一命中' },
              summary: { type: 'string', description: '这一段的检查点正文' },
            },
            required: ['summary'],
            additionalProperties: false,
          },
        },
        sourceCommandId: { type: 'string', description: '可选，发起这次压缩的命令 id' },
        dryRun: { type: 'boolean', description: '只校验并回报体积，不真正写入' },
      },
      required: [],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          dryRun: { type: 'boolean' },
          compactionId: { type: 'string', description: '这次压缩的事务 id；dryRun 时为空串' },
          startSeq: { type: 'integer', description: '实际替换区间起点的 seq；dryRun 时为 0。seq 是节点创建号，不代表对话顺序，看区间请用 startIndex/endIndex' },
          endSeq: { type: 'integer', description: '实际替换区间终点的 seq；dryRun 时为 0' },
          startIndex: { type: 'integer', description: '起点在 surface 上的位置（0 基），与 endIndex 一起才是区间的真实顺序' },
          endIndex: { type: 'integer', description: '终点在 surface 上的位置；startIndex ≤ endIndex' },
          replacedNodes: { type: 'number' },
          shadowedTokens: { type: 'number' },
          summaryTokens: { type: 'number' },
          savedTokens: { type: 'number' },
          warning: { type: 'string', description: '没有告警时为空串' },
          multi: { type: 'boolean', description: '是否多段模式（segments）' },
          segmentCount: { type: 'number', description: '多段模式下实际折叠的段数' },
          totalShadowedTokens: { type: 'number' },
          totalSummaryTokens: { type: 'number' },
          totalSavedTokens: { type: 'number' },
          compactionIds: { type: 'array', items: { type: 'string' } },
          segments: {
            type: 'array',
            description: '多段模式下每段的结果',
            items: { type: 'object', additionalProperties: true },
          },
        },
        additionalProperties: true,
      },
      render,
    },
    async execute(args, exec) {
      const agent = exec.agent;
      if (agent === undefined) throw new Error('没有可用的会话上下文（agent 缺失）');
      const session = agent.session;
      const a = args ?? {};
      const common = {
        dryRun: a.dryRun === true,
        sourceCommandId: a.sourceCommandId,
        provider: 'context-compact',
        model: 'model-authored',
      };
      const batch = parseSegmentArgs(a);
      if (batch !== undefined) return performFoldMany(session, batch, common);

      const summaryText = typeof a.summary === 'string' ? a.summary.trim() : '';
      if (summaryText.length === 0) throw new Error('summary 不能为空：检查点的全部内容就是你写的这段摘要');
      if (a.from === undefined || a.to === undefined) {
        throw new Error('from 与 to 要一起给：from 定位区间起点、to 定位终点，按字面文本匹配节点全文（空白折叠），要正则写 re: 前缀；要压多段请用 segments');
      }
      const span = locateSpan(session, a.from, a.to, { toolName: cfg.toolName });

      return performFold(session, span.start, span.end, {
        ...common,
        summary: summaryText,
        locateNotes: span.notes,
      });
    },
  });

  /**
   * 显式区间压到「每步会自动重新注入」的节点时，自动把 end 收回到它之前最近的平衡边界：
   * 折了它，下一步 DSH 又会原样注入，历史里等于两份。start 本身就是注入节点时没法
   * 自动处理，直接报错让调用方挪起点。
   */
  function shrinkPastRegenerableInjection(session, start, end) {
    const nodes = session.surface.nodes;
    const lo = nodes.indexOf(start);
    const hi = nodes.indexOf(end);
    if (lo === -1 || hi === -1 || lo > hi) return { start, end };
    // 只绕开「每类注入里最新的一条」；更早的旧注入快照已被取代，可以照常折叠。
    const protectedSeqSet = new Set([...latestRegenerableInjectionSeqs(session).values()]);
    let cutIdx = -1;
    for (let i = lo; i <= hi; i += 1) {
      if (protectedSeqSet.has(nodes[i])) {
        cutIdx = i;
        break;
      }
    }
    if (cutIdx === -1) return { start, end };
    if (cutIdx === lo) {
      throw new Error(
        `区间起点 #${nodes[lo]} 本身就是会被自动重新注入的上下文（${regenerableInjectionTag(session, nodes[lo])}）；`
        + '请把 from 定位到它后面，或把 to 定位到它之前',
      );
    }
    for (let i = cutIdx - 1; i > lo; i -= 1) {
      if (toolPairingBalancedAfter(session, nodes[i])) return { start, end: nodes[i] };
    }
    return { start, end: nodes[lo] };
  }

  // ---- 折叠核心：工具与面板共用同一套事务 ----------------------------------
  function performFold(session, start, end, options) {
    const opts = options ?? {};
    // 两端紧邻旧检查点时先并进来，再写新摘要：整段只留一个壳。
    const merged = absorbAdjacentCheckpoints(session, start, end, cfg.maxSpanNodes);
    start = merged.start;
    end = merged.end;
    const summaryText = merged.bodies.length === 0 ? opts.summary : [...merged.bodies, opts.summary].join('\n\n');
    // 摘要缺失会让 frameSummary 生成 text: undefined 的块，直到 append 时才报
    // 「non-JSON-serializable data」这种看不懂的错；在这里先挡住。
    if (typeof summaryText !== 'string' || summaryText.trim().length === 0) {
      throw new Error('summary 不能为空：检查点的全部内容就是调用方写的摘要');
    }
    // 显式区间若压到「每步会被重新注入」的节点，自动把终点收回到它之前。
    const foldNotes = [...(opts.locateNotes ?? [])];
    if (cfg.protectRegenerableInjections) {
      const shrunk = shrinkPastRegenerableInjection(session, start, end);
      if (shrunk.end !== end) {
        foldNotes.push(`区间原到 #${end}，为避开会被自动重新注入的上下文已收窄到 #${shrunk.end}`);
        start = shrunk.start;
        end = shrunk.end;
      }
    }
    const selection = validateSpan(session, start, end);
    if (selection.shadowedSeqs.length > cfg.maxSpanNodes) {
      throw new Error(`区间含 ${selection.shadowedSeqs.length} 个节点，超过上限 ${cfg.maxSpanNodes}；请分几次压缩`);
    }
    const { openTurn } = inspectEntryState(session);

    const measured = measureNodes(meterOf(), session);
    const picked = measured.filter((node) => selection.shadowedSeqs.includes(node.seq));
    const shadowedTokenCount = picked.reduce((total, node) => total + (node.heuristicTokens ?? node.tokens ?? 0), 0);
    const shadowedRouteTokenCount = picked.reduce((total, node) => total + (node.tokens ?? 0), 0);
    const summaryBlocks = frameSummary(summaryText, {
      continuation: opts.continuation === true,
      skipPreamble: hasLiveCheckpoint(session, selection.shadowedSeqs),
    });
    const checkpointMessage = createUserMessage({
      content: summaryBlocks,
      source: compactCheckpointSource(CompactionId(randomUUID()), undefined),
    });
    const summaryTokens = messageTokens(
      meterOf(),
      checkpointMessage,
      summaryBlocks.map((block) => block.text ?? '').join(''),
    );

    if (shadowedTokenCount > 0 && shadowedTokenCount < cfg.minShadowTokens) {
      throw new Error(
        `区间估算只有 ${shadowedTokenCount} token，低于最小压缩体积 ${cfg.minShadowTokens}；压缩不划算`,
      );
    }
    if (cfg.requireShrink && summaryTokens >= shadowedRouteTokenCount) {
      throw new Error(
        `摘要不够短：估算 ${summaryTokens} token，被替换区间路由估算 ${shadowedRouteTokenCount} token；请写短一些`,
      );
    }

    const preview = {
      ok: true,
      dryRun: opts.dryRun === true,
      compactionId: '',
      startSeq: opts.dryRun === true ? 0 : start,
      endSeq: opts.dryRun === true ? 0 : end,
      startIndex: selection.startIdx,
      endIndex: selection.endIdx,
      replacedNodes: selection.shadowedSeqs.length,
      shadowedTokens: shadowedTokenCount,
      summaryTokens,
      savedTokens: shadowedTokenCount - summaryTokens,
      mergedCheckpoints: merged.bodies.length,
      warning: foldNotes.join('；'),
    };
    if (opts.dryRun === true) return preview;

    // 写前复检：格式层没有回滚，任何会在提交阶段失败的约束都必须在这里拦下。
    // 半事务（summary 已落盘、surface 替换失败）会让整份历史永久不可加载。
    const commitSpan = validateSpan(session, start, end);
    if (JSON.stringify(commitSpan.shadowedSeqs) !== JSON.stringify(selection.shadowedSeqs)) {
      throw new Error('surface 在压缩准备期间发生变化；请重新选择区间再折叠');
    }

    // ---- 事务：与 dsh-compaction-basic 相同的四段式 --------------------------
    const compactionId = CompactionId(randomUUID());
    const lifecycle = {
      compactionId,
      ...(typeof opts.sourceCommandId === 'string' ? { sourceCommandId: opts.sourceCommandId } : {}),
      turn: openTurn,
    };
    const startEvent = session.append('compaction/start', lifecycle);
    let committed = false;
    let failure;
    try {
      const summaryEvent = session.append('compaction/summary', {
        compactionId,
        ...(lifecycle.sourceCommandId === undefined ? {} : { sourceCommandId: lifecycle.sourceCommandId }),
        summary: summaryBlocks,
        shadowedRange: { start, end },
        shadowedSeqs: [...selection.shadowedSeqs],
        shadowedTokenCount,
        provider: opts.provider ?? 'context-compact',
        model: opts.model ?? 'model-authored',
      });
      const replacement = createUserMessage({
        content: summaryBlocks,
        source: compactCheckpointSource(compactionId, lifecycle.sourceCommandId),
      });
      session.append('user/message', replacement, {
        surfaceOp: { op: 'replace', startSeq: start, endSeq: end },
        sourceEventSeqs: [startEvent.seq, summaryEvent.seq, ...selection.shadowedSeqs],
      });
      committed = true;
    } catch (error) {
      failure = error;
    }
    if (!committed) {
      session.append('compaction/end', {
        ...lifecycle,
        error: `context-compact: 提交失败：${failure instanceof Error ? failure.message : String(failure)}`,
      });
      throw failure;
    }
    session.append('compaction/end', lifecycle);

    return {
      ...preview,
      dryRun: false,
      compactionId: String(compactionId),
      warning: [
        ...foldNotes,
        ...(shadowedRouteTokenCount === 0 ? ['无法估算路由体积（tokenMeter 不可用），已按粗略估算放行'] : []),
      ].join('；'),
    };
  }

  /**
   * 一次调用折多段：先逐段预演（dryRun）把会失败的情况全拦在写盘之前，
   * 再按 surface 顺序逐段提交。每段仍是一个完整的 compaction 事务，
   * 与连调 N 次工具等价，区别只是不占 N 轮模型往返。
   *
   * 不把多段塞进同一个 compaction 事务：格式层没有回滚，事务里任何一步失败
   * 都会把整份历史留成半截，失败现场比多写几个事务大得多。
   */
  function performFoldMany(session, segments, options) {
    const opts = options ?? {};
    const limit = Math.max(1, Math.floor(Number(cfg.maxSegments) || 1));
    if (segments.length > limit) {
      throw new Error(`单次最多折叠 ${limit} 段，这次给了 ${segments.length} 段；请分批调用`);
    }

    // 逐段先过一遍边界校验：这里就会拦下越界、劈开 tool-call、框进 system 头部。
    const spans = segments.map((seg, index) => {
      try {
        const range = locateSpan(session, seg.from, seg.to, { toolName: cfg.toolName });
        return {
          index,
          seg: { ...seg, start: range.start, end: range.end, locateNotes: range.notes },
          selection: validateSpan(session, range.start, range.end),
        };
      } catch (error) {
        throw new Error(`segments[${index}] 无效：${error instanceof Error ? error.message : String(error)}`);
      }
    });

    // 重叠必须挡在提交前：折完第一段，第二段里的节点已经不在 surface 上了。
    for (let i = 0; i < spans.length; i += 1) {
      for (let j = i + 1; j < spans.length; j += 1) {
        const mine = new Set(spans[i].selection.shadowedSeqs);
        const shared = spans[j].selection.shadowedSeqs.find((seq) => mine.has(seq));
        if (shared !== undefined) {
          throw new Error(
            `segments[${i}] 与 segments[${j}] 重叠（同一节点 #${shared} 同时落在两段里）；请把重叠的段合成一段`,
          );
        }
      }
    }

    // 按 surface 位置提交：靠前的先折，紧邻的旧检查点会被自动并进来。
    const ordered = [...spans].sort((a, b) => a.selection.startIdx - b.selection.startIdx);
    const requested = ordered.map(({ seg }) => ({ start: seg.start, end: seg.end }));

    // 预演：全部通过才落盘，避免压到一半才发现某段非法。
    const previews = ordered.map(({ seg, index }) => performFold(session, seg.start, seg.end, {
      ...opts,
      summary: seg.summary,
      locateNotes: seg.locateNotes,
      continuation: index > 0,
      dryRun: true,
    }));
    if (opts.dryRun === true) return aggregateFolds(previews, true, requested);

    const committed = [];
    for (let i = 0; i < ordered.length; i += 1) {
      const { seg, index } = ordered[i];
      try {
        committed.push(performFold(session, seg.start, seg.end, {
          ...opts,
          summary: seg.summary,
          continuation: index > 0,
        }));
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        const done = committed.length === 0 ? '还没有落盘任何一段' : `前 ${committed.length} 段已落盘，无法回滚`;
        throw new Error(`第 ${i + 1}/${ordered.length} 段（segments[${index}]）压缩失败：${reason}；${done}`);
      }
    }
    return aggregateFolds(committed, false);
  }

  // ---- 机械摘要：面板一键折叠用，不花模型 token，只搬运现场 -----------------
  const CLUE_FILE = /[\w@.\-/\\]+\.(?:js|mjs|cjs|ts|tsx|jsx|json|yml|yaml|md|css|html|ps1|toml)\b/g;
  const CLUE_CMD = /^\s*(?:\$|>|PS[ >]|pwsh|node|npm|pnpm|yarn|git|Get-|Set-|Select-|New-|Remove-)\b.*$/;
  const CLUE_FAIL = /(?:\[exit code: \d+\]|(?:^|\W)(?:Error|TypeError|SyntaxError|ReferenceError):|失败|报错|错误[:：]|EPERM|ENOENT|EACCES)/;

  function collectClues(session, shadowedSeqs) {
    const files = [];
    const commands = [];
    const failures = [];
    for (const seq of shadowedSeqs) {
      let text = '';
      try {
        text = previewOf(session, seq) ?? '';
      } catch {
        text = '';
      }
      if (text.length === 0) continue;
      for (const match of text.match(CLUE_FILE) ?? []) {
        const value = match.trim();
        if (value.length >= 4 && !files.includes(value) && files.length < 14) files.push(value);
      }
      for (const line of text.split(/\r?\n/)) {
        if (commands.length >= 10) break;
        const trimmed = line.trim();
        if (trimmed.length === 0 || trimmed.length > 160) continue;
        if (!CLUE_CMD.test(trimmed)) continue;
        if (commands.some((entry) => entry.line === trimmed)) continue;
        commands.push({ seq, line: trimmed });
      }
      for (const line of text.split(/\r?\n/)) {
        if (failures.length >= 8) break;
        const trimmed = line.trim();
        if (trimmed.length === 0 || trimmed.length > 200) continue;
        if (!CLUE_FAIL.test(trimmed)) continue;
        failures.push({ seq, line: trimmed });
      }
    }
    return { files, commands, failures };
  }

  function buildMechanicalSummary(session, shadowedSeqs, tokenBudget) {
    const clues = collectClues(session, shadowedSeqs);
    const header = [
      '## 已折叠区间（由面板自动生成，只搬运原文线索，未改写结论）',
      '',
      `- 覆盖 ${shadowedSeqs.length} 个 surface 节点（seq ${shadowedSeqs[0]}–${shadowedSeqs[shadowedSeqs.length - 1]}）。`,
      '- 下面是从这些节点里原样摘出的路径、命令与失败现场；结论与推理过程不在摘要里，需要时按路径、命令原文重新读取文件。',
    ];
    const clueLines = [];
    if (clues.files.length > 0) {
      clueLines.push('', '### 出现过的文件', ...clues.files.map((file) => `- ${file}`));
    }
    if (clues.commands.length > 0) {
      clueLines.push('', '### 跑过的命令');
      for (const entry of clues.commands) clueLines.push(`- seq ${entry.seq}：\`${clip(entry.line, 140)}\``);
    }
    if (clues.failures.length > 0) {
      clueLines.push('', '### 失败现场原文');
      for (const entry of clues.failures) clueLines.push(`- seq ${entry.seq}：${clip(entry.line, 180)}`);
    }
    const indexLines = ['', '### 节点索引'];
    for (const seq of shadowedSeqs) {
      let kind = 'node';
      let preview = '';
      try {
        kind = nodeKindOf(session, seq) ?? 'node';
        preview = clip(String(previewOf(session, seq) ?? '').replace(/\s+/g, ' ').trim(), 60);
      } catch {
        preview = '';
      }
      indexLines.push(`- seq ${seq} · ${kind}${preview.length > 0 ? ` · ${preview}` : ''}`);
    }

    const assemble = (lines) => lines.join('\n');
    let text = assemble([...header, ...clueLines, ...indexLines]);
    if (roughTokens(text) <= tokenBudget) return text;

    // 超预算：先砍节点索引的预览，再整段砍掉索引，最后只留线索。
    const trimmedIndex = ['', '### 节点索引', `- seq ${shadowedSeqs[0]}–${shadowedSeqs[shadowedSeqs.length - 1]}（${shadowedSeqs.length} 个节点，细节已省略）`];
    text = assemble([...header, ...clueLines, ...trimmedIndex]);
    if (roughTokens(text) <= tokenBudget) return text;
    return assemble([...header, ...clueLines]);
  }

  // ---- 面板：host 路由 ------------------------------------------------------
  const PANEL_ROUTE_BASE = '/context-compact';
  const MAX_BODY_BYTES = 64 * 1024;

  function sendJson(res, status, body) {
    const text = JSON.stringify(body);
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'content-length': Buffer.byteLength(text),
    });
    res.end(text);
  }

  async function readJsonBody(req) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) throw new Error(`请求体超过 ${MAX_BODY_BYTES} 字节`);
      chunks.push(chunk);
    }
    if (size === 0) return {};
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }

  function fenceViolation(req) {
    const host = req.headers?.host ?? '';
    const hostname = /^\[.*\](?::\d+)?$/.test(host)
      ? host.slice(1, host.indexOf(']'))
      : host.split(':')[0];
    const loopback =
      hostname === 'localhost'
      || hostname.endsWith('.localhost')
      || hostname === '::1'
      || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname);
    if (!loopback) return 'host 不是本机回环地址';
    const origin = req.headers?.origin;
    if (origin !== undefined && origin !== 'null') {
      let originHost;
      try {
        originHost = new URL(origin).host;
      } catch {
        return 'Origin 头无法解析';
      }
      if (originHost !== host) return 'Origin 与 Host 不一致';
    }
    if (req.headers?.['sec-fetch-site'] === 'cross-site') return 'sec-fetch-site: cross-site';
    if (req.method === 'POST') {
      const contentType = req.headers?.['content-type'] ?? '';
      if (!/^\s*application\/json\s*(;|$)/.test(contentType)) return 'POST 需要 application/json';
    }
    return undefined;
  }

  const agentsOf = () => optionalService(ctx, 'agents');
  const sessionsOf = () => optionalService(ctx, 'sessions');

  // 会话解析优先走 ctx.sessions：它按 session id 直接给 Session，
  // 而 Agent 的公开契约里只有 id（没有 session 字段），拿 Agent 反推会话会全落空。
  function agentById(sessionId) {
    const id = typeof sessionId === 'string' ? sessionId : '';
    if (id.length === 0) return undefined;
    const agents = agentsOf();
    if (agents === undefined || agents === null) return undefined;
    try {
      if (typeof agents.get === 'function') {
        const direct = agents.get(id);
        if (direct !== undefined && direct !== null) return direct;
      }
      if (typeof agents.list !== 'function') return undefined;
      const list = agents.list() ?? [];
      return list.find((candidate) => String(candidate?.id ?? candidate?.session?.id ?? '') === id);
    } catch {
      return undefined;
    }
  }

  function sessionById(sessionId) {
    const id = typeof sessionId === 'string' ? sessionId : '';
    if (id.length === 0) return undefined;
    const sessions = sessionsOf();
    if (sessions !== undefined && sessions !== null && typeof sessions.get === 'function') {
      try {
        const found = sessions.get(id);
        if (found !== undefined && found !== null) return found;
      } catch {
        /* 落到 agents 兜底 */
      }
    }
    return agentById(id)?.session;
  }

  const liveAgent = (sessionId) => agentById(sessionId);
  const liveSession = (sessionId) => sessionById(sessionId);

  function liveIds() {
    const sessions = sessionsOf();
    if (sessions !== undefined && sessions !== null && typeof sessions.list === 'function') {
      try {
        const ids = (sessions.list() ?? []).map((session) => String(session?.id ?? '?'));
        if (ids.length > 0) return ids;
      } catch {
        /* 落到 agents 兜底 */
      }
    }
    const agents = agentsOf();
    if (agents === undefined || agents === null || typeof agents.list !== 'function') return [];
    try {
      return (agents.list() ?? []).map((candidate) => String(candidate?.session?.id ?? candidate?.id ?? '?'));
    } catch {
      return [];
    }
  }

  function panelSnapshot(sessionId) {
    const session = liveSession(sessionId);
    if (session === undefined || session === null) {
      const ids = liveIds();
      throw new Error(
        `找不到活跃会话：${sessionId}（面板只对正在运行的会话有效；当前在线：${ids.length === 0 ? '无' : ids.join(', ')}）`,
      );
    }
    const meter = meterOf();
    const pressure = measurePressure(meter, session, cfg);
    const measured = measureNodes(meter, session);
    const bySeq = new Map(measured.map((node) => [node.seq, node]));
    const seqs = session.surface.nodes;
    const keep = Math.max(0, cfg.keepTailNodes);
    const keepSet = keepSeqsOf(seqs, keep);
    const nodes = seqs.map((seq, index) => {
      const node = bySeq.get(seq);
      return {
        index,
        seq,
        kind: nodeKindOf(session, seq),
        tokens: node ? (node.tokens ?? node.heuristicTokens ?? 0) : 0,
        heuristicTokens: node?.heuristicTokens ?? 0,
        keep: keepSet.has(seq),
        preview: clip(previewOf(session, seq), 160),
      };
    });
    // 面板要全量区间：被 maxHintRanges 截掉的那些同样是能折的，标成「不可压」会误导。
    const ranges = compressibleRanges(session, cfg, meter, { cap: Infinity });
    return {
      ok: true,
      sessionId: String(sessionId),
      tokens: pressure.tokens,
      ratio: pressure.ratio,
      windowTokens: cfg.contextWindowTokens,
      promptThresholdPct: effectiveThreshold(cfg),
      triggerAction: effectiveAction(cfg),
      injectTemplate: effectiveTemplate(cfg),
      keepTailNodes: keep,
      maxSpanNodes: cfg.maxSpanNodes,
      minShadowTokens: cfg.minShadowTokens,
      nodeCount: nodes.length,
      nodes,
      ranges,
      recommended: pickRecommended(ranges),
    };
  }

  function armPanelRoutes(hostCtx) {
    const webServer = optionalService(hostCtx ?? ctx, 'webServer') ?? optionalService(ctx, 'webServer');
    if (webServer === undefined || webServer === null || typeof webServer.register !== 'function') return () => {};
    const offs = [];
    const fence = (req, res) => {
      const violation = fenceViolation(req);
      if (violation === undefined) return false;
      sendJson(res, 403, { error: `forbidden: ${violation}` });
      return true;
    };

    offs.push(webServer.register({
      kind: 'exact',
      path: `${PANEL_ROUTE_BASE}/state`,
      handler: async (req, res) => {
        if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' });
        if (fence(req, res)) return;
        let query = {};
        try {
          query = Object.fromEntries(new URL(req.url ?? '/', 'http://localhost').searchParams);
        } catch {
          query = {};
        }
        try {
          sendJson(res, 200, panelSnapshot(query.sessionId));
        } catch (error) {
          sendJson(res, 500, { error: error?.message ?? String(error) });
        }
      },
    }));

    offs.push(webServer.register({
      kind: 'exact',
      path: `${PANEL_ROUTE_BASE}/node`,
      handler: async (req, res) => {
        if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' });
        if (fence(req, res)) return;
        let query = {};
        try {
          query = Object.fromEntries(new URL(req.url ?? '/', 'http://localhost').searchParams);
        } catch {
          query = {};
        }
        const session = liveSession(query.sessionId);
        if (session === undefined || session === null) {
          return sendJson(res, 409, { error: `找不到活跃会话：${query.sessionId}` });
        }
        const seq = Number(query.seq);
        if (!Number.isInteger(seq)) {
          return sendJson(res, 400, { error: 'seq 必须是 surface 节点的整数编号' });
        }
        try {
          return sendJson(res, 200, {
            ok: true,
            seq,
            kind: nodeKindOf(session, seq),
            text: fullTextOf(session, seq),
          });
        } catch (error) {
          return sendJson(res, 400, { error: error?.message ?? String(error) });
        }
      },
    }));

    offs.push(webServer.register({
      kind: 'exact',
      path: `${PANEL_ROUTE_BASE}/config`,
      handler: async (req, res) => {
        if (fence(req, res)) return;
        if (req.method === 'GET') {
          return sendJson(res, 200, {
            ok: true,
            promptThresholdPct: effectiveThreshold(cfg),
            triggerAction: effectiveAction(cfg),
            injectTemplate: effectiveTemplate(cfg),
            profilePromptThresholdPct: cfg.promptThresholdPct,
            windowTokens: cfg.contextWindowTokens,
            settingsFile: SETTINGS_FILE,
          });
        }
        if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' });
        let body;
        try {
          body = await readJsonBody(req);
        } catch (error) {
          return sendJson(res, 400, { error: error?.message ?? String(error) });
        }
        const patch = {};
        if (body?.promptThresholdPct !== undefined) {
          const pct = Number(body.promptThresholdPct);
          if (!Number.isFinite(pct) || pct < 1 || pct > 100) {
            return sendJson(res, 400, { error: 'promptThresholdPct 必须是 1–100 的数字' });
          }
          patch.promptThresholdPct = Math.round(pct);
        }
        if (body?.triggerAction !== undefined) {
          if (body.triggerAction !== 'inject' && body.triggerAction !== 'fold' && body.triggerAction !== 'off') {
            return sendJson(res, 400, { error: 'triggerAction 只能是 inject / fold / off' });
          }
          patch.triggerAction = body.triggerAction;
        }
        if (body?.injectTemplate !== undefined) {
          if (typeof body.injectTemplate !== 'string') {
            return sendJson(res, 400, { error: 'injectTemplate 必须是字符串' });
          }
          patch.injectTemplate = body.injectTemplate.slice(0, 2000);
        }
        if (Object.keys(patch).length === 0) {
          return sendJson(res, 400, { error: '没有要保存的字段' });
        }
        try {
          writeSettings(patch);
          sendJson(res, 200, {
            ok: true,
            promptThresholdPct: effectiveThreshold(cfg),
            triggerAction: effectiveAction(cfg),
            injectTemplate: effectiveTemplate(cfg),
          });
        } catch (error) {
          sendJson(res, 500, { error: `写入设置失败：${error?.message ?? String(error)}` });
        }
      },
    }));

    offs.push(webServer.register({
      kind: 'exact',
      path: `${PANEL_ROUTE_BASE}/fold`,
      handler: async (req, res) => {
        if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' });
        if (fence(req, res)) return;
        let body;
        try {
          body = await readJsonBody(req);
        } catch (error) {
          return sendJson(res, 400, { error: error?.message ?? String(error) });
        }
        const session = liveSession(body?.sessionId);
        if (session === undefined || session === null) {
          return sendJson(res, 409, { error: `找不到活跃会话：${body?.sessionId}` });
        }
        const start = Number(body?.start);
        const end = Number(body?.end);
        if (!Number.isInteger(start) || !Number.isInteger(end)) {
          return sendJson(res, 400, { error: 'start / end 必须是 surface 节点的 seq（整数）' });
        }
        try {
          const selection = validateSpan(session, start, end);
          const measured = measureNodes(meterOf(), session);
          const shadowedRouteTokens = measured
            .filter((node) => selection.shadowedSeqs.includes(node.seq))
            .reduce((total, node) => total + (node.tokens ?? 0), 0);
          const budget = Math.max(60, Math.floor(Math.max(shadowedRouteTokens, 240) * 0.45));
          const summaryText = buildMechanicalSummary(session, [...selection.shadowedSeqs], budget);
          const result = performFold(session, start, end, {
            summary: summaryText,
            provider: 'context-compact',
            model: 'mechanical-panel',
          });
          sendJson(res, 200, { ...result, brief: summaryText, snapshot: panelSnapshot(body.sessionId) });
        } catch (error) {
          sendJson(res, 400, { error: error?.message ?? String(error) });
        }
      },
    }));

    offs.push(webServer.register({
      kind: 'exact',
      path: `${PANEL_ROUTE_BASE}/ask`,
      handler: async (req, res) => {
        if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' });
        if (fence(req, res)) return;
        let body;
        try {
          body = await readJsonBody(req);
        } catch (error) {
          return sendJson(res, 400, { error: error?.message ?? String(error) });
        }
        const session = liveSession(body?.sessionId);
        if (session === undefined || session === null) {
          return sendJson(res, 409, { error: `找不到活跃会话：${body?.sessionId}` });
        }
        const start = Number(body?.start);
        const end = Number(body?.end);
        const hasSpan = Number.isInteger(start) && Number.isInteger(end);
        let instruction;
        if (hasSpan) {
          const rawHead = String(previewOf(session, start) ?? '').replace(/\s+/g, ' ').trim();
          const rawTail = String(previewOf(session, end) ?? '').replace(/\s+/g, ' ').trim();
          const head = rawHead.slice(0, 40);
          const tail = rawTail.slice(0, 40);
          instruction =
            `【上下文面板】请用 ${cfg.toolName} 折叠 surface 上「${head}」到「${tail}」这段区间：`
            + `先用 ${cfg.scanToolName} 核对两端节点，再用 from/to 定位（不用转义，按字面文本匹配：from: "${head}"、to: "${tail}"；`
            + '命中多个节点或找不到时，按报错里列出的候选换一段更独特的文本）。'
            + `然后写一份只保留结论、路径、命令与失败现场的摘要（语言：${cfg.summaryLanguage}；写法：${cfg.summaryStyle}）。`
            + '这只是腾地方，不要在这条消息后继续别的任务。';
        } else {
          // 不给预切区间：完整节点清单一并给，压哪段、压多少由模型自己判断
          // （与注入节点用的是同一套文本，面板里看到的和模型收到的一致）。
          try {
            const pressure = measurePressure(meterOf(), session, cfg);
            instruction = buildHintText(
              session,
              cfg,
              meterOf(),
              Math.floor((pressure.ratio * 100) / 5) * 5,
              Math.floor(pressure.tokens / 100) * 100,
              effectiveThreshold(cfg),
            );
          } catch (error) {
            instruction =
              `【上下文面板】上下文统计失败：${error?.message ?? String(error)}。`
              + `要不要压缩、压哪一段、摘要怎么写由你判断；需要时用 ${cfg.toolName}。`;
          }
        }
        try {
          // 只生成提示词，绝不往会话里塞消息：inbox 要的是完整 UserMessage
          // （{id, role:'user', content:[...]}），传字符串会让 message.id 变成
          // undefined 并被去重判成 "already pending"，还会在会话里留垃圾待发消息。
          // 真正的摘要得由模型自己写；不需要模型参与的折叠走 /fold。
          sendJson(res, 200, {
            ok: true,
            instruction,
            range: hasSpan ? { start, end } : null,
            note: '已生成提示词，复制粘贴给模型即可；模型的摘要会经 compact_context 直接落盘。',
          });
        } catch (error) {
          sendJson(res, 500, { error: error?.message ?? String(error) });
        }
      },
    }));

    // 安全阀：清掉会话里待发的输入（面板调试期误投递的消息会挂在 inbox 里）。
    offs.push(webServer.register({
      kind: 'exact',
      path: `${PANEL_ROUTE_BASE}/inbox-clear`,
      handler: async (req, res) => {
        if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' });
        if (fence(req, res)) return;
        let body;
        try {
          body = await readJsonBody(req);
        } catch (error) {
          return sendJson(res, 400, { error: error?.message ?? String(error) });
        }
        const agent = liveAgent(body?.sessionId);
        if (agent === undefined || agent === null) {
          return sendJson(res, 409, { error: `找不到活跃会话：${body?.sessionId}` });
        }
        const inbox = agent.inbox;
        if (inbox === undefined || inbox === null || typeof inbox.clear !== 'function') {
          return sendJson(res, 409, { error: '该 Agent 没有可清理的 inbox' });
        }
        const cleared = {
          nextTurn: Array.isArray(inbox.nextTurn) ? inbox.nextTurn.length : 0,
          nextStep: Array.isArray(inbox.nextStep) ? inbox.nextStep.length : 0,
        };
        inbox.clear();
        sendJson(res, 200, { ok: true, cleared });
      },
    }));

    return () => {
      for (const off of offs) {
        try {
          off?.();
        } catch {
          /* 忽略卸载期的重复回收 */
        }
      }
    };
  }

  // webServer 通常比本插件晚挂载：用 ctx.inject 等它就绪，卸载时随之回收。
  try {
    if (typeof ctx.inject === 'function') ctx.inject(['webServer'], (injected) => armPanelRoutes(injected));
    else armPanelRoutes(ctx);
  } catch (error) {
    ctx.logger?.warn?.(`context-compact: 面板路由注入失败：${error.message}`);
  }

  // ---- 策略：注入系统提示词 ------------------------------------------------
  if (!cfg.injectPrompt) return;

  const baseRules = [
    '上下文越长，旧内容越稀释注意力；压缩把过时对话折叠成摘要，腾出窗口给当前任务。',
    '压缩哪些：已被后续信息取代、与当前任务无关的早期探索与试错、重复确认；保留当前任务的决定、文件路径、命令、失败现场和用户明确要求。',
    `用 ${cfg.toolName}：下面会给出完整节点清单（类型/token + 内容开头），按内容写 from/to 定位（字面文本、空白折叠、不用转义；from 定位起点节点、to 定位终点节点，每端须唯一命中）；两端若落在工具步中间会自动收敛到最近的安全切点（只会少压，不会劈开步骤）；多段用 segments 数组（同一主题能一次压掉就别拆成多次；单次段数上限、每段节点上限、最小收益门槛见工具描述，超限会被拒绝）；尾部 ${cfg.keepTailNodes} 条保留。`,
    `${cfg.requireShrink ? '摘要必须明显短于被替换内容；' : ''}摘要语言：${cfg.summaryLanguage}；写法：${cfg.summaryStyle}。压缩后只看得到摘要：路径、命令、失败现场必须写进摘要。`,
    cfg.extraRules ? `额外硬规则：${cfg.extraRules}` : '',
  ].filter((line) => line.length > 0);

  // 文本分两段：恒定规则 + 触发后的动态参数。
  // 动态段只在越过阈值时出现；占用率按 5% 分档缓存，档位没变就复用上次的文本，
  // 这样系统提示词（in-history 路由）只在跨档时追加一条，不会每步重发。
  const dynamicCache = new Map(); // sessionId -> { band, text }
  const renderDynamic = (agent) => {
    const session = agent?.session;
    if (session === undefined || session === null) return '';
    let pressure;
    try {
      pressure = measurePressure(meterOf(), session, cfg);
    } catch {
      return '';
    }
    const threshold = effectiveThreshold(cfg);
    const pct = Math.floor((pressure.ratio * 100) / 5) * 5;
    if (!Number.isFinite(pct) || pct < threshold) return '';
    const cacheKey = String(session.id ?? '');
    const cached = dynamicCache.get(cacheKey);
    if (cached !== undefined && cached.band === pct) return cached.text;
    const text = buildHintText(
      session,
      cfg,
      meterOf(),
      pct,
      Math.floor(pressure.tokens / 100) * 100,
      threshold,
    );
    dynamicCache.set(cacheKey, { band: pct, text });
    return text;
  };

  // 恒定规则进系统提示词（稳定前缀，写一次就不动）。
  const contribution = { name: 'context-compact-policy', order: cfg.sectionOrder, text: baseRules.join('\n') };

  // 动态提示走独立注入节点：与运行时上下文同构（durable user message），但自成一个 surface 节点，
  // 不与 cwd/文件策略合成同一条快照；文本按 5% 档缓存，档位没变就不追加。
  const lastHint = new Map(); // sessionId -> text
  try {
    ctx.on('agent/pre-step', async (payload, next) => {
      const decision = await next();
      if (decision.kind === 'reject' || payload.signal?.aborted === true) return decision;
      const agent = payload.agent;
      let text = '';
      try {
        text = renderDynamic(agent);
      } catch {
        text = '';
      }
      if (text.length === 0) return decision;
      const sessionId = String(agent?.session?.id ?? '');
      if (lastHint.get(sessionId) === text) return decision;
      lastHint.set(sessionId, text);
      return {
        ...decision,
        messages: [
          ...decision.messages,
          createUserMessage({
            content: [{ type: 'text', text }],
            source: { kind: 'context-compact-hint', form: 'snapshot' },
          }),
        ],
      };
    });
  } catch (error) {
    ctx.logger?.warn?.(`context-compact: 提示注入失败：${error.message}`);
  }

  try {
    if (typeof ctx.systemPrompt?.section === 'function') ctx.systemPrompt.section(contribution);
    else if (typeof ctx.systemPrompt?.context === 'function') ctx.systemPrompt.context(contribution);
    else ctx.logger?.warn?.('context-compact: 拿不到 systemPrompt 服务，策略未注入');
  } catch (error) {
    ctx.logger?.warn?.(`context-compact: 策略注入失败：${error.message}`);
  }
}

export default { name, inject, Config, apply };
