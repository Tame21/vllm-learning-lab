import { registerAgentTools } from './agent-tools.mjs';
import { terms } from './glossary.mjs';
import { loadStudy, saveStudy, decodeRoute, encodeRoute } from './study-state.mjs';
import { challengeFor } from './learning.mjs';
import { learningContext, quizView, pathView } from './learning-view.mjs';
import { createTraceCache, executableIds } from './engine.mjs';
import { comparisonView } from './experiment-view.mjs';
import { exampleRequests } from './engines/scheduler.mjs';
import { groups, lessons } from './content.mjs';
import { defaults, validateParameters, stageFor } from './simulations.mjs';
import { esc, controls, scene } from './renderers.mjs';
import { sourceKey } from './source-map.mjs';
import { updateDOM } from './dom.mjs';
import { analyzeCommand, commandExamples } from './command-flow.mjs';
import { commandView } from './command-view.mjs';
import { commandSources } from './command-sources.mjs';
import { specMethods, specCommand } from './spec-methods.mjs';
import { specMethodsView, specLessonContext } from './spec-method-view.mjs';
const app = document.querySelector('#app'),
  dialog = document.querySelector('#source-dialog');
const ids = lessons.map((l) => l.id);
let storage;
try {
  storage = localStorage;
} catch {
  storage = {
    getItem: () => null,
    setItem: () => {
      throw Error('本地存储不可用');
    },
  };
}
const study = loadStudy(storage, ids);
const toolViews = ['command', 'path', 'coverage', 'glossary', 'spec-methods'];
const specState = { family: 'all', compare: ['eagle', 'eagle3'] };
const commandState = {
  draft: commandExamples[0].command,
  analyzedCommand: commandExamples[0].command,
  kind: 'auto',
  analyzedKind: 'auto',
  phase: 'request',
  cursor: 0,
  analysis: analyzeCommand(commandExamples[0].command),
};
let route,
  routeWarning = '';
try {
  if (!toolViews.includes(location.hash.slice(1))) route = decodeRoute(location.hash, ids);
} catch (e) {
  routeWarning = e.message;
}
let data,
  lesson = lessons.find((l) => l.id === (route?.id || study.lastLesson)) || lessons[0],
  view = toolViews.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'lab',
  query = '',
  timer = null,
  speed = 1;
const initial = route?.explicit ? route : study.sessions[lesson.id];
let index = initial?.index || 0,
  tab = initial?.tab || 'explain',
  options = initial?.options || { ...defaults },
  answer = study.quiz[lesson.id]?.answer ?? null;
let completed = study.completed,
  focusedDoc = null,
  sourceEpoch = 0,
  challengeInput = '',
  challengeResult = null,
  saveAvailable = true;
