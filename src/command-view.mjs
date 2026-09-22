import { esc } from './html.mjs';
import { sourceKey } from './source-map.mjs';
import { commandSources } from './command-sources.mjs';
import { commandOptions, isSensitiveOption } from './command-parser.mjs';
import { commandExamples } from './command-flow.mjs';

function formatted(value, name = '') {
  if (isSensitiveOption(name)) return '••••（已隐藏）';
  if (value === undefined) return '开关 / 未提供值';
  if (typeof value === 'object')
    return JSON.stringify(value, (key, item) => (isSensitiveOption(key) ? '••••' : item));
  return String(value);
}

function flowNode(node, data, number) {
  const ref = data.refs[sourceKey(commandSources[node.source])];
  const status = { core: '主链', explicit: '参数启用', conditional: '条件分支' }[node.status];
  return `<button class="command-node ${node.status}" data-command-source="${node.source}" data-command-node="${node.id}" aria-label="查看源码：${esc(node.title)}">
    <span class="command-node-heading">${number === undefined ? '<span class="branch-mark" aria-hidden="true">↳</span>' : `<span class="command-number">${String(number + 1).padStart(2, '0')}</span>`}<strong>${esc(node.title)}</strong><span class="command-status">${status}</span></span>
    <span class="command-reason">${esc(node.why)}</span><span class="command-detail">${esc(node.detail)}</span>
    <span class="command-symbol">${esc(ref.symbol)} <span aria-hidden="true">↗</span></span>
    <span class="command-file">${esc(ref.path)}:${ref.line}</span>
    ${ref.review !== 'baseline' ? '<span class="command-stale">源文件与讲解基准状态待复核</span>' : ''}
  </button>`;
}

export function commandView(state, data) {
  const { draft, analysis, phase, cursor, kind } = state;
  const dirty = draft !== state.analyzedCommand || kind !== state.analyzedKind;
  const rows = analysis?.[phase] || [];
  return `<div class="lesson-heading"><div><div class="eyebrow">COMMAND → CONFIG → CODE</div><h1>从启动命令，读懂执行路径</h1><p>粘贴命令，查看参数如何改变模块选择。点击流程节点，直接读本地函数与行号。</p></div><span class="badge">源码推导</span></div>
  <section class="command-workbench" aria-label="启动命令分析器">
    <div class="command-editor"><label for="launch-command">vLLM 启动命令</label><textarea id="launch-command" rows="5" spellcheck="false" placeholder="vllm serve Qwen/Qwen3-0.6B --tensor-parallel-size 2">${esc(draft)}</textarea>
      <div class="command-editor-actions"><label for="command-kind">观察请求<select id="command-kind" aria-label="观察请求">${[
        ['auto', '自动示例（对话 / Pooling）'],
        ['chat', '对话 · /v1/chat/completions'],
        ['completion', '补全 · /v1/completions'],
        ['embedding', '向量 · /v1/embeddings'],
      ]
        .map(
          ([value, label]) =>
            `<option value="${value}" ${kind === value ? 'selected' : ''}>${label}</option>`,
        )
        .join(
          '',
        )}</select></label><button class="command-generate" data-command-action="analyze">生成流程图 <span aria-hidden="true">→</span></button></div>
      <p class="command-local-note">只在本页面解析，不执行命令、不下载模型。自定义输入不写入浏览器存储或链接。Ctrl / ⌘ + Enter 生成。</p>
      <p id="command-dirty" class="command-dirty" ${dirty ? '' : 'hidden'}>命令或请求类型已修改，请重新生成；下方仍为上次结果。</p>
    </div><aside class="command-examples"><strong>从一个例子开始</strong>${commandExamples.map((example, index) => `<button data-command-example="${index}"><span>${esc(example.name)}</span><small>${esc(example.note)}</small><b aria-hidden="true">↗</b></button>`).join('')}</aside>
  </section>
  ${analysis ? `<div id="command-result">${analysis.errors.length ? `<section class="command-errors" role="alert"><h2>请先修正命令</h2><ul>${analysis.errors.map((message) => `<li>${esc(message)}</li>`).join('')}</ul><p>未生成执行路径，避免使用无效配置继续推导。</p></section>` : resultView(analysis, rows, state, data)}</div>` : ''}
  <details class="command-support"><summary>支持哪些命令与参数？</summary><p>支持 vllm serve 和 Python API server 入口、短别名、--参数=值、JSON / JSON 点字段，以及 Bash、PowerShell、CMD 的行尾续行。支持前置 NAME=value 环境变量赋值；PowerShell 的 $env: 赋值、多命令脚本、容器外层命令和外部配置文件暂不展开。</p><p>当前绘图规则覆盖 ${Object.keys(commandOptions).length} 个参数。解析到参数不代表完整校验所有模型 / 平台组合；未建模参数会单独列出。</p><div class="command-supported">${Object.entries(
    commandOptions,
  )
    .map(
      ([name, def]) =>
        `<button data-command-source="${def.source}" title="${esc(def.area)}">--${name}</button>`,
    )
    .join('')}</div></details>`;
}

