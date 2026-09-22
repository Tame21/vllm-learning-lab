import { esc } from './html.mjs';
import { specMethods, specFamilies, specCommand } from './spec-methods.mjs';

export function specEntry() {
  return `<section class="spec-entry"><div><span class="eyebrow">专题路线 · 先学共同原理，再比较方法</span><h2>投机推理，按方法展开学</h2><p>N-gram、Draft Model、EAGLE / EAGLE3、MTP、Medusa、PARD、DFlash、DSpark…从草稿来源和执行方式看懂差异。</p></div><button data-view="spec-methods">打开投机方法地图 →</button></section>`;
}

export function specMethodsView(state, study) {
  const filtered = specMethods.filter((m) => state.family === 'all' || state.family === m.family);
  const pair = state.compare.map((id) => specMethods.find((m) => m.id === id));
  return `<div class="lesson-heading"><div><span class="eyebrow">SPECULATIVE DECODING · METHOD MAP</span><h1>投机推理方法地图</h1><p>共同点是“先提议，再验证”。先问草稿从哪里来，再看候选之间是否依赖，最后回到源码确认。</p></div><span class="badge">${specMethods.length} 个方法专题</span></div>
  <section class="spec-foundation"><div><span class="eyebrow">01 / 共同基础</span><h2>便宜地猜一段，严格地确认</h2><p>所有草稿都只是候选。接受连续前缀，遇到第一处拒绝就处理恢复；不同采样模式走不同验证分支。</p><button data-lesson="speculative">先做接受 / 拒绝推演 →</button></div><ol class="spec-common-chain"><li><b>提议</b><span>方法决定草稿来源</span></li><li><b>目标验证</b><span>并行计算验证位置</span></li><li><b>接受 / 恢复</b><span>提交正确的前缀</span></li></ol></section>
  <section class="spec-catalog" aria-label="投机方法列表"><div class="section-heading"><h2>02 / 按草稿来源选方法</h2><span>${filtered.length} 个专题</span></div><div class="spec-filters" aria-label="按草稿来源筛选"><button data-spec-family="all" aria-pressed="${state.family === 'all'}">全部方法</button>${specFamilies.map((f) => `<button data-spec-family="${f.id}" aria-pressed="${state.family === f.id}">${esc(f.label)}</button>`).join('')}</div>
  <div class="spec-method-grid">${filtered.map((m) => `<article class="spec-method-card" data-method-card="${m.id}"><div class="spec-card-meta"><span>${esc(specFamilies.find((f) => f.id === m.family).label)}</span><span class="${m.status === 'reference' ? 'spec-reference' : ''}">${m.status === 'reference' ? '当前仅机制参考' : study.quiz[m.id]?.passed ? '✓ 理解题通过' : study.completed.includes(m.id) ? '◐ 已读' : '4 步图解'}</span></div><h3>${esc(m.name)}</h3><p>${esc(m.summary)}</p><dl><div><dt>草稿输入</dt><dd>${esc(m.input)}</dd></div><div><dt>生成方式</dt><dd>${esc(m.proposal)}</dd></div></dl><button data-lesson="${m.id}">学习 ${esc(m.name)} →</button></article>`).join('')}</div></section>
  <section class="spec-compare" aria-label="投机方法对照"><div class="section-heading"><h2>03 / 放在一起比较</h2><span>切换两侧方法</span></div><div class="spec-compare-selects">${pair.map((m, i) => `<label>对照方法 ${i ? 'B' : 'A'}<select data-spec-compare="${i}" aria-label="对照方法 ${i ? 'B' : 'A'}">${specMethods.map((option) => `<option value="${option.id}" ${option.id === m.id ? 'selected' : ''}>${esc(option.name)}</option>`).join('')}</select></label>`).join('')}</div><div class="spec-comparison-table"><table><caption>${esc(pair[0].name)} 与 ${esc(pair[1].name)} 的机制差异</caption><thead><tr><th scope="col">比较维度</th>${pair.map((m) => `<th scope="col">${esc(m.name)}</th>`).join('')}</tr></thead><tbody>${[
    ['input', '输入'],
    ['weights', '额外权重'],
    ['proposal', '草稿如何产生'],
    ['useful', '学习重点'],
    ['boundary', '当前源码边界'],
  ]
    .map(
      ([key, label]) =>
        `<tr><th scope="row">${label}</th>${pair.map((m) => `<td>${esc(m[key])}</td>`).join('')}</tr>`,
    )
    .join(
      '',
    )}</tbody></table></div><p class="small-note">比较的是本地快照的机制和接入方式，不是速度排名。真实收益还取决于草稿开销、接受率、批量、硬件与模型匹配。</p></section>
  <section class="spec-strategies"><span class="eyebrow">04 / 方法学完，再学策略与接入</span><h2>选什么草稿，与分配多少预算，是两个问题</h2><div>${[
    ['dynamic-spec', '动态草稿长度', '按 batch-size 区间选择 K'],
    ['adaptive-spec', '自适应验证', '按置信度、成本与总预算选择验证量'],
    ['speculators', '训练与接入', '采集隐藏状态、外部训练与模型导出'],
  ]
    .map(
      ([id, title, text]) =>
        `<button data-lesson="${id}"><b>${title} →</b><span>${text}</span></button>`,
    )
    .join(
      '',
    )}</div><p class="small-note">这里按学习机制组织方法。custom_class 是扩展入口，extract_hidden_states 是数据采集模式；模型专属 MTP 别名不逐个重复成新算法。</p></section>`;
}