const traceCache = createTraceCache();
const frames = () => traceCache(lesson, options).trace;
const stage = () => {
  const f = frames()[index],
    s = stageFor(lesson, f?.stepIndex ?? index, options);
  return executableIds.includes(lesson.id) ? { ...s, change: f.events.join(' ') } : s;
};
const key = sourceKey;
const icon = `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="m7 10 8 14L25 7M17 7h8v8"/></svg>`;
try {
  const r = await fetch('source-index.json');
  if (!r.ok) throw Error('索引未生成');
  data = await r.json();
  index = Math.min(index, frames().length - 1);
  render();
} catch (e) {
  app.innerHTML = `<div class="loading"><h1>源码索引尚未准备好</h1><p>请在项目目录执行 npm start，再访问终端显示的地址。</p><code>${esc(e.message)}</code></div>`;
}
function select(id, docPath, restoreRoute) {
  const next = lessons.find((l) => l.id === id);
  if (!next) throw Error('专题不存在');
  routeWarning = '';
  pause();
  lesson = next;
  const session = restoreRoute?.explicit ? restoreRoute : study.sessions[id];
  options = session?.options || { ...defaults };
  index = Math.min(session?.index || 0, frames().length - 1);
  tab = session?.tab || 'explain';
  answer = study.quiz[id]?.answer ?? null;
  view = 'lab';
  challengeInput = '';
  challengeResult = null;
  focusedDoc = data.docs.find((d) => d.path === docPath) || null;
  if (!restoreRoute) history.pushState(null, '', encodeRoute(id, options, index, tab));
  render();
  if (!restoreRoute) document.querySelector('main').scrollIntoView({ block: 'start' });
}
function persist() {
  study.completed = completed;
  study.lastLesson = lesson.id;
  study.sessions[lesson.id] = { options: structuredClone(options), index, tab };
  saveAvailable = saveStudy(storage, study);
  if (view === 'lab') history.replaceState(null, '', encodeRoute(lesson.id, options, index, tab));
}
function pause() {
  clearInterval(timer);
  timer = null;
}
function jump(n) {
  if (!Number.isInteger(Number(n))) throw Error('步骤必须是整数');
  index = Math.max(0, Math.min(Number(n), frames().length - 1));
  if (index === frames().length - 1) pause();
  render();
}
function play() {
  if (timer) {
    pause();
    render();
    return;
  }
  if (index >= frames().length - 1) index = 0;
  timer = setInterval(() => jump(index + 1), 1800 / speed);
  render();
}
function render() {
  persist();
  const navScroll = document.querySelector('.lesson-nav')?.scrollTop || 0;
  const group = groups.find((g) => g[0] === lesson.group);
  updateDOM(
    app,
    `
 <aside class="sidebar"><a class="brand" href="#lifecycle" data-lesson="lifecycle"><span class="brand-icon">${icon}</span><span>vLLM <em>Lab</em><small>推理，逐步看见。</small></span></a>
 <div class="search-wrap"><span>⌕</span><input id="search" type="search" aria-label="搜索学习专题" placeholder="搜索特性或关键词" value="${esc(query)}"><kbd>/</kbd></div>
 <nav class="sidebar-tools" aria-label="快捷工具"><button data-view="command" class="sidebar-command ${view === 'command' ? 'active' : ''}" ${view === 'command' ? 'aria-current="page"' : ''}><span class="sidebar-command-icon" aria-hidden="true">⌘</span><span><strong>启动命令 → 流程图</strong><small>按参数看路径，点击读源码</small></span><span class="sidebar-command-arrow" aria-hidden="true">↗</span></button></nav>
 <div class="sidebar-caption">学习地图 <span>${lessons.length} 个专题</span></div><nav class="lesson-nav" aria-label="学习专题">${
   groups
     .map((g) => {
       const matches = lessons.filter(
         (l) =>
           l.group === g[0] &&
           `${l.title} ${l.english} ${l.summary}`.toLowerCase().includes(query.toLowerCase()),
       );
       return matches.length
         ? `<div class="nav-group"><div class="group-label"><span>${g[1]}</span>${g[2]}</div>${g[0] === 'spec' ? `<button data-view="spec-methods" class="nav-item ${view === 'spec-methods' ? 'selected' : ''}" ${view === 'spec-methods' ? 'aria-current="page"' : ''}><span class="nav-dot" aria-hidden="true"></span>投机推理方法地图</button>` : ''}${matches.map((l) => `<button data-lesson="${l.id}" class="nav-item ${view === 'lab' && l.id === lesson.id ? 'selected' : ''}"><span class="nav-dot ${completed.includes(l.id) ? 'complete' : ''}">${completed.includes(l.id) ? '✓' : ''}</span>${l.title}</button>`).join('')}</div>`
         : '';
     })
     .join('') || '<p class="empty">没有匹配的专题</p>'
 }</nav>
 <div class="learning-progress"><div><span>已读进度</span><strong>${completed.length} / ${lessons.length}</strong></div><div class="meter"><i style="width:${(completed.length / lessons.length) * 100}%"></i></div><small>${Object.values(study.quiz).filter((q) => q.passed).length} 道理解题通过 · ${saveAvailable ? '本机保存' : '存储不可用'}</small></div></aside>
 <div class="main-shell"><header class="topbar"><div class="breadcrumb">学习实验室 <span>/</span> ${view === 'lab' ? group[2] : view === 'command' ? '启动命令' : view === 'coverage' ? '特性全景' : view === 'path' ? '学习路线' : view === 'spec-methods' ? '投机方法地图' : '术语手册'}</div><nav aria-label="工具视图"><button data-view="path" class="${view === 'path' ? 'active' : ''}">学习路线</button><button data-view="lab" class="${view === 'lab' ? 'active' : ''}">实验室</button><button data-view="command" class="${view === 'command' ? 'active' : ''}">启动命令</button><button data-view="coverage" class="${view === 'coverage' ? 'active' : ''}">特性全景</button><button data-view="glossary" class="${view === 'glossary' ? 'active' : ''}">术语手册</button></nav><span class="revision" title="${esc(data.commit)}">源码 ${data.commit.slice(0, 10)}</span></header>
 <main>${view === 'lab' ? laboratory() : view === 'command' ? commandView(commandState, data) : view === 'coverage' ? coverage() : view === 'path' ? pathView(lessons, study) : view === 'spec-methods' ? specMethodsView(specState, study) : glossary()}</main><footer><span>基于本地 vLLM V1 源码 · 中文教学模拟</span><span>不运行模型 · 不需要 GPU · 数值不是硬件实测</span></footer></div>`,
  );
  document.querySelector('.lesson-nav').scrollTop = navScroll;
}
function laboratory() {
  const f = frames(),
    s = stage();
  return `<div class="lesson-heading"><div><div class="eyebrow">${esc(lesson.english)}</div><h1>${esc(lesson.title)}</h1><p>${esc(lesson.summary)}</p></div><div class="lesson-actions"><button class="quiet-button ${completed.includes(lesson.id) ? 'done' : ''}" data-action="complete">${completed.includes(lesson.id) ? '✓ 已读' : '○ 标记已读'}</button><button class="quiet-button" data-action="bookmark">${study.bookmarks.includes(lesson.id) ? '★ 已收藏' : '☆ 收藏'}</button><button class="quiet-button" data-action="share">实验链接 ↗</button></div></div>
 ${routeWarning ? `<p class="notice">${esc(routeWarning)}，已恢复安全的默认页面。</p>` : ''}${learningContext(lesson, lessons, terms)}${specLessonContext(lesson)}
 ${focusedDoc ? `<div class="variant-banner"><div><span class="badge">${esc(focusedDoc.level)}</span><strong>${esc(focusedDoc.title)}</strong><p>${esc(focusedDoc.note)}</p></div><button data-source="${esc(focusedDoc.path)}">阅读具体变体文档 ↗</button></div>` : ''}
 <div class="lab-layout"><section class="experiment" aria-label="执行过程可视化"><div class="experiment-toolbar"><div><span class="live-symbol">◈</span><strong>执行观察窗</strong><span class="badge">教学模拟</span></div><div class="toolbar-actions"><button data-action="play" aria-label="${timer ? '暂停动画' : '播放动画'}">${timer ? 'Ⅱ' : '▶'}</button><button data-action="next" aria-label="从观察窗前进一步" ${index === f.length - 1 ? 'disabled' : ''}>单步 →</button><span class="step-indicator">${String(index + 1).padStart(2, '0')} <small>/ ${String(f.length).padStart(2, '0')}</small></span></div></div>
 <div class="scene" id="scene">${scene(lesson, index, options, f)}</div>
 <div class="playback"><div class="playback-buttons"><button class="icon-button" data-action="reset" aria-label="重置">↺</button><button class="icon-button" data-action="prev" aria-label="上一步" ${index === 0 ? 'disabled' : ''}>‹</button><button class="play-button" data-action="play">${timer ? 'Ⅱ 暂停' : '▶ 播放'}</button><button class="icon-button" data-action="next" aria-label="下一步" ${index === f.length - 1 ? 'disabled' : ''}>›</button></div><input aria-label="执行时间轴" type="range" min="0" max="${f.length - 1}" value="${index}" id="scrubber"><select id="speed" aria-label="播放速度">${[0.5, 1, 2].map((v) => `<option ${speed === v ? 'selected' : ''} value="${v}">${v}×</option>`).join('')}</select></div>
 <div class="settings"><div class="settings-title"><strong>${lesson.kind === 'spec-method' ? '按步骤观察' : '动手改一改'}</strong><small>${lesson.kind === 'spec-method' ? '对照输入、依赖和源码' : '调整参数后从头演示'}</small></div>${controls(lesson, options)}<p id="parameter-error" role="alert"></p></div>${comparisonView(lesson, traceCache(lesson, options).comparison, f, options)}</section>
 <aside class="explanation"><div class="detail-tabs" role="tablist">${[
   ['explain', '这一步'],
   ['source', '对应源码'],
   ['quiz', '想一想'],
 ]
   .map(
     ([id, name]) =>
       `<button role="tab" aria-selected="${tab === id}" data-tab="${id}" class="${tab === id ? 'active' : ''}">${name}</button>`,
   )
   .join(
     '',
   )}</div><div class="detail-body" aria-live="polite">${tab === 'source' ? sourcePanel() : tab === 'quiz' ? quiz() : `<span class="eyebrow">${lesson.kind === 'scheduler' ? '本轮发生了什么' : 'WHY & HOW'}</span><h2>${lesson.kind === 'scheduler' ? `第 ${index + 1} 轮调度` : esc(s.title)}</h2>${executableIds.includes(lesson.id) ? `<ol class="event-list">${f[index].events.map((e) => `<li>${esc(e)}</li>`).join('') || '<li>请求继续计算已调度的 token。</li>'}</ol>` : `<p>${esc(s.body)}</p>`}<div class="analogy"><span>换个角度理解</span><p>${esc(lesson.analogy)}</p></div><div class="watch"><span>观察重点</span><p>${lesson.kind === 'scheduler' ? '浅色是待计算 prompt，蓝色是已计算位置，绿色是已经生成的输出；P、D 是新位置计算，R 是抢占后的历史 KV 重算。' : esc(s.change)}</p></div><button class="source-jump" data-tab="source">定位这一步的源码 <span>↗</span></button>`}</div></aside></div>
 <div class="below-lab"><section class="steps-section"><div class="section-heading"><h2>理解这条执行链</h2><span>${lesson.steps.length} 个关键环节</span></div><div class="step-list">${lesson.steps.map((s, n) => `<button data-${executableIds.includes(lesson.id) ? 'explain-step' : 'step'}="${n}" class="${n === (f[index]?.stepIndex ?? index) ? 'active' : ''}"><span>${String(n + 1).padStart(2, '0')}</span><div><b>${esc(s.title)}</b><small>${esc(s.change)}</small></div><span>↗</span></button>`).join('')}</div></section><section class="source-summary"><span class="eyebrow">READ THE IMPLEMENTATION</span><h2>带着问题回到源码</h2><p>右侧“对应源码”定位当前步骤。下方为相关参考文件，可继续查阅真实分支与平台约束。</p>${lesson.refs.map((r, n) => `<button class="file-link" data-ref="${n}"><span>⌘</span><div><b>${esc(r.path.split('/').at(-1))}</b><small>${esc(r.path)}</small></div><span>↗</span></button>`).join('')}<div class="next-lesson"><button data-action="next-lesson">继续下一个专题 →</button></div></section></div>`;
}
function currentSources() {
  const s = lesson.kind === 'scheduler' ? lesson.steps[1] : stage();
  const sources = [s.source, s.alternateSource].filter(Boolean);
  if (lesson.kind === 'scheduler') {
    const frame = frames()[index];
    if (frame.events.some((event) => event.includes('抢占'))) {
      sources.push(lessons.find((l) => l.id === 'preemption').steps[1].source);
    }
    if (frame.events.some((event) => event.includes('完成，释放'))) {
      sources.push(lessons.find((l) => l.id === 'scheduler').steps[3].source);
    }
  }
  return sources;
}
function sourcePanel() {
  return currentSources()
    .map((r, n) => {
      const ref = data.refs[key(r)];
      return `<article class="source-anchor"><span class="eyebrow">${ref.kind === 'documentation' ? '设计文档中的机制说明' : lesson.id === 'runner' ? (n ? 'MRV2 实现路径' : 'MRV1 实现路径') : n ? '本轮相关实现' : '当前步骤的实现路径'}</span><h2>${esc(ref.symbol)}</h2><p class="code-path">${esc(r.path)}:${ref.line} · 范围 ${ref.rangeStart}–${ref.rangeEnd}</p><p>观察：${esc(r.observe)}</p><pre class="code-preview"><code>${esc(ref.code)}</code></pre><button class="primary-outline" data-step-source="${n}">展开源码与行号 ↗</button><p class="small-note">${ref.review === 'baseline' ? '该文件与讲解基准一致' : ref.review === 'stale' ? '文件已变更：锚点仍可定位，讲解待复核' : '无法确认版本：讲解待复核'} · 基准 ${data.reviewedCommit.slice(0, 10)}</p></article>`;
    })
    .join('');
}
function quiz() {
  return quizView(
    lesson,
    answer,
    study.quiz[lesson.id],
    challengeFor(lesson, options, frames()),
    challengeInput,
    challengeResult,
  );
}

