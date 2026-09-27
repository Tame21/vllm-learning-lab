import { esc, range, toggle } from './html.mjs';
import { foundationCatalog } from './foundation-catalog.mjs';
import { foundationGroups, foundationParameters } from './foundation-parameters.mjs';
import { algorithmScene, number } from './algorithm-view.mjs';

const labels = {
  bSize: '观察项数 / 序列长度',
  bAngle: '两向量夹角（度）',
  bLogit: '第一个 logit',
  bProb: '事件 A / 成功的概率',
  bGiven: '已知 B 的值',
  bPrior: '先验 P(H)',
  bLikelihood: '似然 P(红球 | H)',
  bFalse: '似然 P(红球 | 非 H)',
  bU: '均匀随机数 U',
  bDraws: '抽样次数 n',
  bSigma: '标准差 σ',
  bMu: '均值 μ',
  bEstimate: '预测 q(A)',
  bToken: '观察 token / 位置',
  bCausal: '使用因果掩码',
  bLearningRate: '学习率 η',
  bTrain: '训练模式（关闭为冻结参数）',
  bStay: '保持原状态的概率',
  bRounds: '迭代轮数',
  bBeta: '每步噪声方差比例 β',
  bReveal: '每轮最多确认位置数',
  bDraftLength: '草稿候选数 K',
};
const select = (o, key, label, choices) =>
  `<label class="setting"><span>${esc(label)}</span><select data-param="${key}" aria-label="${esc(label)}">${choices.map((s, i) => `<option value="${i}" ${o[key] === i ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></label>`;
export function foundationControls(lesson, o) {
  return (
    lesson.params
      .map((key) => {
        if (key === 'bCase') return select(o, key, '输入案例', lesson.presets);
        if (key === 'bGiven') return select(o, key, labels[key], ['B=0', 'B=1']);
        if (key === 'bToken')
          return select(
            o,
            key,
            labels[key],
            lesson.slug === 'tokens'
              ? ['0 · 我', '1 · 爱', '2 · 学习', '3 · EOS']
              : ['位置 0', '位置 1', '位置 2', '位置 3'],
          );
        if (key === 'seed')
          return `<label class="setting"><span>随机种子</span><input data-param="seed" aria-label="随机种子" type="number" min="1" max="9999" value="${o.seed}"></label>`;
        const [initial, min, max, step] = foundationParameters[key];
        return typeof initial === 'boolean'
          ? toggle(o, key, labels[key])
          : range(o, key, labels[key], min, max, step);
      })
      .join('') +
    '<p class="mechanism-control-note">先读下方符号与小算例，再单步观察。调整参数会从第一步重新开始。</p>'
  );
}
export const foundationEntry = () =>
  `<section class="foundation-entry"><div><span class="eyebrow">START WITH THE BASICS</span><h2>公式和模型术语不熟？从这里开始</h2><p>20 节前置课：数学符号 → 概率统计 → 语言模型 → 扩散与生成方式</p></div><button class="quiet-button" data-view="foundations">前置基础学习 →</button></section>`;
export function foundationCatalogView(query = '', study = {}) {
  const matches = foundationCatalog.filter((l) =>
    `${l.title} ${l.summary} ${l.symbols.flat().join(' ')}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const routes = [
    ['我要读懂概率采样', 'base-probability', '概率 → 条件概率 → CDF → 接受 / 拒绝'],
    ['我要看懂模型计算', 'base-shapes', '形状 → 点积 → Token → Attention'],
    ['我要理解扩散与 MTP', 'base-markov', '状态转移 → 连续扩散 → 离散扩散 → 生成方式对照'],
  ];
  return `<div class="lesson-heading"><div><div class="eyebrow">FOUNDATION COURSE · 20 LESSONS</div><h1>先铺好基础，再走进 vLLM</h1><p>从“这个符号是什么意思”开始，用小数表和图形把公式算明白。无需 GPU 或机器学习训练经验。</p></div><span class="badge">${matches.length} / 20 节</span></div><div class="foundation-start"><div><h2>推荐从第一课开始，也可以按问题补课</h2><p>每课有白话解释、符号表、公式、小算例、可调实验、易错点与理解题。“对应源码”帮助找到概念的应用位置，不把基础数学包装成 vLLM 的专属实现。</p></div><button data-lesson="base-notation">从读懂公式开始 →</button></div><div class="foundation-routes">${routes.map(([title, id, path]) => `<button data-lesson="${id}"><b>${title}</b><span>${path}</span></button>`).join('')}</div>
  ${
    foundationGroups
      .map(([id, title, subtitle], i) => {
        const rows = matches.filter((l) => l.family === id);
        return rows.length
          ? `<section class="algorithm-family"><div class="section-heading"><div><span class="eyebrow">基础 0${i + 1}</span><h2>${title}</h2><p>${subtitle}</p></div><span>${rows.length} 节</span></div><div class="algorithm-cards">${rows.map((row) => `<button class="algorithm-card foundation-card" data-lesson="${row.id}"><span class="algorithm-card-number">${String(foundationCatalog.indexOf(row) + 1).padStart(2, '0')}</span><div><h3>${esc(row.title)}</h3><p>${esc(row.summary)}</p><small>${study.quiz?.[row.id]?.passed ? '✓ 理解题通过' : study.completed?.includes(row.id) ? '◐ 已读' : '直觉 · 手算 · 实验 · 应用'}</small></div><span>↗</span></button>`).join('')}</div></section>`
          : '';
      })
      .join('') || '<p class="empty">没有匹配的基础课，可搜索“概率”“高斯”“扩散”或“矩阵”。</p>'
  }
  <section class="foundation-finish"><h2>基础学完，去哪里用？</h2><p>算法页的“建议先学”已连接所需基础。先学懂概念，再观察真实算法规则和实现分支。</p><div class="algorithm-related"><button data-view="algorithms">进入 24 个算法实验 →</button><button data-view="spec-methods">进入投机方法地图 →</button><button data-lesson="diffusion">查看当前 vLLM 离散扩散实现 →</button></div></section>`;
}
export function foundationIntro(lesson) {
  if (lesson.kind !== 'foundation') return '';
  return `<div class="foundation-intro"><div><span class="eyebrow">为什么先学它</span><p>${esc(lesson.why)}</p></div><button class="quiet-button" data-view="foundations">前置基础目录 ↗</button></div>`;
}
const chips = (rows) =>
  `<div class="foundation-board">${rows.map((r, j) => `<section><h3>${esc(r.label)}</h3><div>${r.values.map((v, i) => `<span data-visual-key="foundation-chip-${j}-${i}" class="${esc(r.status?.[i] || '')}">${esc(number(v))}</span>`).join('') || '<small>尚未生成</small>'}</div></section>`).join('')}</div>`;