export function specLessonContext(lesson) {
  const m = specMethods.find((m) => m.id === lesson.id);
  if (!m) return lesson.id === 'speculative' ? specEntry() : '';
  const next = specMethods[specMethods.indexOf(m) + 1];
  return `<section class="spec-lesson-context"><div class="spec-lesson-links"><button data-view="spec-methods">← 投机方法地图</button><button data-lesson="speculative">共同的接受 / 拒绝实验 ↗</button>${next ? `<button data-lesson="${next.id}">比较下一种：${esc(next.name)} →</button>` : '<button data-lesson="adaptive-spec">继续学自适应验证 →</button>'}</div><div class="spec-method-facts"><div><span>输入从哪里来</span><b>${esc(m.input)}</b></div><div><span>需要哪些权重</span><b>${esc(m.weights)}</b></div><div><span>怎样生成候选</span><b>${esc(m.proposal)}</b></div></div><details class="spec-config" ${m.status === 'reference' ? 'open' : ''}><summary>${m.status === 'reference' ? '当前源码边界：仅作机制参考' : '配置片段与当前源码边界'}</summary><p>${esc(m.boundary)}</p>${specCommand(m) ? `<pre><code>${esc(specCommand(m))}</code></pre><p class="small-note">模型名是占位符，使用前须替换为匹配的目标与草稿 checkpoint，并核对 Runner、平台与参数组合。本页不执行命令。</p><button data-spec-command="${m.id}">带入启动命令流程图 →</button>` : '<p class="small-note">本快照不提供此方法的可运行命令模板。步骤 3、4 可分别定位注册状态和 Runner 分发代码。</p>'}</details></section>`;
}

const chips = (items, active = true, extra = '') =>
  `<div class="spec-chips ${active ? '' : 'pending'} ${extra}">${items.map((v) => `<span>${esc(v)}</span>`).join('')}</div>`;
const block = (label, content, active = true) =>
  `<div class="spec-diagram-block ${active ? 'reached' : 'pending'}"><span class="spec-block-label">${esc(label)}</span>${content}</div>`;
const serial = (labels, active) =>
  `<div class="spec-serial ${active ? '' : 'pending'}">${labels.map((label, n) => `${n ? '<i aria-hidden="true">→</i>' : ''}<span>${esc(label)}</span>`).join('')}</div>`;
const fork = (label, labels, active) =>
  `<div class="spec-fork ${active ? '' : 'pending'}"><b>${esc(label)}</b><span aria-hidden="true">↓　↓　↓</span>${chips(labels)}</div>`;