function coverage() {
  const matches = (s) => s.toLowerCase().includes(query.toLowerCase());
  const docs = data.docs.filter((d) => matches(`${d.title} ${d.path} ${d.note}`));
  return `<div class="lesson-heading"><div><div class="eyebrow">FEATURE ATLAS</div><h1>特性全景</h1><p>机制动画、后端变体与外部插件分别标明。左侧搜索同时筛选下方文档和实现目录。</p></div><span class="badge">${data.docs.length} 篇特性文档</span></div><div class="coverage-intro"><strong>${lessons.length} 个机制专题</strong><span>${executableIds.length} 个状态推演专题 · ${lessons.filter((l) => l.kind === 'flow').length} 个流程概览</span><span>源码版本 ${data.commit.slice(0, 10)}</span></div><p class="coverage-boundary">可计算实验展示简化的状态变化；流程动画展示执行主链。后端变体可跳转到共享机制和专属文档，未逐个复现所有模型、硬件 kernel 或外部库内部行为。下方文件目录也不等于支持能力清单。</p><div class="atlas-grid">${groups
    .map((g) => {
      const items = lessons.filter(
        (l) => l.group === g[0] && matches(`${l.title} ${l.english} ${l.summary}`),
      );
      return items.length
        ? `<section class="atlas-card"><span class="eyebrow">${g[1]} / ${g[2]}</span>${items.map((l) => `<button data-lesson="${l.id}">${esc(l.title)}<span>→</span></button>`).join('')}</section>`
        : '';
    })
    .join(
      '',
    )}</div><h2 class="catalog-title">特性文档 → 机制演示 <small>${docs.length} 篇匹配</small></h2><div class="doc-table">${docs.map((d) => `<div class="doc-row"><div><b>${esc(d.title)}</b><span class="badge">${esc(d.level)}</span><p>${esc(d.note)}</p><small>${esc(d.path)}</small></div><div class="doc-actions"><button data-document="${esc(d.path)}">看执行过程 →</button><button data-source="${esc(d.path)}">读本地文档 ↗</button></div></div>`).join('') || '<p class="empty">没有匹配的特性文档，换个关键词试试。</p>'}</div><h2 class="catalog-title">继续深入：实际实现文件</h2>${data.inventories
    .map((inv) => {
      const files = inv.files.filter((f) => matches(f.name));
      return `<details class="inventory"><summary>${esc(inv.title)}<span>${files.length} 个文件</span></summary><p>${esc(inv.dir)} · 文件索引，不代表逐个实现了运行模拟。</p><div>${files.map((f) => `<button data-source="${esc(f.path)}">${esc(f.name)} ↗</button>`).join('') || '<p>没有匹配的实现文件</p>'}</div></details>`;
    })
    .join('')}`;
}