function shapesView(f) {
  const tensors = f.tensors.slice(0, f.phase >= 3 ? 2 : 1);
  return `<div class="foundation-tensors">${tensors
    .map(
      (tensor, b) =>
        `<section><h3>${f.phase >= 3 ? 'batch ' + b : '观察范围逐步扩大'}</h3>${tensor
          .slice(0, f.phase >= 2 ? f.S : 1)
          .map(
            (vector, s) =>
              `<div class="foundation-tensor-row"><small>${f.phase >= 2 ? '位置 ' + s : ''}</small>${vector
                .slice(0, f.phase >= 1 ? 2 : 1)
                .map(
                  (v, d) =>
                    `<span data-visual-key="shape-${b}-${s}-${d}"><small>${f.phase >= 1 ? '特征 ' + d : '标量'}</small><b>${v}</b></span>`,
                )
                .join('')}</div>`,
          )
          .join('')}</section>`,
    )
    .join('')}</div>`;
}
function planeView(f) {
  const [x, y] = f.plane.k;
  return `<div class="foundation-plane"><svg viewBox="0 0 300 240" role="img" aria-label="二维向量 q 与 k，点积 ${number(f.score)}"><path d="M20 120H280 M150 15V225" stroke="#bdc9d5"/><circle cx="150" cy="120" r="88" fill="none" stroke="#e0e6ee"/><line x1="150" y1="120" x2="238" y2="120" stroke="#577eaf" stroke-width="3"/><line x1="150" y1="120" x2="${150 + 88 * x}" y2="${120 - 88 * y}" stroke="#2c8b77" stroke-width="4"/><circle cx="${150 + 88 * x}" cy="${120 - 88 * y}" r="5" fill="#2c8b77"/><text x="242" y="115">q</text><text x="${154 + 88 * x}" y="${110 - 88 * y}">k</text></svg><p>蓝色 q=${number(f.q)}<br>绿色 k=${number(f.k)}<br>两向量长度都为 1，点积=${number(f.score)}</p></div>`;
}
function jointView(f) {
  return `<section class="foundation-joint"><h3>联合概率表 P(A,B)</h3><div class="foundation-joint-grid"><span></span><b>B=0</b><b>B=1</b>${f.joint.map((r, i) => `<b>A=${i}</b>${r.map((v, j) => `<span class="${f.highlight && j === f.given ? 'selected' : ''}"><strong>${number(v)}</strong><small>${f.highlight && j === f.given ? '条件列' : '联合质量'}</small></span>`).join('')}`).join('')}</div></section>`;
}
function boxesView(f) {
  return `<div class="foundation-boxes">${f.prior.map((prior, i) => `<section><h3>${i ? '另一个盒子' : '盒子 H'}</h3><p>先验 ${number(prior)}<br>红球似然 ${number(f.likelihood[i])}</p><strong>${number(f.masses[i])}</strong><small>两者相乘的红球质量</small></section>`).join('')}</div>`;
}
function cdfView(f) {
  return `<section class="foundation-cdf"><h3>概率长度尺 · 左闭右开区间</h3><div class="foundation-cdf-track" role="img" aria-label="累积概率边界 ${f.boundaries.map(number).join(', ')}，U=${f.u}">${f.p.map((v, i) => `<span style="width:${v * 100}%;background:${['#6e94bc', '#6dae94', '#d5b878'][i]}">${v > 0.05 ? String.fromCharCode(65 + i) : ''}</span>`).join('')}${f.showPointer ? `<b class="foundation-pointer" style="left:${f.u * 100}%"></b>` : ''}</div><p>0 → ${f.boundaries.map(number).join(' → ')}${f.showPointer ? `　 U=${number(f.u)}` : ''}</p>${f.showWinner ? `<strong>选中 ${String.fromCharCode(65 + f.winner)}</strong>` : ''}</section>`;
}
function linePlot(series, domain, labels, caption) {
  const all = series.flatMap((s) => s.values),
    min = domain?.[0] ?? Math.min(...all, -1),
    max = domain?.[1] ?? Math.max(...all, 1),
    span = max - min || 1,
    x = (i) => 40 + (i * 480) / Math.max(1, Math.max(...series.map((s) => s.values.length)) - 1),
    y = (v) => 180 - ((v - min) * 150) / span;
  return `<figure class="foundation-plot"><svg viewBox="0 0 550 220" role="img" aria-label="${esc(caption)}"><path d="M40 22V180H524" fill="none" stroke="#aebdcd"/><text x="5" y="30">${number(max)}</text><text x="5" y="180">${number(min)}</text>${series.map((s) => `<polyline fill="none" stroke="${s.color}" stroke-width="2.5" points="${s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ')}"/>`).join('')}<text x="40" y="205">${esc(labels[0])}</text><text x="435" y="205">${esc(labels[1])}</text></svg><figcaption>${series.map((s) => `<span style="color:${s.color}">● ${esc(s.label)}</span>`).join(' ')}</figcaption><p>${esc(caption)}</p></figure>`;
}
function monteView(f) {
  if (!f.history.length)
    return '<p class="scene-footnote">尚未抽样，不能把频率写成 0。先单步开始。</p>';
  return (
    linePlot(
      [
        { label: '样本频率', values: f.history, color: '#5188b8' },
        { label: '真实 p', values: f.history.map(() => f.p), color: '#359273' },
      ],
      [0, 1],
      ['样本 1', '样本 ' + f.n],
      '每个点是截至该次的累计频率，波动可能暂时变大。',
    ) +
    chips([
      {
        label: '最近最多 20 次样本',
        values: f.samples,
        status: f.samples.map((v) => (v ? 'accepted' : 'muted')),
      },
    ])
  );
}
function gaussianView(f) {
  const min = f.mu - 4 * f.sigma,
    max = f.mu + 4 * f.sigma,
    peak = Math.max(...f.points.map((p) => p[1])),
    x = (v) => 40 + ((v - min) / (max - min)) * 480,
    y = (v) => 180 - (v / peak) * 145;
  const inside = f.points.filter(([v]) => v >= f.mu - f.sigma - 1e-8 && v <= f.mu + f.sigma + 1e-8);
  return `<figure class="foundation-plot"><svg viewBox="0 0 550 220" role="img" aria-label="高斯密度 μ=${f.mu}、σ=${f.sigma}；一个标准差区间概率约 ${number(f.area)}"><path d="M40 22V180H524" fill="none" stroke="#b2c2d2"/>${f.shade ? `<polygon fill="#cbe4d7" points="${x(inside[0][0])},180 ${inside.map((p) => `${x(p[0])},${y(p[1])}`).join(' ')} ${x(inside.at(-1)[0])},180"/>` : ''}<polyline fill="none" stroke="#527fa9" stroke-width="3" points="${f.points.map((p) => `${x(p[0])},${y(p[1])}`).join(' ')}"/><text x="4" y="28">${number(peak)}</text><text x="38" y="205">${number(min)}</text><text x="275" y="205">μ=${number(f.mu)}</text><text x="495" y="205">${number(max)}</text></svg><figcaption>纵轴是密度，横轴是数值。图仅展示 μ±4σ；真实分布在图外仍有尾部。</figcaption></figure>`;
}
function diffusionView(f) {
  const all = [...f.forward, ...f.reverse],
    domain = [Math.min(-1.5, ...all) - 0.2, Math.max(1.5, ...all) + 0.2];
  return `<div class="foundation-diffusion"><div class="foundation-process-label"><span>前向：数据 → 噪声状态</span><span>反向：另起一条条件采样链</span></div>${linePlot([{ label: '前向轨迹', values: f.forward, color: '#bd9a61' }], domain, ['t=0', 't=' + Math.max(0, f.forward.length - 1)], '单次前向轨迹会随机波动，信号系数随时间下降。')}${f.reverse.length ? linePlot([{ label: '独立反向轨迹', values: f.reverse, color: '#438d7d' }], domain, ['t=' + f.steps, 't=' + Math.max(0, f.steps - f.reverse.length + 1)], '反向条件只读取当前状态和已知玩具先验，不使用前向噪声日志。') : '<p class="scene-footnote">到“独立启动反向链”后再显示生成轨迹。</p>'}</div>`;
}
export function foundationScene(lesson, index, o, frames) {
  const f = frames[index];
  const visual =
    (f.warning ? `<p class="foundation-warning" role="status">${esc(f.warning)}</p>` : '') +
    (f.board ? chips(f.board) : '') +
    (f.shapes ? shapesView(f) : '') +
    (f.plane ? planeView(f) : '') +
    (f.jointGrid ? jointView(f) : '') +
    (f.boxes ? boxesView(f) : '') +
    (f.cdf ? cdfView(f) : '') +
    (f.monteCarlo ? monteView(f) : '') +
    (f.gaussian ? gaussianView(f) : '') +
    (f.diffusion ? diffusionView(f) : '');
  return `<div class="foundation-scene">${algorithmScene(lesson, index, o, frames, visual)}</div>`;
}