export function specMethodScene(lesson, index) {
  const m = specMethods.find((m) => m.id === lesson.id),
    s = m.steps[index];
  let diagram;
  const generated = index >= 2,
    preparing = index >= 1;
  switch (m.id) {
    case 'ngram':
      diagram =
        block(
          '本请求 token 历史',
          '<div class="spec-history"><mark>A B</mark><strong>C D</strong><span>…</span><mark>A B</mark><small>← 当前后缀</small></div>',
        ) +
        block(
          preparing ? '先前匹配 → 复制它的后续' : '下一步：查找历史中相同的后缀',
          chips(generated ? ['C', 'D'] : ['候选 1', '候选 2'], generated),
          preparing,
        );
      break;
    case 'ngram-gpu':
      diagram =
        block(
          'GPU 批量历史 · 示意两个请求',
          '<div class="spec-gpu-rows"><div><b>A</b><code>A B C D A B</code></div><div><b>B</b><code>X Y Z P Q</code></div></div>',
        ) +
        block(
          '每请求的候选张量与有效长度',
          `<div class="spec-gpu-rows"><div><b>A</b><code>${generated ? '[C, D, A]　valid = 3' : '[·, ·, ·]　等待匹配'}</code></div><div><b>B</b><code>${generated ? '[-1, -1, -1]　valid = 0' : '[·, ·, ·]　等待匹配'}</code></div></div>`,
          preparing,
        );
      break;
    case 'suffix':
      diagram =
        block(
          '后缀缓存 · 示意频次，不是实测概率',
          `<div class="spec-tree"><b>相同后缀 A B</b><div><span>↳ C D　出现 3 次</span><span>↳ E F　出现 1 次</span></div></div>`,
        ) +
        block(
          '外部库选择续写，门限决定长度',
          chips(generated ? ['C', 'D', '… 至多 K'] : ['候选续写'], generated),
          preparing,
        );
      break;
    case 'draft-model':
      diagram =
        block('独立小模型读取 token 历史', chips(['context tokens', 'draft KV'])) +
        block(
          '串行依赖：上一候选作为下一步输入',
          serial(['前向 → d₁', '前向 → d₂', '前向 → d₃'], generated),
          preparing,
        );
      break;
    case 'eagle':
      diagram =
        block('目标特征进入草稿网络', serial(['目标 hₜ + token', 'EAGLE 草稿网络'], preparing)) +
        block(
          '草稿特征与 token 一起递推',
          serial(['h₁, d₁', 'h₂, d₂', 'h₃, d₃'], generated),
          preparing,
        );
      break;
    case 'eagle3':
      diagram =
        block(
          '典型 EAGLE3 辅助特征输入',
          `${chips(['低层 h', '中层 h', '高层 h'])}<div class="spec-merge ${preparing ? '' : 'pending'}">↘　↓　↙<b>concat + combine_hidden_states</b></div>`,
        ) +
        block('融合后的特征用于递推', serial(['fused h', 'd₁', 'd₂', 'd₃'], generated), preparing);
      break;
    case 'mtp':
      diagram =
        block(
          '由模型结构选择预测模块',
          fork('目标模型与 MTP 配置', ['通用 MTP', '多模块 MTP', '模型专属'], preparing),
        ) +
        block(
          '此图沿通用路径逐步生成',
          serial(['MTP step 1', 'step 2', 'step 3'], generated),
          preparing,
        );
      break;
    case 'mlp-spec':
      diagram =
        block('文档中的级联机制', serial(['h + token', 'MLP₁ → d₁', 'MLP₂ → d₂'], preparing)) +
        block(
          '当前快照的接入状态',
          `<div class="spec-status-pair"><span>模型类片段存在</span><strong>注册未启用 · Runner 未接入</strong></div>`,
          generated,
        );
      break;
    case 'medusa':
      diagram =
        block(
          '多个头共享同一目标特征',
          fork('target hidden state', ['head₁', 'head₂', 'head₃'], preparing),
        ) +
        block(
          '逐头 argmax → 堆叠成线性候选',
          chips(generated ? ['d₁', 'd₂', 'd₃'] : ['位置 1', '位置 2', '位置 3'], generated),
          preparing,
        );
      break;
    case 'parallel-draft':
      diagram =
        block('上下文与并行候选位置', chips(['context', 'slot₁', 'slot₂', 'slot₃'])) +
        block(
          '专门训练的 PARD：一次前向',
          fork(
            'parallel draft forward',
            generated ? ['d₁', 'd₂', 'd₃'] : ['位置 1', '位置 2', '位置 3'],
            preparing,
          ),
        );
      break;
    case 'dflash':
      diagram =
        block(
          '上下文 KV + 1 个 anchor + K 个 mask',
          `${chips(['context KV'])}${chips(['anchor', 'mask₁', 'mask₂', 'mask₃'], preparing)}`,
        ) +
        block(
          '查询块并行前向，只在 mask 位置取候选',
          fork(
            'query block forward',
            generated ? ['d₁', 'd₂', 'd₃'] : ['mask₁', 'mask₂', 'mask₃'],
            preparing,
          ),
        );
      break;
    case 'dspark':
      diagram =
        block(
          '默认 K 个查询位置 → 并行骨干',
          `${chips(['anchor', 'noise₂', 'noise₃'])}${fork('parallel backbone', ['logits₁', 'logits₂', 'logits₃'], preparing)}`,
        ) +
        block(
          '顺序 Markov 头：前一词修正下一位置',
          serial(['bias(anchor) → d₁', 'bias(d₁) → d₂', 'bias(d₂) → d₃'], generated),
          preparing,
        );
      break;
  }
  const result =
    m.status === 'reference'
      ? `<div class="spec-verification ${index === 3 ? 'active' : ''}"><b>机制参考</b><span>本快照尚未接入；点击右侧“对应源码”检查注册与 Runner。</span></div>`
      : `<div class="spec-verification ${index === 3 ? 'active' : ''}"><b>目标验证</b><span>${index === 3 ? '候选还需验证；接受连续前缀，遇到首次拒绝后恢复。' : '下一阶段：所有候选都要经过目标模型验证。'}</span><button data-lesson="speculative">动手推演接受 / 拒绝 ↗</button></div>`;
  return `<div class="spec-method-scene" data-method-scene="${m.id}"><div class="scene-caption"><span>${esc(m.name)} · 机制图解</span><span>输入与位置均为示意，未运行模型</span></div><div class="spec-stage-nav" aria-label="方法执行步骤">${m.steps.map((step, n) => `<button data-step="${n}" aria-current="${n === index ? 'step' : 'false'}" class="${n === index ? 'active' : n < index ? 'visited' : ''}"><small>0${n + 1}</small>${esc(step.title)}</button>`).join('')}</div><div class="spec-diagram">${diagram}</div>${result}<div class="spec-stage-note"><b>0${index + 1} · ${esc(s.title)}</b><p>${esc(s.body)}</p></div></div>`;
}