function glossary() {
  return `<div class="lesson-heading"><div><div class="eyebrow">A SMALL FIELD GUIDE</div><h1>先把这些词弄明白</h1><p>遇到陌生术语，随时回来查。理解过程比记住缩写更重要。</p></div></div><div class="glossary-grid">${terms.map(([a, b]) => `<article><h2>${a}</h2><p>${b}</p></article>`).join('')}</div>`;
}
async function openSource(path, line = 1) {
  pause();
  const epoch = ++sourceEpoch;
  dialog.innerHTML = `<div class="dialog-head"><div><strong>${esc(path)}</strong><span>本地文件 · 第 ${line} 行</span></div><button data-close aria-label="关闭源码">×</button></div><div class="full-code">正在读取…</div>`;
  if (!dialog.open) dialog.showModal();
  try {
    const r = await fetch('/source/' + path.split('/').map(encodeURIComponent).join('/'));
    if (!r.ok) throw Error('无法读取文件，请确认通过 npm start 启动');
    const text = await r.text();
    if (epoch !== sourceEpoch || !dialog.open) return;
    dialog.querySelector('.full-code').innerHTML = text
      .split('\n')
      .map(
        (v, n) =>
          `<div class="code-line ${n + 1 === line ? 'highlight' : ''}" id="line-${n + 1}"><span>${n + 1}</span><code>${esc(v)}</code></div>`,
      )
      .join('');
    dialog.querySelector('.highlight')?.scrollIntoView({ block: 'center' });
  } catch (e) {
    if (epoch === sourceEpoch && dialog.open)
      dialog.querySelector('.full-code').textContent = e.message;
  }
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('button,a[data-lesson]');
  if (!b) return;
  if (b.hasAttribute('data-close')) return dialog.close();
  if (b.dataset.specFamily) {
    specState.family = b.dataset.specFamily;
    return render();
  }
  if (b.dataset.specCommand) {
    const method = specMethods.find((m) => m.id === b.dataset.specCommand);
    const command = specCommand(method);
    if (!command) return;
    pause();
    commandState.draft = command;
    commandState.kind = 'auto';
    view = 'command';
    history.pushState(null, '', '#command');
    generateCommand();
    document.querySelector('main').scrollIntoView({ block: 'start' });
    return;
  }
  if (b.dataset.commandSource) {
    const ref = data.refs[key(commandSources[b.dataset.commandSource])];
    return openSource(ref.path, ref.line);
  }
  if (b.dataset.commandExample !== undefined) {
    commandState.draft = commandExamples[Number(b.dataset.commandExample)].command;
    commandState.kind = 'auto';
    return generateCommand();
  }
  if (b.dataset.commandPhase) {
    commandState.phase = b.dataset.commandPhase;
    commandState.cursor = 0;
    return render();
  }
  if (b.dataset.commandAction) {
    if (b.dataset.commandAction === 'analyze') return generateCommand();
    const rows = commandState.analysis[commandState.phase];
    commandState.cursor = Math.max(
      0,
      Math.min(
        rows.length - 1,
        commandState.cursor + (b.dataset.commandAction === 'next' ? 1 : -1),
      ),
    );
    render();
    document
      .getElementById(`command-row-${commandState.cursor}`)
      ?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    return;
  }
  if (b.dataset.lesson) {
    e.preventDefault();
    return select(b.dataset.lesson);
  }
  if (b.dataset.document) {
    const d = data.docs.find((d) => d.path === b.dataset.document);
    return select(d.lesson, d.path);
  }
  if (b.dataset.preset) {
    const presets = {
      default: { budget: 8, capacity: 16, requests: exampleRequests },
      pressure: { budget: 8, capacity: 4, requests: exampleRequests },
      long: {
        budget: 8,
        capacity: 16,
        requests: [
          { id: 'A', prompt: 24, max: 4, arrival: 0 },
          { id: 'B', prompt: 4, max: 3, arrival: 1 },
          { id: 'C', prompt: 8, max: 3, arrival: 3 },
        ],
      },
    };
    return updateOptions({ blockSize: 4, chunked: true, ...presets[b.dataset.preset] });
  }
  if (b.dataset.removeRequest !== undefined) {
    return updateOptions({
      requests: (options.requests || exampleRequests).filter(
        (_, n) => n !== Number(b.dataset.removeRequest),
      ),
    });
  }
  if (b.dataset.view) {
    pause();
    view = b.dataset.view;
    history.pushState(
      null,
      '',
      view === 'lab' ? encodeRoute(lesson.id, options, index, tab) : `#${view}`,
    );
    render();
    if (view === 'spec-methods') document.querySelector('main').scrollIntoView({ block: 'start' });
    return;
  }
  if (b.dataset.tab) {
    tab = b.dataset.tab;
    return render();
  }
  if (b.dataset.step !== undefined) return jump(b.dataset.step);
  if (b.dataset.answer !== undefined) {
    answer = Number(b.dataset.answer);
    study.quiz[lesson.id] = {
      answer,
      passed: answer === lesson.answer,
      attempts: (study.quiz[lesson.id]?.attempts || 0) + 1,
    };
    return render();
  }
  if (b.dataset.stepSource !== undefined) {
    const r = currentSources()[Number(b.dataset.stepSource)];
    return openSource(r.path, data.refs[key(r)].line);
  }
  if (b.dataset.curriculumSource !== undefined) {
    const r = lesson.steps[Number(b.dataset.curriculumSource)].source;
    return openSource(r.path, data.refs[key(r)].line);
  }
  if (b.dataset.ref !== undefined) {
    const r = lesson.refs[Number(b.dataset.ref)];
    return openSource(r.path, data.refs[key(r)].line);
  }
  if (b.dataset.source) return openSource(b.dataset.source);
  if (b.dataset.term !== undefined) {
    const term = terms[Number(b.dataset.term)];
    dialog.innerHTML = `<div class="dialog-head"><strong>${esc(term[0])}</strong><button data-close aria-label="关闭术语">×</button></div><div class="text-dialog"><p>${esc(term[1])}</p></div>`;
    pause();
    return dialog.showModal();
  }
  if (b.dataset.explainStep !== undefined) {
    const s = lesson.steps[Number(b.dataset.explainStep)];
    dialog.innerHTML = `<div class="dialog-head"><strong>${esc(s.title)}</strong><button data-close aria-label="关闭说明">×</button></div><div class="text-dialog"><p>${esc(s.body)}</p><code>${esc(s.change)}</code><p><button class="quiet-button" data-curriculum-source="${b.dataset.explainStep}">阅读这个环节的源码 ↗</button></p></div>`;
    pause();
    return dialog.showModal();
  }
  switch (b.dataset.action) {
    case 'bookmark':
      study.bookmarks = study.bookmarks.includes(lesson.id)
        ? study.bookmarks.filter((id) => id !== lesson.id)
        : [...study.bookmarks, lesson.id];
      render();
      break;
    case 'share': {
      const url = new URL(location.href);
      url.hash = encodeRoute(lesson.id, options, index, tab);
      dialog.innerHTML = `<div class="dialog-head"><strong>复现这个实验</strong><button data-close aria-label="关闭链接">×</button></div><div class="text-dialog"><p>链接包含专题、参数和时间轴位置；可复制给使用同一学习工具的人。接收方需要能访问自己的本地服务。</p><input id="share-url" aria-label="实验链接" readonly value="${esc(url.href)}" style="width:100%"><p class="small-note">不包含你的学习成绩或收藏。</p></div>`;
      pause();
      dialog.showModal();
      dialog.querySelector('input').select();
      break;
    }
    case 'retry-quiz':
      answer = null;
      render();
      break;
    case 'check-challenge': {
      const challenge = challengeFor(lesson, options, frames());
      if (!challenge) return;
      if (challengeInput.trim() === '' || !Number.isFinite(Number(challengeInput))) {
        challengeResult = null;
        return;
      }
      challengeResult = { correct: Math.abs(Number(challengeInput) - challenge.answer) < 0.0006 };
      render();
      break;
    }
    case 'challenge-observe': {
      const challenge = challengeFor(lesson, options, frames());
      if (challenge) {
        pause();
        jump(Math.max(0, challenge.step));
      }
      break;
    }
    case 'add-request': {
      const requests = structuredClone(options.requests || exampleRequests);
      const id = [...'ABCDEF'].find((id) => !requests.some((r) => r.id === id));
      if (id) updateOptions({ requests: [...requests, { id, prompt: 8, max: 4, arrival: 0 }] });
      break;
    }
    case 'play':
      play();
      break;
    case 'prev':
      pause();
      jump(index - 1);
      break;
    case 'next':
      pause();
      jump(index + 1);
      break;
    case 'reset':
      pause();
      jump(0);
      break;
    case 'complete':
      completed = completed.includes(lesson.id)
        ? completed.filter((v) => v !== lesson.id)
        : [...completed, lesson.id];
      render();
      break;
    case 'next-lesson':
      select(lessons[(lessons.indexOf(lesson) + 1) % lessons.length].id);
      break;
  }
});
function generateCommand() {
  commandState.analysis = analyzeCommand(commandState.draft, { kind: commandState.kind });
  commandState.analyzedCommand = commandState.draft;
  commandState.analyzedKind = commandState.kind;
  commandState.cursor = 0;
  if (!commandState.analysis.request.length && commandState.analysis.startup.length)
    commandState.phase = 'startup';
  render();
}
function markCommandDirty() {
  const notice = document.getElementById('command-dirty');
  if (notice)
    notice.hidden =
      commandState.draft === commandState.analyzedCommand &&
      commandState.kind === commandState.analyzedKind;
}
function applyOptions(input) {
  options = validateParameters(input, options);
  pause();
  index = 0;
  challengeInput = '';
  challengeResult = null;
  render();
}
function updateOptions(input) {
  try {
    applyOptions(input);
  } catch (e) {
    const error = document.querySelector('#parameter-error');
    if (error) error.textContent = e.message;
  }
}
document.addEventListener('change', (e) => {
  if (e.target.dataset.specCompare !== undefined) {
    specState.compare[Number(e.target.dataset.specCompare)] = e.target.value;
    return render();
  }
  if (e.target.id === 'command-kind') {
    commandState.kind = e.target.value;
    return markCommandDirty();
  }
  if (e.target.id === 'scrubber') {
    pause();
    jump(e.target.value);
  }
  if (e.target.id === 'speed') {
    speed = Number(e.target.value);
    if (timer) {
      pause();
      play();
    }
  }
  if (e.target.dataset.param)
    updateOptions({
      [e.target.dataset.param]:
        e.target.type === 'checkbox' ? e.target.checked : Number(e.target.value),
    });
  if (e.target.dataset.request !== undefined) {
    const requests = structuredClone(options.requests || exampleRequests);
    requests[Number(e.target.dataset.request)][e.target.dataset.field] = Number(e.target.value);
    updateOptions({ requests });
  }
});
document.addEventListener('input', (e) => {
  if (e.target.id === 'launch-command') {
    commandState.draft = e.target.value;
    return markCommandDirty();
  }
  if (e.target.id === 'challenge-answer') {
    challengeInput = e.target.value;
    challengeResult = null;
    return render();
  }
  if (e.target.id === 'search') {
    const pos = e.target.selectionStart;
    query = e.target.value;
    render();
    const s = document.querySelector('#search');
    s.focus();
    try {
      s.setSelectionRange(pos, pos);
    } catch {}
  }
});
document.addEventListener('keydown', (e) => {
  if (e.target.id === 'launch-command' && (e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    return generateCommand();
  }
  if (
    dialog.open ||
    ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(document.activeElement?.tagName)
  )
    return;
  if (e.key === '/') {
    e.preventDefault();
    document.querySelector('#search').focus();
  }
  if (view !== 'lab') return;
  if (e.code === 'Space') {
    e.preventDefault();
    play();
  }
  if (e.key === 'ArrowRight') {
    pause();
    jump(index + 1);
  }
  if (e.key === 'ArrowLeft') {
    pause();
    jump(index - 1);
  }
});
window.addEventListener('hashchange', () => {
  if (toolViews.includes(location.hash.slice(1))) {
    pause();
    view = location.hash.slice(1);
    return render();
  }
  try {
    const route = decodeRoute(location.hash, ids);
    if (route) select(route.id, null, route);
  } catch (e) {
    routeWarning = e.message;
    render();
  }
});

dialog.addEventListener('close', () => {
  sourceEpoch++;
  render();
});

registerAgentTools({
  lessons,
  lesson: () => lesson,
  frames,
  select,
  pause,
  jump,
  configure: applyOptions,
  readState: () => ({
    lesson: lesson.id,
    title: lesson.title,
    view,
    step: index,
    totalSteps: frames().length,
    playing: !!timer,
    parameters: structuredClone(options),
    current: structuredClone(frames()[index]),
  }),
});
