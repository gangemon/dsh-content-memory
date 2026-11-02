/**
 * dsh-context-compact —— 右侧栏「上下文」面板的浏览器端。
 *
 * 打包约定（照抄 memorygraph/compress 的写法）：这不是 ES 模块，也没有打包步骤。
 * 本文件就是产物：classic script + window.__ModuleLoader__.load({ id, factory })，
 * id 必须等于 package.json 的包名；工厂体在首次 import 时才执行，所以样式注入、
 * 所有副作用都放在工厂里。没有 JSX 变换，因此只用 React.createElement。
 */
window.__ModuleLoader__.load({
  id: 'dsh-context-compact',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    var React = require('react')

    //#region 常量
    /** 面板 tab 在右侧栏注册表里的身份。 */
    const TAB_ID = 'dsh-context-compact/panel'
    /** 这个 tab 独占的 kind，要和其他插件不冲突。 */
    const TAB_KIND = 'context-compact-panel'
    const TAB_TITLE = '上下文'

    /** 与 host 端 lib/index.js 的 PANEL_ROUTE_BASE 保持一致。 */
    const ROUTE_BASE = '/context-compact'
    const STATE_URL = `${ROUTE_BASE}/state`
    const FOLD_URL = `${ROUTE_BASE}/fold`
    const ASK_URL = `${ROUTE_BASE}/ask`
    const CONFIG_URL = `${ROUTE_BASE}/config`

    /** 读快照不允许把面板卡住。 */
    const FETCH_TIMEOUT_MS = 20000
    /** 折叠是 host 本地拼机械摘要（不调模型），给足余量即可。 */
    const FOLD_TIMEOUT_MS = 120000
    /** 面板可见时的自动刷新间隔。 */
    const REFRESH_INTERVAL_MS = 8000
    /** 节点表最多渲染的行数，再多就只报总数。 */
    const MAX_NODE_ROWS = 200
    /** 样式标签的 id，用来去重（重复注入会让规则翻倍）。 */
    const CSS_TAG_ID = 'dsh-context-compact-style'
    //#endregion

    //#region 样式
    // 只用 --dsw-alias-* 主题变量，明暗主题自动跟随；不写死任何颜色。
    const CSS = `
.ccc{display:flex;flex-direction:column;gap:12px;padding:14px;font-size:12.5px;line-height:1.5;color:var(--dsw-alias-label-primary);overflow:auto;height:100%;box-sizing:border-box}
.ccc *{box-sizing:border-box}
.ccc-card{display:flex;flex-direction:column;gap:9px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:12px 14px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 1px 2px color-mix(in srgb, var(--dsw-alias-label-primary) 4%, transparent)}
.ccc-h{margin:0;font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:color-mix(in srgb, var(--dsw-alias-label-secondary) 72%, transparent)}
.ccc-empty{color:color-mix(in srgb, var(--dsw-alias-label-secondary) 72%, transparent);font-size:12px}
.ccc-caption{color:color-mix(in srgb, var(--dsw-alias-label-secondary) 72%, transparent);font-size:11px;font-variant-numeric:tabular-nums}
.ccc-loading{color:color-mix(in srgb, var(--dsw-alias-label-secondary) 72%, transparent);font-size:11px}
.ccc-note{color:color-mix(in srgb, var(--dsw-alias-label-secondary) 72%, transparent);font-size:11px}
.ccc-meter{display:flex;flex-direction:column;gap:9px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:14px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 1px 2px color-mix(in srgb, var(--dsw-alias-label-primary) 4%, transparent)}
.ccc-meter-head{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}
.ccc-pct{font-size:28px;font-weight:600;line-height:1.1;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.ccc-pct.is-over{color:var(--dsw-alias-state-warn-primary)}
.ccc-refresh{appearance:none;width:24px;height:24px;padding:0;font:inherit;font-size:13px;line-height:1;cursor:pointer;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-secondary)}
.ccc-refresh:hover:not(:disabled){background:color-mix(in srgb, var(--dsw-alias-label-primary) 8%, transparent);color:var(--dsw-alias-label-primary)}
.ccc-refresh:disabled{opacity:.45;cursor:default}
.ccc-bar{height:8px;border-radius:4px;background:var(--dsw-alias-bg-layer-2);overflow:hidden}
.ccc-bar-fill{height:100%;border-radius:4px;background:var(--dsw-alias-brand-primary);transition:width .22s ease}
.ccc-bar-fill.is-over{background:var(--dsw-alias-state-warn-primary)}
.ccc-range{display:flex;flex-direction:column;gap:6px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:8px 10px}
.ccc-range-head{display:flex;align-items:center;gap:6px}
.ccc-range-title{font-family:var(--ds-font-family-code,ui-monospace,Menlo,Consolas,monospace);font-size:12px;font-variant-numeric:tabular-nums}
.ccc-range-meta{color:color-mix(in srgb, var(--dsw-alias-label-secondary) 72%, transparent);font-size:11px;font-variant-numeric:tabular-nums}
.ccc-range-actions{display:flex;gap:6px}
.ccc-badge{border:1px solid var(--dsw-alias-border-l2);border-radius:5px;padding:0 6px;font-size:10px;line-height:16px;letter-spacing:.02em;color:var(--dsw-alias-label-secondary)}
.ccc-badge-keep{margin-left:4px;border-color:var(--dsw-alias-border-l1);color:color-mix(in srgb, var(--dsw-alias-label-secondary) 58%, transparent)}
.ccc-btn{appearance:none;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;padding:4px 11px;font:inherit;font-size:12px;cursor:pointer;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);transition:background .12s ease,border-color .12s ease,box-shadow .12s ease}
.ccc-btn:hover:not(:disabled){background:color-mix(in srgb, var(--dsw-alias-label-primary) 8%, transparent)}
.ccc-btn:disabled{opacity:.45;cursor:default}
.ccc-btn-ghost{background:transparent;color:var(--dsw-alias-label-secondary)}
.ccc-fold{display:flex;flex-direction:column;gap:6px}
.ccc-brief{margin:0;max-height:240px;overflow:auto;white-space:pre-wrap;word-break:break-word;font-family:var(--ds-font-family-code,ui-monospace,Menlo,Consolas,monospace);font-size:11px;line-height:1.45;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);border-radius:8px;padding:8px 9px}
.ccc-error{display:flex;flex-direction:column;gap:6px;border:1px solid var(--dsw-alias-state-error-primary);border-radius:10px;padding:10px 12px;background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent)}
.ccc-error-text{color:var(--dsw-alias-state-error-primary);font-size:12px;word-break:break-word}
.ccc-error-hint{color:var(--dsw-alias-label-secondary);font-size:11px}
.ccc-table{display:flex;flex-direction:column;gap:1px}
.ccc-tr{display:grid;grid-template-columns:76px minmax(0,104px) 52px minmax(0,1fr) auto;gap:8px;align-items:center;padding:3px 4px;border-radius:5px;font-size:11.5px}
.ccc-th{padding-bottom:4px;border-bottom:1px solid var(--dsw-alias-border-l1);font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:color-mix(in srgb, var(--dsw-alias-label-secondary) 72%, transparent)}
.ccc-row{cursor:pointer;color:var(--dsw-alias-label-secondary);transition:background .1s ease}
.ccc-row:hover{background:color-mix(in srgb, var(--dsw-alias-label-primary) 8%, transparent)}
.ccc-row.is-keep{opacity:.55}
.ccc-row.is-selected{opacity:1;background:color-mix(in srgb, var(--dsw-alias-label-primary) 8%, transparent);color:var(--dsw-alias-label-primary);box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l2)}
.ccc-td{min-width:0;overflow:hidden}
.ccc-c-seq,.ccc-c-tok{font-family:var(--ds-font-family-code,ui-monospace,Menlo,Consolas,monospace);font-variant-numeric:tabular-nums}
.ccc-c-kind{display:flex;flex-wrap:wrap;align-items:center;gap:4px}
.ccc-c-preview{white-space:nowrap;text-overflow:ellipsis;color:color-mix(in srgb, var(--dsw-alias-label-secondary) 72%, transparent)}
.ccc-c-act{display:flex;gap:4px;justify-content:flex-end;white-space:nowrap}
.ccc-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.ccc-input{appearance:none;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;padding:3px 8px;font:inherit;font-size:12px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);min-width:0}
.ccc-input:focus{outline:none;border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 3px color-mix(in srgb, var(--dsw-alias-brand-primary) 18%, transparent)}
.ccc-input-num{width:64px;font-variant-numeric:tabular-nums}
.ccc-toolbar .ccc-input{flex:1 1 140px}
.ccc-toolbar .ccc-input-num{flex:0 0 64px}
.ccc-row.is-range{color:var(--dsw-alias-label-primary)}
.ccc-row.is-range:hover{background:color-mix(in srgb, var(--dsw-alias-brand-primary) 10%, transparent)}
.ccc-input-grow{flex:1 1 180px}
.ccc-check{display:inline-flex;align-items:center;gap:4px;font-size:11px;color:var(--dsw-alias-label-secondary);cursor:pointer;white-space:nowrap}
.ccc-sheet{display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;overflow:auto;max-height:46vh;outline:none}
.ccc-sheet:focus-visible{box-shadow:inset 0 0 0 1px var(--dsw-alias-brand-primary)}
.ccc-sheet .ccc-tr{position:relative;align-items:center;border-radius:0;padding:0}
.ccc-sheet .ccc-th{position:sticky;top:0;z-index:2;background:var(--dsw-alias-bg-layer-1);border-bottom:1px solid var(--dsw-alias-border-l1);font-size:10px;letter-spacing:.05em;text-transform:none;color:color-mix(in srgb, var(--dsw-alias-label-secondary) 78%, transparent);user-select:none}
.ccc-sheet .ccc-th.is-sortable{cursor:pointer}
.ccc-sheet .ccc-th.is-sortable:hover{color:var(--dsw-alias-label-primary)}
.ccc-body{display:flex;flex-direction:column}
.ccc-line{min-height:24px;border-bottom:1px solid color-mix(in srgb, var(--dsw-alias-border-l1) 45%, transparent);transition:background .1s ease}
.ccc-line:last-child{border-bottom:none}
.ccc-cell{display:flex;align-items:center;gap:4px;min-width:0;padding:2px 6px;overflow:hidden;white-space:nowrap;font-size:11.5px;line-height:1.5}
.ccc-al-right{justify-content:flex-end;font-variant-numeric:tabular-nums}
.ccc-al-center{justify-content:center}
.ccc-al-left{justify-content:flex-start}
.ccc-row.is-node{color:color-mix(in srgb, var(--dsw-alias-label-secondary) 88%, transparent)}
.ccc-row.is-node.is-keep{opacity:.5}
.ccc-cell.is-edit{box-shadow:inset 0 0 0 1px var(--dsw-alias-brand-primary);border-radius:4px}
.ccc-cell-input{width:100%;padding:0 4px;font-size:11.5px}
.ccc-cell-input.is-bad{box-shadow:inset 0 0 0 1px var(--dsw-alias-state-error-primary)}
.ccc-resizer{position:absolute;top:0;right:0;width:6px;height:100%;cursor:col-resize}
.ccc-resizer:hover{background:var(--dsw-alias-brand-primary)}
.ccc-sort{font-size:9px;opacity:.8}
.ccc-cbox{margin:0;cursor:pointer;width:12px;height:12px;accent-color:var(--dsw-alias-brand-primary)}
.ccc-arrow{appearance:none;border:none;background:transparent;padding:0;cursor:pointer;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:1}
.ccc-arrow:hover{color:var(--dsw-alias-label-primary)}
.ccc-indent{margin-left:2px;opacity:.5}
.ccc-preview{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;opacity:.85}
.ccc-status{display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:11px;font-variant-numeric:tabular-nums;color:color-mix(in srgb, var(--dsw-alias-label-secondary) 82%, transparent)}
.ccc-status .ccc-btn{margin-left:auto}
.ccc-hero{display:flex;flex-direction:column;gap:10px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:14px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 1px 2px color-mix(in srgb, var(--dsw-alias-label-primary) 4%, transparent)}
.ccc-hero-top{display:flex;align-items:center;gap:8px}
.ccc-hero-top .ccc-pct{margin-right:2px}
.ccc-hero-top .ccc-refresh{margin-left:auto}
.ccc-th{display:inline-flex;align-items:center;gap:1px;font-size:11.5px;color:color-mix(in srgb, var(--dsw-alias-label-secondary) 80%, transparent)}
.ccc-th-val{appearance:none;border:1px solid transparent;background:transparent;border-radius:5px;padding:0 4px;font:inherit;font-size:12.5px;font-weight:600;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary);cursor:pointer}
.ccc-th-val:hover{border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base)}
.ccc-th-input{width:52px}
.ccc-go{appearance:none;display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;border:1px solid color-mix(in srgb, var(--dsw-alias-brand-primary) 55%, transparent);border-radius:9px;padding:10px 12px;font:inherit;font-size:12.5px;font-weight:600;cursor:pointer;text-align:left;background:color-mix(in srgb, var(--dsw-alias-brand-primary) 14%, transparent);color:var(--dsw-alias-brand-primary)}
.ccc-go:hover:not(:disabled){background:color-mix(in srgb, var(--dsw-alias-brand-primary) 24%, transparent)}
.ccc-go:disabled{cursor:default;border-color:var(--dsw-alias-border-l1);background:transparent;color:color-mix(in srgb, var(--dsw-alias-label-secondary) 80%, transparent);font-weight:400}
.ccc-go-meta{font-weight:400;font-size:11px;white-space:nowrap;opacity:.9}
.ccc-hero-actions{display:flex;align-items:center;gap:8px}
.ccc-hero-actions .ccc-go{flex:1 1 auto;width:auto}
.ccc-hero-actions .ccc-btn{flex:0 0 auto}
.ccc-policy{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding-top:2px}
.ccc-select{appearance:none;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;padding:3px 22px 3px 8px;font:inherit;font-size:11.5px;line-height:18px;cursor:pointer;color:var(--dsw-alias-label-primary);background-color:var(--dsw-alias-bg-base);background-image:linear-gradient(45deg,transparent 50%,currentColor 50%),linear-gradient(135deg,currentColor 50%,transparent 50%);background-position:calc(100% - 12px) 50%,calc(100% - 8px) 50%;background-size:4px 4px,4px 4px;background-repeat:no-repeat}
.ccc-select:hover{border-color:var(--dsw-alias-border-l2)}
.ccc-select option{background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary)}
.ccc-policy .ccc-mini{margin-left:auto}
.ccc-tpl{display:flex;flex-direction:column;gap:4px}
.ccc-tpl-input{width:100%;box-sizing:border-box;resize:vertical;font:inherit;font-size:11.5px;line-height:17px;padding:7px 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}
.ccc-tpl-input:focus{outline:none;border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 3px color-mix(in srgb, var(--dsw-alias-brand-primary) 16%, transparent)}
.ccc-toggle{appearance:none;display:flex;align-items:center;gap:6px;border:none;background:transparent;padding:3px 0;font:inherit;font-size:11.5px;cursor:pointer;color:color-mix(in srgb, var(--dsw-alias-label-secondary) 85%, transparent)}
.ccc-toggle:hover{color:var(--dsw-alias-label-primary)}
.ccc-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;border-top:1px solid var(--dsw-alias-border-l1);margin-top:6px;padding-top:8px}
.ccc-actions-info{margin-right:auto;font-size:11px;font-variant-numeric:tabular-nums;color:color-mix(in srgb, var(--dsw-alias-label-secondary) 82%, transparent)}
.ccc-btn-strong{border-color:color-mix(in srgb, var(--dsw-alias-brand-primary) 55%, transparent);background:color-mix(in srgb, var(--dsw-alias-brand-primary) 15%, transparent);color:var(--dsw-alias-brand-primary);font-weight:600}
.ccc-btn-strong:hover:not(:disabled){background:color-mix(in srgb, var(--dsw-alias-brand-primary) 25%, transparent)}
.ccc-map{display:flex;flex-direction:column;gap:8px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:12px 14px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 1px 2px color-mix(in srgb, var(--dsw-alias-label-primary) 4%, transparent)}
.ccc-map-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px;font-size:11px;color:color-mix(in srgb, var(--dsw-alias-label-secondary) 80%, transparent)}
.ccc-map-bar{position:relative;display:flex;gap:1px;height:34px;border-radius:8px;background:var(--dsw-alias-bg-layer-2);overflow:hidden}
.ccc-seg{height:100%;min-width:1px;border-radius:2px;background:color-mix(in srgb, var(--dsw-alias-label-secondary) 34%, transparent);transition:opacity .12s,filter .12s,outline-color .12s;outline:1px solid transparent;outline-offset:-1px}
.ccc-seg.is-node{box-shadow:inset 0 0 0 .5px color-mix(in srgb, var(--dsw-alias-bg-layer-2) 70%, transparent)}
.ccc-seg.is-fold{background:color-mix(in srgb, var(--dsw-alias-brand-primary) 78%, transparent);cursor:pointer}
.ccc-seg.is-keep{background:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 62%, transparent)}
.ccc-seg.is-keep.is-node{box-shadow:inset 0 0 0 .5px color-mix(in srgb, var(--dsw-alias-state-warn-primary) 90%, transparent)}
.ccc-seg.is-overhead{background:repeating-linear-gradient(45deg,color-mix(in srgb, var(--dsw-alias-label-secondary) 20%, transparent) 0 3px,color-mix(in srgb, var(--dsw-alias-label-secondary) 9%, transparent) 3px 6px);cursor:default;transition:none}
.ccc-seg:hover{filter:brightness(1.22)}
.ccc-seg.is-on{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px;filter:brightness(1.2)}
.ccc-seg.is-group{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px;filter:brightness(1.28);z-index:3}
.ccc-seg.is-group.is-keep{outline-color:var(--dsw-alias-state-warn-primary)}
.ccc-map-th{position:absolute;top:0;bottom:0;width:1px;background:var(--dsw-alias-state-warn-primary)}
.ccc-map-th-label{position:absolute;top:-1px;transform:translateX(4px);font-size:9.5px;line-height:12px;color:var(--dsw-alias-state-warn-primary);font-variant-numeric:tabular-nums}
.ccc-map-legend{display:flex;gap:10px;flex-wrap:wrap;font-size:10.5px;color:color-mix(in srgb, var(--dsw-alias-label-secondary) 75%, transparent)}
.ccc-dot{display:inline-block;width:7px;height:7px;border-radius:2px;margin-right:4px;vertical-align:middle;background:color-mix(in srgb, var(--dsw-alias-brand-primary) 78%, transparent)}
.ccc-dot.is-plain{background:color-mix(in srgb, var(--dsw-alias-label-secondary) 34%, transparent)}
.ccc-dot.is-keep{background:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 62%, transparent);box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l2)}
.ccc-dot.is-overhead{background:repeating-linear-gradient(45deg,color-mix(in srgb, var(--dsw-alias-label-secondary) 30%, transparent) 0 2px,color-mix(in srgb, var(--dsw-alias-label-secondary) 10%, transparent) 2px 4px)}
.ccc-map-tools{display:flex;align-items:center;gap:4px}
.ccc-map-count{margin-right:2px}
.ccc-mini{appearance:none;border:1px solid var(--dsw-alias-border-l1);background:transparent;border-radius:4px;padding:0 5px;font:inherit;font-size:10.5px;line-height:16px;cursor:pointer;color:var(--dsw-alias-label-secondary)}
.ccc-mini:hover{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary)}
.ccc-map-bar{cursor:crosshair;user-select:none;touch-action:none}
.ccc-map-hint{display:none}
.ccc-map-scale{font-variant-numeric:tabular-nums;opacity:.65}
.ccc-brush{position:absolute;top:0;bottom:0;z-index:2;pointer-events:none;background:color-mix(in srgb, var(--dsw-alias-brand-primary) 24%, transparent);box-shadow:inset 1px 0 0 var(--dsw-alias-brand-primary),inset -1px 0 0 var(--dsw-alias-brand-primary)}
.ccc-detail{display:flex;flex-direction:column;gap:5px;border-top:1px dashed var(--dsw-alias-border-l1);padding-top:7px}
.ccc-detail-head{display:flex;align-items:center;gap:8px;font-size:11px;font-variant-numeric:tabular-nums;color:color-mix(in srgb, var(--dsw-alias-label-secondary) 85%, transparent)}
.ccc-detail-title{font-weight:600;color:var(--dsw-alias-label-primary)}
.ccc-detail-tag{border:1px solid var(--dsw-alias-border-l1);border-radius:4px;padding:0 4px;font-size:10px}
.ccc-detail-close{margin-left:auto}
.ccc-detail-empty{font-size:10.5px;line-height:1.5;opacity:.62;padding:2px 0}
.ccc-detail-list{display:flex;flex-direction:column;gap:1px;max-height:46vh;overflow:auto}
.ccc-detail-node{display:flex;align-items:center;gap:8px;min-width:0;font-size:10.5px;line-height:1.7;padding:1px 0;color:color-mix(in srgb, var(--dsw-alias-label-secondary) 85%, transparent)}
.ccc-detail-node+.ccc-detail-node{border-top:1px solid color-mix(in srgb, var(--dsw-alias-border-l1) 35%, transparent)}
.ccc-detail-seq{white-space:nowrap;min-width:50px;font-variant-numeric:tabular-nums;color:color-mix(in srgb, var(--dsw-alias-label-primary) 78%, transparent)}
.ccc-detail-tok{opacity:.6;min-width:44px;text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
.ccc-detail-kind{white-space:nowrap;min-width:80px;text-align:center;border-radius:3px;background:var(--dsw-alias-bg-layer-2);padding:0 5px;font-size:9.5px;opacity:.85}
.ccc-detail-node{flex-direction:column;align-items:stretch;gap:0}
.ccc-detail-row{display:flex;align-items:center;gap:8px;min-width:0;cursor:pointer;border-radius:4px;padding:1px 3px;margin:0 -3px}
.ccc-detail-row:hover{background:color-mix(in srgb, var(--dsw-alias-bg-layer-2) 75%, transparent)}
.ccc-detail-node.is-open .ccc-detail-row{background:color-mix(in srgb, var(--dsw-alias-bg-layer-2) 90%, transparent)}
.ccc-detail-full{white-space:pre-wrap;word-break:break-word;max-height:320px;overflow:auto;font-size:10.5px;line-height:1.6;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--dsw-alias-bg-layer-2);border-radius:6px;padding:6px 8px;margin:2px 0 4px;opacity:.9}
.ccc-detail-full.is-loading{opacity:.55}
.ccc-linkbtn{background:none;border:0;padding:0;font:inherit;font-size:10.5px;color:var(--dsw-alias-brand-primary);cursor:pointer;opacity:.85}
.ccc-linkbtn:hover{opacity:1;text-decoration:underline}
.ccc-detail-more{font-size:10px;opacity:.65}
.ccc-viewbar{display:flex;align-items:center;gap:8px;font-size:11px;color:color-mix(in srgb, var(--dsw-alias-label-secondary) 80%, transparent)}
.ccc-viewbtn{appearance:none;border:1px solid var(--dsw-alias-border-l1);background:transparent;border-radius:6px;padding:3px 12px;font:inherit;font-size:11px;line-height:16px;cursor:pointer;color:color-mix(in srgb, var(--dsw-alias-label-secondary) 85%, transparent)}
.ccc-viewbtn:hover{color:var(--dsw-alias-label-primary)}
.ccc-viewbtn.is-on{border-color:color-mix(in srgb, var(--dsw-alias-brand-primary) 55%, transparent);background:color-mix(in srgb, var(--dsw-alias-brand-primary) 15%, transparent);color:var(--dsw-alias-brand-primary);font-weight:600}
.ccc-viewstat{margin-left:auto;font-variant-numeric:tabular-nums}
/* 视觉优化：统一滚动条与焦点态 */
.ccc ::-webkit-scrollbar{width:8px;height:8px}
.ccc ::-webkit-scrollbar-thumb{background:color-mix(in srgb,var(--dsw-alias-label-secondary) 35%, transparent);border-radius:4px}
.ccc ::-webkit-scrollbar-thumb:hover{background:color-mix(in srgb,var(--dsw-alias-label-secondary) 55%, transparent)}
.ccc ::-webkit-scrollbar-track{background:transparent}
.ccc .ccc-btn:focus-visible,.ccc .ccc-viewbtn:focus-visible,.ccc .ccc-mini:focus-visible,.ccc .ccc-go:focus-visible{outline:2px solid color-mix(in srgb,var(--dsw-alias-brand-primary) 70%, transparent);outline-offset:1px}
.ccc .ccc-btn:active:not(:disabled),.ccc .ccc-go:active:not(:disabled){transform:translateY(1px)}
.ccc .ccc-empty{border:1px dashed color-mix(in srgb,var(--dsw-alias-border-l1) 80%, transparent);border-radius:8px;padding:14px;text-align:center}
.ccc-toolbar{gap:10px}
.ccc-content{display:flex;flex-direction:column;gap:12px}
`
    //#endregion

    //#region 工具
    const h = React.createElement

    /** 只注入一次本面板的样式表。 */
    function injectStyles() {
      if (typeof document === 'undefined') return
      if (document.getElementById(CSS_TAG_ID) !== null) return
      const tag = document.createElement('style')
      tag.id = CSS_TAG_ID
      tag.textContent = CSS
      document.head.appendChild(tag)
    }

    /**
     * 发一个 JSON 请求。
     *
     * host 路由只接受本机回环 + 同源，所以走相对路径 + same-origin cookie。
     * 非 JSON 响应（例如 404 的 HTML 兜底页）单独识别，否则用户看到的是
     * 「Unexpected token <」这种没法排查的报错。
     */
    async function request(url, init, timeoutMs) {
      const controller = typeof AbortController === 'function' ? new AbortController() : undefined
      const timer = controller === undefined ? undefined : setTimeout(() => controller.abort(), timeoutMs)
      try {
        const response = await fetch(url, {
          ...init,
          signal: controller?.signal,
          credentials: 'same-origin',
          headers: { accept: 'application/json', ...(init?.headers ?? {}) },
        })
        const raw = await response.text()
        let parsed
        let nonJson = false
        try {
          parsed = raw === '' ? null : JSON.parse(raw)
        } catch {
          nonJson = true
          parsed = null
        }
        if (!response.ok || nonJson) {
          const detail =
            parsed !== null && typeof parsed.error === 'string'
              ? parsed.error
              : nonJson
                ? `接口未就绪（${response.status}）`
                : `HTTP ${response.status}`
          const failure = new Error(detail)
          failure.status = response.status
          throw failure
        }
        return parsed
      } finally {
        if (timer !== undefined) clearTimeout(timer)
      }
    }

    /** 把任意异常转成一行可显示的文字。 */
    function errorText(failure) {
      if (failure === undefined || failure === null) return '未知错误'
      if (typeof failure === 'string') return failure
      const message = typeof failure.message === 'string' ? failure.message : String(failure)
      return message.length === 0 ? '请求失败' : message
    }

    /** 数字统一取整显示；非数字显示破折号。 */
    function formatNum(value) {
      const n = Number(value)
      if (!Number.isFinite(n)) return '—'
      return String(Math.round(n))
    }

    /** 上下文窗口显示成 80K 这种短形式。 */
    function formatWindow(value) {
      const n = Number(value)
      if (!Number.isFinite(n) || n <= 0) return '—'
      return n >= 1000 ? `${Math.round(n / 1000)}K` : String(Math.round(n))
    }

    /** host 的 ratio 是 0–1 的小数，这里只负责显示。 */
    function ratioOf(snapshot) {
      const ratio = Number(snapshot?.ratio)
      if (!Number.isFinite(ratio)) return 0
      return Math.min(1, Math.max(0, ratio))
    }

    /** 节点类型是 host 的机器词，能翻的翻，翻不了就原样显示。 */
    const KIND_LABELS = {
      user: '用户',
      assistant: '助手',
      message: '消息',
      tool: '工具',
      'tool-result': '工具结果',
      system: '系统',
      checkpoint: '检查点',
    }

    function kindLabel(kind) {
      const key = String(kind)
      return KIND_LABELS[key] ?? key
    }

    /** 判断响应里是不是 host 的 { error } 形状。 */
    function isFailure(value) {
      return value !== null && typeof value === 'object' && typeof value.error === 'string'
    }
    //#endregion

    //#region 视图
    /** 带小标题的卡片外壳。 */
    function Card(props) {
      return h('section', { className: 'ccc-card' }, h('h3', { className: 'ccc-h' }, props.title), props.children)
    }

    function Empty(props) {
      return h('div', { className: 'ccc-empty' }, props.text)
    }

    /**
     * 顶部一句话结论：占用率 + 阈值（点一下就改）+ 一个主按钮。
     *
     * 面板 90% 的用法只有两件事：看到「快满了」，然后一键压掉推荐的那一段。
     * 所以这里只放这两个，配置项和明细都排到后面去。
     */
    function Hero(props) {
      const snapshot = props.snapshot
      const percent = Math.round(ratioOf(snapshot) * 100)
      const threshold = Number(snapshot?.promptThresholdPct)
      const hasThreshold = Number.isFinite(threshold)
      const over = hasThreshold && percent > threshold
      const [editing, setEditing] = React.useState(false)
      const [draft, setDraft] = React.useState('')
      const action = typeof props.action === 'string' ? props.action : 'inject'
      const template = typeof props.template === 'string' ? props.template : ''
      const [openTpl, setOpenTpl] = React.useState(false)
      const [tplDraft, setTplDraft] = React.useState('')
      const beginTpl = () => {
        setTplDraft(template)
        setOpenTpl(true)
      }
      const commitTpl = () => {
        if (!openTpl) return
        setOpenTpl(false)
        if (tplDraft === template) return
        props.onSaveTemplate(tplDraft)
      }

      const begin = () => {
        setDraft(hasThreshold ? String(Math.round(threshold)) : '')
        setEditing(true)
      }
      const commit = () => {
        if (!editing) return
        setEditing(false)
        const value = Number(String(draft).trim())
        if (!Number.isInteger(value) || value < 1 || value > 100) return
        if (hasThreshold && value === Math.round(threshold)) return
        props.onSaveThreshold(value)
      }

      const rec = props.recommended
      const recText =
        rec === null || rec === undefined
          ? '暂无可折叠区间'
          : `压缩 #${formatNum(rec.start)}–#${formatNum(rec.end)}`
      const recMeta =
        rec === null || rec === undefined
          ? '打开明细可以自己挑'
          : `该段 ${formatNum(props.recommendedTokens)} token · ${formatNum(props.recommendedNodes)} 节点`
      const folding = rec !== null && rec !== undefined && props.folding === `${rec.start}-${rec.end}`

      return h(
        'div',
        { className: 'ccc-hero' },
        h(
          'div',
          { className: 'ccc-hero-top' },
          h('div', { className: 'ccc-pct' + (over ? ' is-over' : '') }, snapshot === null ? '—' : `${percent}%`),
          h(
            'span',
            { className: 'ccc-th' },
            '阈值',
            editing
              ? h('input', {
                  className: 'ccc-input ccc-input-num ccc-th-input',
                  type: 'number',
                  min: 1,
                  max: 100,
                  autoFocus: true,
                  value: draft,
                  onChange: (event) => setDraft(event.target.value),
                  onKeyDown: (event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      commit()
                    } else if (event.key === 'Escape') {
                      event.preventDefault()
                      setEditing(false)
                    }
                  },
                  onBlur: commit,
                })
              : h(
                  'button',
                  { type: 'button', className: 'ccc-th-val', onClick: begin, title: '点一下改阈值，回车保存' },
                  hasThreshold ? `${formatNum(threshold)}%` : '—',
                ),
          ),
          h('button', { type: 'button', className: 'ccc-refresh', title: '刷新', onClick: props.onRefresh, disabled: props.loading }, '↻'),
        ),
        h('div', { className: 'ccc-bar' }, h('div', { className: 'ccc-bar-fill' + (over ? ' is-over' : ''), style: { width: `${Math.max(2, percent)}%` } })),
        h(
          'div',
          { className: 'ccc-caption' },
          snapshot === null
            ? '还没有读到状态'
            : `约 ${formatNum(snapshot.tokens)} / ${formatWindow(snapshot.windowTokens)} token`,
        ),
        h(
          'div',
          { className: 'ccc-policy' },
          h('span', { className: 'ccc-th' }, '触发后'),
          h(
            'select',
            {
              className: 'ccc-input ccc-select',
              value: action,
              onChange: (event) => props.onSaveAction(event.target.value),
            },
            h('option', { value: 'inject' }, '提示模型（让它自己决定）'),
            h('option', { value: 'fold' }, '自动折叠建议区间'),
            h('option', { value: 'off' }, '只显示，不提示'),
          ),
          h(
            'button',
            { type: 'button', className: 'ccc-mini', onClick: openTpl ? commitTpl : beginTpl },
            openTpl ? '保存文案' : '改文案',
          ),
        ),
        openTpl
          ? h(
              'div',
              { className: 'ccc-tpl' },
              h('textarea', {
                className: 'ccc-input ccc-tpl-input',
                rows: 5,
                value: tplDraft,
                onChange: (event) => setTplDraft(event.target.value),
                onKeyDown: (event) => {
                  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                    event.preventDefault()
                    commitTpl()
                  } else if (event.key === 'Escape') {
                    event.preventDefault()
                    setOpenTpl(false)
                  }
                },
              }),
              h('div', { className: 'ccc-caption' }, '占位符（可选）：{pct} {tokens} {threshold} {tool} · 模板后面自动追加「压多少」方法与节点清单 · Ctrl+Enter 保存'),
            )
          : null,
        snapshot === null
          ? null
          : h(
              'div',
              { className: 'ccc-hero-actions' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'ccc-go',
                  disabled: props.busy,
                  onClick: () => props.onAsk(null),
                },
                h('span', null, props.asking ? '生成中…' : '让模型压缩'),
                h('span', { className: 'ccc-go-meta' }, '它自己挑区间、自己写摘要'),
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'ccc-btn ccc-btn-ghost',
                  disabled: rec === null || rec === undefined || props.busy,
                  onClick: rec === null || rec === undefined ? undefined : () => props.onFold(rec),
                },
                folding ? '折叠中…' : recText,
              ),
            ),
        props.prompt !== undefined && String(props.prompt).length > 0
          ? h(
              'div',
              { className: 'ccc-fold' },
              h('div', { className: 'ccc-caption' }, '提示词（复制给模型）'),
              h('pre', { className: 'ccc-brief' }, props.prompt),
              h(
                'button',
                {
                  type: 'button',
                  className: 'ccc-btn',
                  onClick: () => {
                    if (typeof navigator !== 'undefined' && navigator.clipboard) navigator.clipboard.writeText(props.prompt)
                  },
                },
                '复制',
              ),
            )
          : null,
        props.note !== undefined && String(props.note).length > 0 ? h('div', { className: 'ccc-note' }, props.note) : null,
      )
    }

    /**
     * 上下文地图：把整个窗口画成一条按 token 宽度铺开的条带。
     *
     * 表格回答「第 1421 行是什么」，地图回答「肥肉在哪儿」——后者才是用户真正的
     * 问题。能折的段用主题色点亮，保留段压暗，阈值画一条竖线；点段选中，再点一次
     * 折叠。这就是「总览先给、明细按需」：先看形状，再决定要不要读数字。
     */
    function ContextMap(props) {
      const nodes = Array.isArray(props.nodes) ? props.nodes : []
      const ranges = Array.isArray(props.ranges) ? props.ranges : []
      const total = Number(props.windowTokens) > 0 ? Number(props.windowTokens) : 0
      // 整窗口口径的实际占用（含系统提示词、工具定义等非节点开销）；节点 token 之和只是其中一部分。
      const used = Number(props.usedTokens) > 0 ? Number(props.usedTokens) : 0
      const threshold = Number(props.thresholdPct)
      // 三种交互叠在同一条条带上：滚轮/按钮缩放看局部，拖框选一段，点色块看这一段的详情。
      const [zoom, setZoom] = React.useState(null)
      const [picked, setPicked] = React.useState(null)
      const [brush, setBrush] = React.useState(null)
      const [detail, setDetail] = React.useState(null)
      // 悬停高亮：同一段的节点一起亮，否则一根一根看，根本分不出段边界。
      const [hoverKey, setHoverKey] = React.useState(null)
      // 详情卡节点展开：点一行拉它的完整原文（面板快照里只有 160 字符摘要）。
      const [expandedSeq, setExpandedSeq] = React.useState(null)
      const [texts, setTexts] = React.useState({})
      const [loadingSeq, setLoadingSeq] = React.useState(null)
      const [listOpen, setListOpen] = React.useState(false)
      const sessionKey = typeof props?.sessionId === 'string' ? props.sessionId : ''
      const openNode = (seq) => {
        setExpandedSeq(seq)
        if (texts[seq] !== undefined || sessionKey === '') return
        setLoadingSeq(seq)
        request(`${ROUTE_BASE}/node?sessionId=${encodeURIComponent(sessionKey)}&seq=${seq}`, undefined, FETCH_TIMEOUT_MS)
          .then((payload) => setTexts((prev) => ({ ...prev, [seq]: payload?.text ?? '' })))
          .catch((error) => setTexts((prev) => ({ ...prev, [seq]: `读取失败：${error?.message ?? error}` })))
          .finally(() => setLoadingSeq((current) => (current === seq ? null : current)))
      }
      const mapRef = React.useRef(null)
      const barRef = React.useRef(null)
      const dragRef = React.useRef(null)
      const draggedRef = React.useRef(false)
      const wheelRef = React.useRef({ view: [0, 1], viewWidth: 1, floor: 1 })

      // 滚轮缩放：把光标压住的那个 token 当锚点。监听器直接挂在原生节点上，
      // 才能 preventDefault 挡住整页滚动（React 的 onWheel 是 passive 的）。
      React.useEffect(() => {
        const host = mapRef.current
        if (host === null || host === undefined) return undefined
        const onWheel = (event) => {
          // 只有光标落在条带上才缩放，免得面板滚不动。
          const bar = barRef.current
          if (bar === null || bar === undefined) return
          const box = bar.getBoundingClientRect()
          if (box.width === 0) return
          if (
            event.clientX < box.left ||
            event.clientX > box.right ||
            event.clientY < box.top ||
            event.clientY > box.bottom
          )
            return
          event.preventDefault()
          const state = wheelRef.current
          const width = Math.max(1, state.viewWidth)
          const ratio = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width))
          const anchor = state.view[0] + ratio * width
          const factor = event.deltaY < 0 ? 0.72 : 1 / 0.72
          const next = Math.min(state.floor, Math.max(64, width * factor))
          if (next >= state.floor) {
            setZoom(null)
            return
          }
          const start = Math.min(Math.max(0, anchor - ratio * next), state.floor - next)
          setZoom([start, start + next])
        }
        host.addEventListener('wheel', onWheel, { passive: false })
        return () => host.removeEventListener('wheel', onWheel)
      }, [nodes.length, total, used])

      if (nodes.length === 0 || total === 0) return null

      const occupied = nodes.reduce((sum, node) => sum + (Number(node.tokens) || 0), 0)
      const overhead = Math.max(0, used - occupied)
      const floor = Math.max(occupied, used, total, 1)
      const rangeOf = (seq) => ranges.find((range) => seq >= range.start && seq <= range.end) ?? null

      // 每个节点占的 token 区间：缩放、框选、阈值线都按这套偏移换算。
      const spans = []
      let cursor = 0
      for (const node of nodes) {
        const tokens = Math.max(Number(node.tokens) || 0, 0)
        spans.push({ seq: Number(node.seq), from: cursor, to: cursor + tokens, tokens, keep: node.keep === true, node })
        cursor += tokens
      }
      const spanOfSeq = (seq) => spans.find((span) => span.seq === seq) ?? undefined

      // 一个节点一根，谁都不合并：相邻节点靠 1px 缝分开，同段节点靠同一段名归组。
      const segs = []
      const groupSeen = new Map()
      for (const span of spans) {
        const range = rangeOf(span.seq)
        const key = range === null ? `gap-${span.seq}` : `${range.start}-${range.end}`
        const index = groupSeen.get(key) ?? 0
        groupSeen.set(key, index + 1)
        segs.push({ key, range, index, from: span.from, to: span.to, tokens: span.tokens, keep: span.keep, seq: span.seq, node: span.node })
      }
      // 非节点开销也画成一段：不画出来，条带只到节点占比，顶部占用率和阈值线就对不上。
      if (overhead > 0) {
        segs.push({
          key: 'overhead',
          range: null,
          index: 0,
          from: occupied,
          to: occupied + overhead,
          tokens: overhead,
          keep: false,
          seq: null,
          node: null,
          overhead: true,
        })
      }
      // 系统头不许被框进来，否则折到一半会被主机拒掉。
      const protectSeq = ranges.length === 0 ? -1 : Number(ranges[0].start)
      const view = zoom === null ? [0, floor] : zoom
      const viewWidth = Math.max(1, view[1] - view[0])
      wheelRef.current = { view, viewWidth, floor }
      const pctOfOffset = (offset) => ((offset - view[0]) / viewWidth) * 100
      const thresholdOffset =
        Number.isFinite(threshold) && threshold >= 1 && threshold <= 100 ? pctOfOffset((threshold / 100) * total) : -1

      const pickedSeg = segs.find((seg) => seg.key === picked && seg.range !== null) ?? null
      const pickedSel =
        pickedSeg === null
          ? null
          : {
              range: pickedSeg.range,
              start: pickedSeg.range.start,
              end: pickedSeg.range.end,
              tokens: pickedSeg.range.tokens,
              nodes: pickedSeg.range.nodes,
            }
      // 当前选中：展开的明细优先，其次拖框，最后点选。三种都只决定「动作行显示什么」，
      // 明细卡只在点过「看明细」时出现。
      const selection = detail !== null ? detail : pickedSel
      const activeRange = selection === null ? null : selection.range ?? null
      const activeKey = selection === null ? null : `${selection.start}-${selection.end}`
      const activeTokens = selection === null ? 0 : Number(selection.tokens) || 0

      // 拖出来的 token 区间 → 落到节点上：整段装进框里就整段折，装不下也允许折框住的那一段。
      const resolveBrush = (from, to) => {
        const lo = Math.min(from, to)
        const hi = Math.max(from, to)
        const hit = spans.filter((span) => span.to > lo && span.from < hi && span.seq >= protectSeq)
        if (hit.length === 0) return null
        const inside = ranges.filter((range) => {
          const first = spanOfSeq(range.start)
          const last = spanOfSeq(range.end)
          return first !== undefined && last !== undefined && first.from >= lo && last.to <= hi
        })
        const best = inside.reduce((winner, range) => (winner === undefined || range.tokens > winner.tokens ? range : winner), undefined) ?? null
        return {
          range: best,
          start: hit[0].seq,
          end: hit[hit.length - 1].seq,
          tokens: hit.reduce((sum, span) => sum + span.tokens, 0),
          nodes: hit.length,
        }
      }

      const zoomTo = (factor) => {
        const next = Math.min(floor, Math.max(Math.max(viewWidth * factor, 64), 64))
        if (next >= floor) {
          setZoom(null)
          return
        }
        const center = (view[0] + view[1]) / 2
        let start = center - next / 2
        start = Math.min(Math.max(0, start), floor - next)
        setZoom([start, start + next])
      }
      const offsetAt = (event) => {
        const box = barRef.current === null ? null : barRef.current.getBoundingClientRect()
        if (box === null || box === undefined || box.width === 0) return null
        const ratio = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width))
        return view[0] + ratio * viewWidth
      }

      const beginDrag = (event) => {
        const offset = offsetAt(event)
        if (offset === null) return
        // 不用 setPointerCapture：一旦捕获，pointerup 会被重定向到条带容器，
        // 浏览器算出的 click 目标就不是色块，点选会整体失效。改成临时挂 window。
        dragRef.current = { anchor: offset, x: event.clientX, moved: false }
        const onMove = (moveEvent) => {
          const state = dragRef.current
          if (state === null) return
          if (Math.abs(moveEvent.clientX - state.x) > 3) state.moved = true
          const next = offsetAt(moveEvent)
          if (next === null) return
          if (state.moved) setBrush({ from: state.anchor, to: next })
        }
        const onUp = (upEvent) => {
          window.removeEventListener('pointermove', onMove)
          window.removeEventListener('pointerup', onUp)
          window.removeEventListener('pointercancel', onUp)
          endDrag(upEvent)
        }
        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', onUp)
        window.addEventListener('pointercancel', onUp)
      }

      const endDrag = (event) => {
        const state = dragRef.current
        dragRef.current = null
        if (state === null) return
        if (!state.moved) {
          // 没动：这是一次点击，交给色块的 onClick 去选。
          setBrush(null)
          return
        }
        const offset = offsetAt(event)
        const to = offset === null ? state.anchor : offset
        draggedRef.current = true
        // 框住的那块留在带子上，用户能一直看到自己选了哪儿。
        setBrush({ from: state.anchor, to })
        const next = resolveBrush(state.anchor, to)
        setPicked(next.range === null ? null : `${next.range.start}-${next.range.end}`)
        setDetail(next)
      }

      // 点/框之后就地展开：这几段到底是哪几个节点、能折哪一段。
      const detailBody = (current) => {
        const anchor = current.range
        const start = anchor === null ? current.start : anchor.start
        const end = anchor === null ? current.end : anchor.end
        // 按 seq 判定，不按 token 偏移：折叠出的检查点会插回它原来的旧位置，
        // 数组顺序并不随 seq 单调，用 from/to 过滤会在首尾颠倒时全军覆没（详情卡一片空白）。
        const lo = Math.min(Number(start), Number(end))
        const hi = Math.max(Number(start), Number(end))
        const inside = Number.isFinite(lo) && Number.isFinite(hi) ? spans.filter((span) => span.seq >= lo && span.seq <= hi) : []
        return h(
          'div',
          { className: 'ccc-detail' },
          h(
            'div',
            { className: 'ccc-detail-head' },
            h('span', { className: 'ccc-detail-title' }, `#${formatNum(start)}–#${formatNum(end)}`),
            h('span', null, `${formatNum(current.nodes)} 节点 · ${formatNum(current.tokens)} token`),
            anchor === null || current.nodes === anchor.nodes ? null : h('span', { className: 'ccc-detail-tag' }, `其中可折 ${formatNum(anchor.nodes)} 节点`),
            h(
              'button',
              {
                type: 'button',
                className: 'ccc-btn ccc-btn-ghost ccc-detail-close',
                onClick: () => {
                  setDetail(null)
                  setPicked(null)
                },
              },
              '关闭',
            ),
          ),
          inside.length === 0
            ? h(
                'div',
                { className: 'ccc-detail-empty' },
                '这段节点在当前快照里没有明细（快照可能已过期，或端点跨越了别的会话）。点右上角 ↻ 刷新后再试。',
              )
            : h(
                'div',
                { className: 'ccc-detail-list' },
                inside.slice(0, listOpen ? inside.length : 4).map((span) => {
                  const open = expandedSeq === span.seq
                  const body = texts[span.seq]
                  return h(
                    'div',
                    { key: `d-${span.seq}`, className: `ccc-detail-node${open ? ' is-open' : ''}` },
                    h(
                      'div',
                      {
                        className: 'ccc-detail-row',
                        onClick: () => (open ? setExpandedSeq(null) : openNode(span.seq)),
                        title: open ? '点击收起' : '点击展开完整原文',
                      },
                      h('span', { className: 'ccc-detail-seq' }, `#${formatNum(span.seq)}`),
                      h('span', { className: 'ccc-detail-kind' }, kindLabel(span.node.kind)),
                      h('span', { className: 'ccc-detail-tok' }, formatNum(span.tokens)),
                      h('span', { className: 'ccc-detail-preview' }, String(span.node.preview ?? '')),
                    ),
                    open
                      ? h(
                          'pre',
                          { className: `ccc-detail-full${loadingSeq === span.seq ? ' is-loading' : ''}` },
                          loadingSeq === span.seq ? '读取中…' : (String(body ?? '').trim() === ''
                            ? '（该节点没有可展示的纯文本：只有工具调用或结构化内容，原文不在文本通道里。）'
                            : String(body)),
                        )
                      : null,
                  )
                }),
                inside.length > 4
                  ? h(
                      'div',
                      { className: 'ccc-detail-more' },
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'ccc-linkbtn',
                          onClick: () => setListOpen((prev) => !prev),
                        },
                        listOpen ? '收起其余节点' : `展开其余 ${formatNum(inside.length - 4)} 个节点`,
                      ),
                    )
                  : null,
              ),
          h(
            'div',
            { className: 'ccc-actions', style: { marginTop: 2 } },
            h(
              'span',
              { className: 'ccc-actions-info' },
              anchor === null
                ? `选中 ${formatNum(current.nodes)} 节点 · ${formatNum(current.tokens)} token`
                : `可整段折叠 · ${formatNum(anchor.tokens)} token`,
            ),
            anchor === null
              ? h('span', { className: 'ccc-actions-info', style: { opacity: 0.7 } }, '单节点无法整段折叠，交给模型判断')
              : h(
                  'button',
                  {
                    type: 'button',
                    className: 'ccc-btn ccc-btn-strong',
                    disabled: props.busy,
                    onClick: () => props.onFold({ start: anchor.start, end: anchor.end }),
                  },
                  props.folding === `${anchor.start}-${anchor.end}` ? '折叠中…' : '折叠这段',
                ),
            h(
              'button',
              { type: 'button', className: 'ccc-btn', disabled: props.busy, onClick: () => props.onAsk({ start, end }) },
              '交给模型',
            ),
          ),
        )
      }

      return h(
        'div',
        { className: 'ccc-map', ref: mapRef },
        h(
          'div',
          { className: 'ccc-map-head' },
          h(
            'span',
            null,
            `上下文地图 · 已用 ${formatNum(used > 0 ? used : occupied)} token` +
              (overhead > 0 ? `（节点 ${formatNum(occupied)} · 开销 ${formatNum(overhead)}）` : ''),
          ),
          h(
            'span',
            { className: 'ccc-map-tools' },
            h('span', { className: 'ccc-map-count' }, `${ranges.length} 段可折 · 滚轮缩放`),
            zoom === null ? null : h('span', { className: 'ccc-map-scale' }, `${Math.round((viewWidth / floor) * 100)}%`),
            zoom === null
              ? null
              : h('button', { type: 'button', className: 'ccc-mini', title: '回到全览', onClick: () => setZoom(null) }, '全览'),
          ),
        ),
        h(
          'div',
          {
            className: 'ccc-map-bar',
            ref: barRef,
            onPointerDown: beginDrag,
          },
          segs.map((seg) => {
            const lo = Math.max(seg.from, view[0])
            const hi = Math.min(seg.to, view[1])
            if (hi <= lo) return null
            const rangeKey = seg.range === null ? null : `${seg.range.start}-${seg.range.end}`
            const on = rangeKey !== null && rangeKey === activeKey
            const width = ((hi - lo) / viewWidth) * 100
            const isOverhead = seg.overhead === true
            // 每个节点都能点：是否可折是压缩策略的判断，不该写进地图的交互里。
            // 点一个节点 = 摊开它所在的那一段（没有段就只摊开它自己）。
            // 开销段不是节点，点它没有意义，只给个说明。
            if (isOverhead) {
              return h('div', {
                key: 'seg-overhead',
                className: 'ccc-seg is-overhead',
                style: {
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  left: `${pctOfOffset(lo)}%`,
                  width: `calc(${width}% - 1px)`,
                  minWidth: 1,
                },
                title: `系统提示词、工具定义等非节点开销 · ${formatNum(seg.tokens)} token`,
              })
            }
            return h('div', {
              key: `seg-${seg.seq}`,
              className:
                'ccc-seg is-node' +
                (seg.keep ? ' is-keep' : '') +
                (on ? ' is-on' : '') +
                (hoverKey !== null && seg.key === hoverKey ? ' is-group' : ''),
              style: {
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: `${pctOfOffset(lo)}%`,
                width: `calc(${width}% - 1px)`,
                minWidth: 1,
              },
              title:
                seg.range === null
                  ? `#${formatNum(seg.seq)} · ${formatNum(seg.tokens)} token${seg.keep ? ' · 尾部保留' : ''}`
                  : `#${formatNum(seg.seq)} · ${formatNum(seg.tokens)} token · 段 #${seg.range.start}–#${seg.range.end}`,
              onMouseEnter: () => setHoverKey(seg.key),
              onMouseLeave: () => setHoverKey(null),
              onClick: () => {
                // 拖框结束会跟一个 click，别把它当成点选。
                if (draggedRef.current) {
                  draggedRef.current = false
                  return
                }
                setBrush(null)
                if (seg.range !== null) {
                  if (on) {
                    setPicked(null)
                    setDetail(null)
                    return
                  }
                  setPicked(rangeKey)
                  setDetail({
                    range: seg.range,
                    start: seg.range.start,
                    end: seg.range.end,
                    tokens: seg.range.tokens,
                    nodes: seg.range.nodes,
                  })
                  return
                }
                setPicked(null)
                setDetail({ range: null, start: seg.seq, end: seg.seq, tokens: seg.tokens, nodes: 1 })
              },
            })
          }),
          brush === null
            ? null
            : h('div', {
                className: 'ccc-brush',
                style: {
                  left: `${pctOfOffset(Math.min(brush.from, brush.to))}%`,
                  width: `${(Math.abs(brush.to - brush.from) / viewWidth) * 100}%`,
                },
              }),
          thresholdOffset >= 0 && thresholdOffset <= 100
            ? h(
                'div',
                { className: 'ccc-map-th', style: { left: `${thresholdOffset}%` } },
                h('span', { className: 'ccc-map-th-label' }, `${formatNum(threshold)}%`),
              )
            : null,
        ),
        h(
          'div',
          { className: 'ccc-map-legend' },
          h('span', null, h('span', { className: 'ccc-dot' }), '节点'),
          h('span', null, h('span', { className: 'ccc-dot is-keep' }), '尾部保留'),
          h('span', null, h('span', { className: 'ccc-dot is-overhead' }), '系统/工具开销'),
          h('span', null, '色块宽度 = token 占比（整条 = 整个窗口）'),
        ),
        detail === null
          ? selection === null
            ? null
            : h(
                'div',
                { className: 'ccc-actions', style: { marginTop: 0, borderTop: 'none', paddingTop: 0 } },
                h(
                  'span',
                  { className: 'ccc-actions-info' },
                  `${activeRange === null ? '选中' : '建议'}：#${formatNum(selection.start)}–#${formatNum(selection.end)} · ${formatNum(selection.nodes)} 节点 · ${formatNum(activeTokens)} token`,
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'ccc-btn ccc-btn-strong',
                    disabled: props.busy,
                    onClick: () => props.onFold({ start: selection.start, end: selection.end }),
                  },
                  props.folding === activeKey ? '折叠中…' : '折叠建议区间',
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'ccc-btn',
                    disabled: props.busy,
                    onClick: () => props.onAsk({ start: selection.start, end: selection.end }),
                  },
                  '交给模型',
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'ccc-btn ccc-btn-ghost',
                    onClick: () =>
                      setDetail({
                        range: activeRange,
                        start: selection.start,
                        end: selection.end,
                        tokens: selection.tokens,
                        nodes: selection.nodes,
                      }),
                  },
                  '看明细',
                ),
              )
          : detailBody(detail),
      )
    }


    function ErrorBanner(props) {
      const message = props.message
      const noSession = message.includes('找不到活跃会话')
      return h(
        'div',
        { className: 'ccc-error', role: 'alert' },
        h('div', { className: 'ccc-error-text' }, message),
        noSession ? h('div', { className: 'ccc-error-hint' }, '面板只对正在运行的会话有效') : null,
        h('button', { type: 'button', className: 'ccc-btn ccc-btn-ghost', onClick: props.onRetry }, '重试'),
      )
    }

    /**
     * 兜住面板内部的渲染异常：没有它，任何一处抛错都会把整个右侧栏一起卸掉，
     * 表现就是「一闪而过、然后空白」。出错时把原文摊在面板上，好定位。
     */
    class PanelBoundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { failure: null }
      }
      static getDerivedStateFromError(failure) {
        return { failure }
      }
      render() {
        if (this.state.failure !== null) {
          return h(
            'div',
            { className: 'ccc' },
            h(ErrorBanner, {
              message: '面板渲染出错：' + errorText(this.state.failure),
              onRetry: () => this.setState({ failure: null }),
            }),
            h('div', { style: { fontSize: 11, opacity: 0.65, whiteSpace: 'pre-wrap' } }, String(this.state.failure?.stack ?? '').slice(0, 1200)),
          )
        }
        return this.props.children
      }
    }

    /**
     * 一张工作表：区间是父行（可展开成节点子行），像 Excel 一样支持排序、
     * 筛选、多选、区间端点单元格编辑、列宽拖动和键盘导航。
     */
    function Sheet(props) {
      const ranges = Array.isArray(props.ranges) ? props.ranges : []
      const nodes = Array.isArray(props.nodes) ? props.nodes : []
      const windowTokens = Number(props.windowTokens) > 0 ? Number(props.windowTokens) : 0

      const [query, setQuery] = React.useState('')
      const [kind, setKind] = React.useState('all')
      const [minTok, setMinTok] = React.useState('')
      const [hideKeep, setHideKeep] = React.useState(false)
      const [sort, setSort] = React.useState({ key: 'start', dir: 1 })
      const [view, setView] = React.useState('ranges')
      const [expanded, setExpanded] = React.useState({})
      const [selected, setSelected] = React.useState({})
      const [edit, setEdit] = React.useState(null)
      const [draft, setDraft] = React.useState('')
      const [spans, setSpans] = React.useState({})
      const [cursor, setCursor] = React.useState({ row: -1, col: 1 })
      const [colw, setColw] = React.useState({ sel: 34, start: 76, end: 76, kind: 86, count: 50, tok: 62, pct: 54, preview: 200 })
      const dragRef = React.useRef(null)

      const kinds = Array.from(new Set(nodes.map((node) => String(node.kind ?? 'node')))).sort()
      const needle = query.trim().toLowerCase()
      const minTokens = minTok.trim() === '' ? null : Number(minTok)

      const spanOf = (range) => spans[`${range.start}-${range.end}`] ?? { start: range.start, end: range.end }

      const rowTokens = (row) => (row.type === 'range' ? row.tokens : row.node?.tokens ?? 0)
      const labelOf = (row) => (row.type === 'range' ? '区间' : kindLabel(row.node?.kind))

      const rangeRows = ranges.map((range) => {
        const span = spanOf(range)
        const children = nodes
          .filter((node) => node.seq >= span.start && node.seq <= span.end)
          .map((node) => ({
            key: `c-${range.start}-${range.end}-${node.seq}-${node.index}`,
            type: 'node',
            node,
            seq: node.seq,
            tokens: node.tokens ?? 0,
            text: `${node.seq} ${kindLabel(node.kind)} ${node.tokens ?? 0} ${node.keep ? '保留' : ''} ${typeof node.preview === 'string' ? node.preview : ''}`,
          }))
        const edited = spans[`${range.start}-${range.end}`] !== undefined
        const tokens = edited ? children.reduce((sum, child) => sum + (child.tokens ?? 0), 0) : range.tokens
        return {
          key: `r-${range.start}-${range.end}`,
          type: 'range',
          range,
          span,
          edited,
          tokens,
          seq: span.start,
          count: children.length,
          children,
          text: `区间 ${span.start} ${span.end} ${children.length} ${tokens}`,
        }
      })

      const nodeRows = nodes.map((node) => ({
        key: `n-${node.seq}-${node.index}`,
        type: 'node',
        node,
        seq: node.seq,
        tokens: node.tokens ?? 0,
        count: 1,
        text: `${node.seq} ${kindLabel(node.kind)} ${node.tokens ?? 0} ${node.keep ? '保留' : ''} ${typeof node.preview === 'string' ? node.preview : ''}`,
      }))

      const matches = (row) => needle.length === 0 || row.text.toLowerCase().includes(needle)
      const kindOk = (row) => {
        if (kind === 'all') return true
        if (kind === 'range') return row.type === 'range'
        if (kind === 'keep') return row.type === 'node' && row.node?.keep === true
        return row.type === 'node' && String(row.node?.kind ?? 'node') === kind
      }
      const tokOk = (row) => minTokens === null || !Number.isFinite(minTokens) || rowTokens(row) >= minTokens
      const keepOk = (row) => !hideKeep || !(row.type === 'node' && row.node?.keep === true)

      const passes = (row) => matches(row) && kindOk(row) && tokOk(row) && keepOk(row)

      const cmp = (a, b) => {
        let va
        let vb
        if (sort.key === 'start' || sort.key === 'seq') {
          va = a.seq
          vb = b.seq
        } else if (sort.key === 'tok' || sort.key === 'pct') {
          va = rowTokens(a)
          vb = rowTokens(b)
        } else if (sort.key === 'count') {
          va = a.count ?? 0
          vb = b.count ?? 0
        } else {
          va = labelOf(a)
          vb = labelOf(b)
        }
        if (va < vb) return -sort.dir
        if (va > vb) return sort.dir
        return 0
      }

      const parentRows = rangeRows.filter(passes).sort(cmp)
      const flatRows = nodeRows.filter(passes).sort(cmp)

      const lines = []
      if (view === 'ranges') {
        for (const row of parentRows) {
          lines.push({ row, depth: 0 })
          if (expanded[row.key] === true) {
            for (const child of row.children.filter(passes).sort(cmp)) lines.push({ row: child, depth: 1 })
          }
        }
      } else {
        for (const row of flatRows) lines.push({ row, depth: 0 })
      }
      const visible = lines.slice(0, MAX_NODE_ROWS)
      const overflow = lines.length - visible.length

      const selectedLines = visible.filter((line) => selected[line.row.key] === true)
      const selTokens = selectedLines.reduce((sum, line) => sum + rowTokens(line.row), 0)
      const selNodes = selectedLines.reduce((sum, line) => sum + (line.row.type === 'range' ? line.row.count : 1), 0)
      const allSelected = visible.length > 0 && visible.every((line) => selected[line.row.key] === true)

      const toggle = (key) =>
        setSelected((prev) => {
          const next = { ...prev }
          if (next[key] === true) delete next[key]
          else next[key] = true
          return next
        })
      const toggleAll = () => {
        if (allSelected) return setSelected({})
        const next = {}
        for (const line of visible) next[line.row.key] = true
        return setSelected(next)
      }

      /** 点行即选中整行；按住 Ctrl/⌘/Shift 追加。行内不再放按钮。 */
      const selectRow = (row, event) => {
        const additive = event !== undefined && (event.ctrlKey === true || event.metaKey === true || event.shiftKey === true)
        if (!additive) return setSelected({ [row.key]: true })
        return toggle(row.key)
      }

      const beginEdit = (row, field) => {
        setEdit({ key: row.key, field, start: row.span.start, end: row.span.end })
        setDraft(String(row.span[field]))
      }
      const commit = () => {
        if (edit === null) return
        const base = spans[edit.key] ?? { start: edit.start, end: edit.end }
        const value = Number(String(draft).trim())
        const next = { start: base.start, end: base.end }
        next[edit.field] = value
        if (!Number.isInteger(value) || next.start >= next.end) {
          setEdit({ ...edit, bad: true })
          return
        }
        setSpans((prev) => ({ ...prev, [edit.key]: next }))
        setEdit(null)
        setDraft('')
      }
      const cancelEdit = () => {
        setEdit(null)
        setDraft('')
      }

      const startResize = (colKey, event) => {
        event.preventDefault()
        event.stopPropagation()
        dragRef.current = { col: colKey, x: event.clientX, w: colw[colKey] ?? 80 }
        const move = (moveEvent) => {
          const drag = dragRef.current
          if (drag === null) return
          const width = Math.max(28, Math.min(520, drag.w + (moveEvent.clientX - drag.x)))
          setColw((prev) => ({ ...prev, [drag.col]: width }))
        }
        const up = () => {
          dragRef.current = null
          window.removeEventListener('mousemove', move)
          window.removeEventListener('mouseup', up)
        }
        window.addEventListener('mousemove', move)
        window.addEventListener('mouseup', up)
      }

      /** 选中的行合成一个 seq 区间：区间行取起止，节点行取自身。 */
      const spanOfSelection = () => {
        const seqs = []
        for (const line of selectedLines) {
          if (line.row.type === 'range') seqs.push(line.row.span.start, line.row.span.end)
          else seqs.push(line.row.seq)
        }
        if (seqs.length === 0) return null
        return { start: Math.min(...seqs), end: Math.max(...seqs) }
      }

      const foldSelection = async () => {
        const span = spanOfSelection()
        if (span === null || props.busy) return
        await props.onFold(span)
      }

      /** 只对区间行开编辑：节点行没有端点。 */
      const editSelection = () => {
        const line = selectedLines.find((item) => item.row.type === 'range')
        if (line !== undefined) beginEdit(line.row, 'start')
      }

      const selectionSpan = spanOfSelection()
      const foldLabel =
        selectionSpan === null
          ? '折叠这一段'
          : props.folding === `${selectionSpan.start}-${selectionSpan.end}`
            ? '折叠中…'
            : `折叠 #${formatNum(selectionSpan.start)}–#${formatNum(selectionSpan.end)}`

      const COLS = [
        { key: 'sel', label: '', sortable: false, align: 'center' },
        { key: 'start', label: '起', sortable: true, align: 'right' },
        { key: 'end', label: '止', sortable: true, align: 'right' },
        { key: 'kind', label: '类型', sortable: true, align: 'left' },
        { key: 'count', label: '节点', sortable: true, align: 'right' },
        { key: 'tok', label: 'token', sortable: true, align: 'right' },
        { key: 'pct', label: '占比', sortable: true, align: 'right' },
        { key: 'preview', label: '预览', sortable: false, align: 'left' },
      ]
      const template = COLS.map((col) =>
        col.key === 'preview' ? `minmax(${colw.preview ?? 200}px,1fr)` : `${colw[col.key] ?? 80}px`,
      ).join(' ')
      const rowStyle = { gridTemplateColumns: template, width: 'max-content', minWidth: '100%' }
      const headStyle = rowStyle

      const sortHeader = (colKey) =>
        setSort((prev) => (prev.key === colKey ? { key: colKey, dir: prev.dir === 1 ? -1 : 1 } : { key: colKey, dir: 1 }))

      const cellClass = (col) => `ccc-cell ccc-${col.key} ccc-al-${col.align}`

      const onKeyDown = (event) => {
        if (edit !== null || visible.length === 0) return
        const current = Math.max(0, cursor.row)
        const move = (row, col) => {
          setCursor({ row: Math.max(0, Math.min(visible.length - 1, row)), col: Math.max(0, Math.min(COLS.length - 1, col)) })
        }
        if (event.key === 'ArrowDown') {
          event.preventDefault()
          move(current + 1, cursor.col)
        } else if (event.key === 'ArrowUp') {
          event.preventDefault()
          move(current - 1, cursor.col)
        } else if (event.key === 'ArrowRight') {
          event.preventDefault()
          move(current, cursor.col + 1)
        } else if (event.key === 'ArrowLeft') {
          event.preventDefault()
          move(current, cursor.col - 1)
        } else if (event.key === 'Enter') {
          event.preventDefault()
          move(current, cursor.col)
          const line = visible[current]
          if (line.row.type === 'range' && (cursor.col === 1 || cursor.col === 2)) beginEdit(line.row, cursor.col === 1 ? 'start' : 'end')
        } else if (event.key === ' ') {
          event.preventDefault()
          toggle(visible[current].row.key)
        }
      }

      const renderRange = (row, depth) => {
        const span = row.span
        const isEditing = edit !== null && edit.key === row.key
        const childrenShown = expanded[row.key] === true
        const selectedHere = selected[row.key] === true
        const cellValue = (field) => (isEditing && edit.field === field ? null : formatNum(span[field]))
        const cellInput = (field) =>
          isEditing && edit.field === field
            ? h('input', {
                className: 'ccc-input ccc-cell-input' + (edit.bad ? ' is-bad' : ''),
                value: draft,
                autoFocus: true,
                onChange: (item) => setDraft(item.target.value),
                onKeyDown: (item) => {
                  if (item.key === 'Enter') {
                    item.preventDefault()
                    commit()
                  } else if (item.key === 'Escape') {
                    item.preventDefault()
                    cancelEdit()
                  }
                },
                onBlur: commit,
                onClick: (item) => item.stopPropagation(),
              })
            : null
        const cellProps = (field) => ({
          onDoubleClick: (event) => {
            event.stopPropagation()
            beginEdit(row, field)
          },
          title: '双击改起止',
        })
        return h(
          'div',
          {
            className: 'ccc-line ccc-tr ccc-row is-range' + (selectedHere ? ' is-selected' : ''),
            key: row.key,
            style: rowStyle,
            onClick: (event) => selectRow(row, event),
          },
          h(
            'div',
            { className: cellClass(COLS[0]) },
            h('input', { type: 'checkbox', className: 'ccc-cbox', checked: selectedHere, onChange: () => toggle(row.key), onClick: (event) => event.stopPropagation() }),
            h(
              'button',
              {
                type: 'button',
                className: 'ccc-arrow',
                onClick: (event) => {
                  event.stopPropagation()
                  setExpanded((prev) => ({ ...prev, [row.key]: prev[row.key] !== true }))
                },
                title: childrenShown ? '折叠子行' : '展开子行',
              },
              childrenShown ? '▾' : '▸',
            ),
          ),
          h('div', { className: cellClass(COLS[1]) + (isEditing && edit.field === 'start' ? ' is-edit' : ''), ...cellProps('start') }, cellValue('start'), cellInput('start')),
          h('div', { className: cellClass(COLS[2]) + (isEditing && edit.field === 'end' ? ' is-edit' : ''), ...cellProps('end') }, cellValue('end'), cellInput('end')),
          h('div', { className: cellClass(COLS[3]) }, labelOf(row), row.edited ? h('span', { className: 'ccc-badge' }, '改') : null),
          h('div', { className: cellClass(COLS[4]) }, formatNum(row.count)),
          h('div', { className: cellClass(COLS[5]) }, formatNum(row.tokens)),
          h('div', { className: cellClass(COLS[6]) }, windowTokens > 0 ? `${((row.tokens / windowTokens) * 100).toFixed(1)}%` : '—'),
          h('div', { className: cellClass(COLS[7]) }, h('span', { className: 'ccc-preview' }, `覆盖 ${formatNum(row.count)} 个节点`)),
        )
      }

      const renderNode = (row, depth) => {
        const node = row.node
        const selectedHere = selected[row.key] === true
        return h(
          'div',
          {
            className: 'ccc-line ccc-tr ccc-row is-node' + (node.keep ? ' is-keep' : '') + (selectedHere ? ' is-selected' : ''),
            key: row.key,
            style: rowStyle,
            onClick: (event) => selectRow(row, event),
          },
          h('div', { className: cellClass(COLS[0]) },
            h('input', { type: 'checkbox', className: 'ccc-cbox', checked: selectedHere, onChange: () => toggle(row.key), onClick: (event) => event.stopPropagation() }),
            depth > 0 ? h('span', { className: 'ccc-indent' }, '└') : null,
          ),
          h('div', { className: cellClass(COLS[1]) }, formatNum(node.seq)),
          h('div', { className: cellClass(COLS[2]) }, ''),
          h('div', { className: cellClass(COLS[3]) }, kindLabel(node.kind), node.keep ? h('span', { className: 'ccc-badge ccc-badge-keep' }, '保留') : null),
          h('div', { className: cellClass(COLS[4]) }, '1'),
          h('div', { className: cellClass(COLS[5]) }, formatNum(node.tokens)),
          h('div', { className: cellClass(COLS[6]) }, windowTokens > 0 ? `${(((((node.tokens ?? 0)) / windowTokens) * 100).toFixed(1))}%` : '—'),
          h('div', { className: cellClass(COLS[7]), title: String(node.preview ?? '') }, h('span', { className: 'ccc-preview' }, typeof node.preview === 'string' ? node.preview : '')),
        )
      }

      return h(
        Card,
        { title: '明细' },
        h(
          'div',
          { className: 'ccc-toolbar' },
          h('input', {
            className: 'ccc-input ccc-input-grow',
            type: 'search',
            placeholder: '筛选：seq / 类型 / 预览',
            value: query,
            onChange: (event) => setQuery(event.target.value),
          }),
          h(
            'select',
            { className: 'ccc-input', value: kind, onChange: (event) => setKind(event.target.value) },
            h('option', { value: 'all' }, '全部类型'),
            h('option', { value: 'range' }, '区间'),
            h('option', { value: 'keep' }, '保留节点'),
            kinds.map((item) => h('option', { key: item, value: item }, kindLabel(item))),
          ),
          h(
            'label',
            { className: 'ccc-check' },
            h('input', { type: 'checkbox', checked: hideKeep, onChange: () => setHideKeep(!hideKeep) }),
            '隐藏保留',
          ),
          h('input', {
            className: 'ccc-input ccc-input-num',
            type: 'number',
            placeholder: '≥token',
            value: minTok,
            onChange: (event) => setMinTok(event.target.value),
          }),
          h(
            'select',
            { className: 'ccc-input', value: view, onChange: (event) => setView(event.target.value) },
            h('option', { value: 'ranges' }, '区间视图'),
            h('option', { value: 'nodes' }, '节点视图'),
          ),
          h('button', { type: 'button', className: 'ccc-btn ccc-btn-ghost', onClick: () => setExpanded(Object.fromEntries(parentRows.map((row) => [row.key, true]))) }, '全部展开'),
          h('button', { type: 'button', className: 'ccc-btn ccc-btn-ghost', onClick: () => setExpanded({}) }, '全部折叠'),
        ),
        h(
          'div',
          { className: 'ccc-sheet', tabIndex: 0, onKeyDown },
          h(
            'div',
            { className: 'ccc-line ccc-tr ccc-th', style: headStyle },
            COLS.map((col) =>
              h(
                'div',
                { key: col.key, className: cellClass(col) + (col.sortable ? ' is-sortable' : ''), onClick: col.sortable ? () => sortHeader(col.key) : undefined },
                col.key === 'sel'
                  ? h('input', { type: 'checkbox', className: 'ccc-cbox', checked: allSelected, onChange: toggleAll, title: '全选可见行' })
                  : col.label,
                col.sortable && sort.key === col.key ? h('span', { className: 'ccc-sort' }, sort.dir === 1 ? ' ▲' : ' ▼') : null,
                h('span', { className: 'ccc-resizer', onMouseDown: (event) => startResize(col.key, event) }),
              ),
            ),
          ),
          h(
            'div',
            { className: 'ccc-body' },
            visible.length === 0
              ? h(Empty, { text: '没有匹配的行（试试清空筛选）' })
              : visible.map((line) => (line.row.type === 'range' ? renderRange(line.row, line.depth) : renderNode(line.row, line.depth))),
            overflow > 0 ? h('div', { className: 'ccc-caption' }, `已截断，另有 ${formatNum(overflow)} 行未渲染`) : null,
          ),
        ),
        selectedLines.length === 0
          ? h('div', { className: 'ccc-caption' }, `共 ${formatNum(lines.length)} 行 · 显示 ${formatNum(visible.length)} 行 · 点一行选中，双击「起/止」可改`)
          : h(
              'div',
              { className: 'ccc-actions' },
              h('span', { className: 'ccc-actions-info' }, `已选 ${formatNum(selNodes)} 节点 · Σ ${formatNum(selTokens)} token`),
              h('button', { type: 'button', className: 'ccc-btn ccc-btn-strong', disabled: props.busy, onClick: foldSelection }, foldLabel),
              h(
                'button',
                {
                  type: 'button',
                  className: 'ccc-btn',
                  disabled: props.busy,
                  onClick: () => {
                    const span = spanOfSelection()
                    if (span !== null) props.onAsk(span)
                  },
                },
                '交给模型',
              ),
              h('button', { type: 'button', className: 'ccc-btn ccc-btn-ghost', disabled: selectedLines.every((line) => line.row.type !== 'range'), onClick: editSelection }, '改起止'),
              h('button', { type: 'button', className: 'ccc-btn ccc-btn-ghost', onClick: () => setSelected({}) }, '取消选择'),
            ),
      )
    }
    /** 最近一次折叠：机械摘要原文 + 省了多少。 */
    function FoldCard(props) {
      const result = props.result
      return h(
        Card,
        { title: '折叠结果' },
        result === null
          ? h(Empty, { text: '还没有折叠过' })
          : h(
              'div',
              { className: 'ccc-fold' },
              h('pre', { className: 'ccc-brief' }, typeof result.brief === 'string' ? result.brief : ''),
              h('div', { className: 'ccc-caption' }, `省了 ${formatNum(result.savedTokens)} token · 替换了 ${formatNum(result.replacedNodes)} 个节点`),
              Number(result.mergedCheckpoints) > 0
                ? h('div', { className: 'ccc-caption' }, `并把 ${formatNum(result.mergedCheckpoints)} 个相邻检查点并了进来，整段只留一层壳`)
                : null,
            ),
        props.prompt.length > 0
          ? h(
              'div',
              { className: 'ccc-fold' },
              h('div', { className: 'ccc-caption' }, '折叠请求（复制给模型，由它写摘要）'),
              h('pre', { className: 'ccc-brief' }, props.prompt),
              h(
                'button',
                {
                  type: 'button',
                  className: 'ccc-btn',
                  onClick: () => {
                    if (typeof navigator !== 'undefined' && navigator.clipboard) navigator.clipboard.writeText(props.prompt)
                  },
                },
                '复制',
              ),
            )
          : null,
        props.note.length > 0 ? h('div', { className: 'ccc-note' }, props.note) : null,
      )
    }


    /** 面板主体：一次快照 + 两个动作。 */
    function Panel(props) {
      const sessionId = typeof props?.sessionId === 'string' ? props.sessionId : ''
      const hasSession = sessionId.length > 0

      const [snapshot, setSnapshot] = React.useState(null)
      const [error, setError] = React.useState(null)
      const [loading, setLoading] = React.useState(false)
      const [folding, setFolding] = React.useState(null)
      const [asking, setAsking] = React.useState(null)
      const [result, setResult] = React.useState(null)
      const [note, setNote] = React.useState('')
      const [prompt, setPrompt] = React.useState('')
      const [selected, setSelected] = React.useState(null)
      const [savingThreshold, setSavingThreshold] = React.useState(false)
      const [thresholdNote, setThresholdNote] = React.useState('')
      const [view, setView] = React.useState('map')
      // 已经结束的会话没有 surface，宿主会说「找不到活跃会话」。那不是故障，是正常状态，
      // 单独记一个标记，好在面板里平静地说明，而不是拍一个红色错误横幅。
      const [gone, setGone] = React.useState(false)

      // 静默刷新不动「读取中…」，否则 8 秒闪一次字。
      const loadState = React.useCallback(
        async (silent) => {
          if (!hasSession) return
          if (!silent) setLoading(true)
          try {
            const next = await request(`${STATE_URL}?sessionId=${encodeURIComponent(sessionId)}`, undefined, FETCH_TIMEOUT_MS)
            if (isFailure(next)) {
              const text = errorText(next.error)
              if (text.includes('找不到活跃会话')) {
                setGone(true)
                setError(null)
              } else {
                setError(text)
                setGone(false)
              }
            } else {
              setSnapshot(next)
              setError(null)
              setGone(false)
            }
          } catch (failure) {
            setError(errorText(failure))
          } finally {
            if (!silent) setLoading(false)
          }
        },
        [hasSession, sessionId],
      )

      React.useEffect(() => {
        if (!hasSession) return undefined
        loadState(false)
        const timer = setInterval(() => {
          // 面板不可见时不发请求，省掉看不见的轮询。
          if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
          loadState(true)
        }, REFRESH_INTERVAL_MS)
        return () => clearInterval(timer)
      }, [hasSession, loadState])

      const foldSpan = async (range) => {
        const key = `${range.start}-${range.end}`
        setFolding(key)
        setError(null)
        try {
          const body = JSON.stringify({ sessionId, start: Number(range.start), end: Number(range.end) })
          const next = await request(FOLD_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body }, FOLD_TIMEOUT_MS)
          if (isFailure(next)) {
            setError(next.error)
          } else {
            setResult(next)
            setNote('')
            if (next?.snapshot !== undefined && next?.snapshot !== null) setSnapshot(next.snapshot)
            else await loadState(true)
          }
        } catch (failure) {
          setError(errorText(failure))
        } finally {
          setFolding(null)
        }
      }

      const askSpan = async (range) => {
        const key = range === null || range === undefined ? 'self' : `${range.start}-${range.end}`
        setAsking(key)
        setError(null)
        try {
          const payload = { sessionId }
          if (range !== null && range !== undefined) {
            payload.start = Number(range.start)
            payload.end = Number(range.end)
          }
          const body = JSON.stringify(payload)
          const next = await request(ASK_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body }, FETCH_TIMEOUT_MS)
          if (isFailure(next)) setError(next.error)
          else {
            setPrompt(typeof next?.instruction === 'string' ? next.instruction : '')
            setNote(typeof next?.note === 'string' ? next.note : '已生成折叠请求。')
          }
        } catch (failure) {
          setError(errorText(failure))
        } finally {
          setAsking(null)
        }
      }

      const saveConfig = async (patch, done) => {
        setSavingThreshold(true)
        setThresholdNote('')
        try {
          const body = JSON.stringify(patch)
          const next = await request(CONFIG_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body }, FETCH_TIMEOUT_MS)
          if (isFailure(next)) setThresholdNote(next.error)
          else {
            setThresholdNote(done ?? '已保存')
            await loadState(true)
          }
        } catch (failure) {
          setThresholdNote(errorText(failure))
        } finally {
          setSavingThreshold(false)
        }
      }

      const saveThreshold = (value) => saveConfig({ promptThresholdPct: Number(value) }, `已保存，阈值 ${Math.round(Number(value))}%`)
      const saveAction = (value) =>
        saveConfig(
          { triggerAction: String(value) },
          String(value) === 'fold' ? '已切到自动折叠建议区间' : String(value) === 'off' ? '已关闭触发提示' : '已切到提示模型自己决定',
        )
      const saveTemplate = (value) => saveConfig({ injectTemplate: String(value) }, '注入文案已保存')

      if (!hasSession) {
        return h('div', { className: 'ccc' }, h(Empty, { text: '没有活跃会话' }))
      }

      if (gone) {
        return h(
          'div',
          { className: 'ccc' },
          h(Empty, { text: '这个会话已经结束，面板只统计正在运行的会话。切换到正在运行的会话就能看到数据。' }),
        )
      }

      const ranges = Array.isArray(snapshot?.ranges) ? snapshot.ranges : []
      const nodes = Array.isArray(snapshot?.nodes) ? snapshot.nodes : []
      const busy = folding !== null || asking !== null
      const recommended = snapshot?.recommended ?? null
      const recommendedRange =
        recommended === null ? null : (ranges.find((range) => range.start === recommended.start && range.end === recommended.end) ?? null)
      const recommendedTokens = recommendedRange === null ? 0 : Number(recommendedRange.tokens) || 0
      const recommendedNodes = recommendedRange === null ? 0 : Number(recommendedRange.nodes) || 0

      return h(
        'div',
        { className: 'ccc' },
        h(
          'div',
          { style: { fontSize: 11, opacity: 0.6 } },
          `诊断 ${props?.sessionId ? String(props.sessionId).slice(-8) : '无会话'} · 快照 ${
            snapshot === null ? '未到' : `${nodes.length} 节点/${ranges.length} 段`
          } · 视图 ${view}${error === null ? '' : ' · 有错'}`,
        ),
        error === null ? null : h(ErrorBanner, { message: error, onRetry: () => loadState(false) }),
        h(Hero, {
          snapshot,
          loading,
          recommended,
          recommendedTokens,
          recommendedNodes,
          folding,
          busy,
          note: thresholdNote,
          action: snapshot?.triggerAction,
          template: snapshot?.injectTemplate,
          prompt,
          asking: asking !== null,
          onRefresh: () => loadState(false),
          onSaveThreshold: saveThreshold,
          onSaveAction: saveAction,
          onSaveTemplate: saveTemplate,
          onAsk: askSpan,
          onFold: foldSpan,
        }),
        h(
          'div',
          { className: 'ccc-viewbar' },
          h(
            'button',
            { type: 'button', className: 'ccc-viewbtn' + (view === 'map' ? ' is-on' : ''), onClick: () => setView('map') },
            '地图',
          ),
          h(
            'button',
            { type: 'button', className: 'ccc-viewbtn' + (view === 'list' ? ' is-on' : ''), onClick: () => setView('list') },
            '列表',
          ),
          h('span', { className: 'ccc-viewstat' }, `${formatNum(ranges.length)} 段 · ${formatNum(nodes.length)} 节点`),
        ),
        view === 'map'
          ? h(ContextMap, {
              nodes,
              ranges,
              windowTokens: snapshot?.windowTokens,
              usedTokens: snapshot?.tokens,
              thresholdPct: snapshot?.promptThresholdPct,
              recommended,
              folding,
              busy,
              sessionId,
              onFold: foldSpan,
              onAsk: askSpan,
            })
          : h(Sheet, {
              ranges,
              nodes,
              windowTokens: snapshot?.windowTokens,
              folding,
              asking,
              busy,
              onFold: foldSpan,
              onAsk: askSpan,
            }),
        h(FoldCard, { result, note, prompt }),
      )
    }
    //#endregion

    //#region 插件
    /** 需要浏览器端的两个服务：槽位和右侧栏 tab 注册表。 */
    const inject = ['slots', 'sidebarRightTabs']

    /** 贡献「上下文」tab 类型、它的 body 和标题。 */
    function apply(ctx) {
      injectStyles()

      const registerType = () =>
        ctx.sidebarRightTabs.register({
          id: TAB_ID,
          kind: TAB_KIND,
          priority: 'extension',
          title: () => TAB_TITLE,
          guide: [
            {
              id: 'context-compact',
              order: 72,
              title: () => TAB_TITLE,
              description: () => '看 token 占用与可折叠区间，一键折叠（不花模型 token）。',
            },
          ],
        })

      if (typeof ctx.effect === 'function') ctx.effect(registerType, 'context-compact-panel: tab type')
      else registerType()

      const registerBody = () =>
        ctx.slots.inject('sidebar.right.pane.tab', () =>
          ctx.slots.register(
            { name: 'sidebar.right.pane.tab', key: TAB_ID },
            function ContextCompactPanelBody(props) {
              return h(PanelBoundary, null, h(Panel, { sessionId: props?.sessionId }))
            },
          ),
        )

      const registerTitle = () =>
        ctx.slots.inject('sidebar.right.pane.tab.title', () =>
          ctx.slots.register(
            { name: 'sidebar.right.pane.tab.title', key: TAB_ID },
            function ContextCompactPanelTitle() {
              return h('span', null, TAB_TITLE)
            },
          ),
        )

      if (typeof ctx.effect === 'function') {
        ctx.effect(registerBody, 'context-compact-panel: tab body')
        ctx.effect(registerTitle, 'context-compact-panel: tab title')
      } else {
        registerBody()
        registerTitle()
      }
    }
    //#endregion

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