function resultView(analysis, rows, state, data) {
  const { phase, cursor } = state;
  const count = analysis.startup.length + analysis.request.length;
  return `<section class="command-result-summary" aria-label="解析结果"><div class="command-result-title"><strong>配置已解析 <span>${analysis.parameters.length} 个显式设置 · ${count} 个主链环节</span></strong><small>讲解基准 ${data.reviewedCommit.slice(0, 10)}</small></div><div class="command-facts">${analysis.facts.map(([label, value]) => `<div><small>${esc(label)}</small><b>${esc(value)}</b></div>`).join('')}</div></section>
  <details class="command-parameters"><summary>参数如何影响路径 <span>${analysis.parameters.length} 个已识别 · ${analysis.unknown.length} 个未建模</span></summary><div class="command-param-table"><table><thead><tr><th>命令中的设置</th><th>值</th><th>影响的模块 / 源码</th></tr></thead><tbody>${analysis.parameters.map((parameter) => `<tr><td><code>${esc(parameter.name)}</code></td><td>${esc(formatted(parameter.value, parameter.name))}</td><td><button data-command-source="${parameter.source}">${esc(parameter.area)} ↗</button></td></tr>`).join('') || '<tr><td colspan="3">未显式指定参数，使用本地版本的默认规则。</td></tr>'}${analysis.unknown.map((parameter) => `<tr class="command-unmodeled"><td><code>${esc(parameter.name)}</code></td><td>${esc(formatted(parameter.value, parameter.name))}</td><td>未建模，请核对本地 CLI / 扩展参数</td></tr>`).join('')}</tbody></table></div></details>
  ${analysis.warnings.length ? `<div class="command-notices" role="status"><strong>${analysis.unknown.length || analysis.options.config ? '部分推导 · 有设置尚未展开' : '阅读这张图时'}</strong><ul>${analysis.warnings.map((message) => `<li>${esc(message)}</li>`).join('')}</ul></div>` : ''}
  <section class="command-diagram" aria-label="命令执行流程图">
    <div class="command-flow-toolbar"><div class="command-phase-tabs" role="tablist" aria-label="流程阶段"><button role="tab" aria-selected="${phase === 'request'}" data-command-phase="request">单个请求 <small>${analysis.request.length}</small></button><button role="tab" aria-selected="${phase === 'startup'}" data-command-phase="startup">服务启动 <small>${analysis.startup.length}</small></button></div><div class="command-walk"><button data-command-action="prev" aria-label="上一个流程环节" ${cursor <= 0 || !rows.length ? 'disabled' : ''}>←</button><span>${rows.length ? cursor + 1 : 0} / ${rows.length}</span><button data-command-action="next" aria-label="下一个流程环节" ${cursor >= rows.length - 1 ? 'disabled' : ''}>下一环节 →</button></div></div>
    <div class="command-legend"><span><i class="core"></i>主链</span><span><i class="explicit"></i>参数启用</span><span><i class="conditional"></i>条件分支</span><small>↓ 主链处理顺序 · ↳ 环节内的分支 / 协作模块 · 点击卡片读源码</small></div>
    ${rows.length ? `<div class="command-outline" aria-label="主链速览"><strong>先看主链</strong><div>${rows.map((item, index) => `<button data-command-source="${item.source}" aria-label="主链源码：${esc(item.title)}"><small>${String(index + 1).padStart(2, '0')}</small>${esc(item.title)}</button>${index < rows.length - 1 ? '<span aria-hidden="true">→</span>' : ''}`).join('')}</div><p>点击读源码；下方展开每个环节的触发条件与协作模块。</p></div>` : ''}
    ${rows.length ? `<ol class="command-flow-list">${rows.map((item, index) => `<li class="command-flow-row ${cursor === index ? 'current' : ''}" id="command-row-${index}" ${cursor === index ? 'aria-current="step"' : ''}><div class="command-trunk">${flowNode(item, data, index)}${index < rows.length - 1 ? '<div class="command-connector" aria-hidden="true"><span>↓</span></div>' : ''}</div>${item.branches.length ? `<div class="command-branches" aria-label="${esc(item.title)}的分支">${item.branches.map((branch) => flowNode(branch, data)).join('')}</div>` : ''}</li>`).join('')}</ol>` : '<p class="command-no-path">此入口没有已建模的请求路径。请查看“服务启动”和上方说明。</p>'}
    ${phase === 'request' && analysis.request.some((item) => item.id === 'sampling') ? '<div class="command-loop"><span aria-hidden="true">↶</span><div><strong>Decode 循环</strong><p>请求尚未结束时，从“更新请求进度”回到“决定这一轮算哪些 token”。每轮都可能加入新请求、命中缓存或发生抢占。</p></div></div>' : ''}
  </section>
  ${analysis.skipped.length ? `<section class="command-skipped"><strong>当前未展开的分支</strong><ul>${analysis.skipped.map((item) => `<li>${esc(item)}</li>`).join('')}</ul></section>` : ''}`;
}
