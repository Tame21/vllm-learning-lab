import { mechanismDefaults } from '../mechanism-parameters.mjs';
import { specMethods } from '../spec-methods.mjs';
import { algorithmSources as S } from '../algorithm-sources.mjs';
import { ngramTrace } from './algorithms.mjs';
import { snapshot } from './roadmap-core.mjs';
const tokens = (s) => s.trim().split(/\s+/);
const abc = ['A', 'B', 'C'];
const argmax = (values) => values.indexOf(Math.max(...values));
const source = (id, step) => specMethods.find((x) => x.id === id).steps[step].source;
const setup = (id, input) => {
  const o = { ...mechanismDefaults, ...input }, frames = [];
  const state = { method: id, candidates: [], accepted: [], discarded: [], target: [], verification: [], bonus: null, recovered: null, rejected: -1, rows: [], forwards: 0, status: '输入就绪', blocked: false };
  const snap = (step, event, extra = {}) => snapshot(frames, state, step, event, { source: source(id, step), ...extra });
  return { o, state, frames, snap };
};

// A controlled greedy target fixture isolates verification from the proposal.
// No acceptance probability or stochastic p/q is invented for model fixtures.
export function verifyGreedy(state, snap, rejectAt) {
  state.target = state.candidates.map((token, i) => rejectAt === i + 1 ? `${token}_fix` : token);
  state.status = '目标贪心答案就绪';
  const take = (event) => snap(3, event, { source: S.greedyVerify });
  take('教学目标逐位置 argmax 已给出；只允许提交连续匹配前缀。');
  for (let i = 0; i < state.candidates.length; i++) {
    const accepted = state.candidates[i] === state.target[i];
    state.verification.push({ position: i, draft: state.candidates[i], target: state.target[i], accepted });
    if (!accepted) {
      state.rejected = i; state.recovered = state.target[i]; state.discarded = state.candidates.slice(i);
      state.status = `位置 ${i + 1} 首次拒绝`;
      take('保留此前接受前缀，纠正当前项；当前与后续草稿全部丢弃。');
      break;
    }
    state.accepted.push(state.candidates[i]); state.status = `接受位置 ${i + 1}`;
    take(`位置 ${i + 1} 匹配，确认前缀长度 ${state.accepted.length}。`);
  }
  if (state.rejected < 0) {
    state.bonus = 'BONUS'; state.status = state.candidates.length ? '全部接受并追加 bonus' : '无草稿，目标正常生成';
    take(state.candidates.length ? '全收后再输出目标的 bonus token。' : '没有候选；目标直接给出下一枚 token。');
  }
}

export function lookupMethodTrace(id, input = {}) {
  const { o, state, frames, snap } = setup(id, input);
  state.histories = [{ id: 'A', tokens: tokens(o.specHistory), enabled: true, matchStart: -1, matchLength: 0, candidates: [] }];
  if (id === 'ngram-gpu') state.histories.push({ id: 'B', tokens: tokens(o.specHistoryB), enabled: !o.specGpuDisableB, matchStart: -1, matchLength: 0, candidates: [] });
  state.maxN = o.specN; state.width = Math.max(...state.histories.map((x) => x.tokens.length));
  snap(0, '保存每个请求的有效长度；历史补齐格不参与匹配。');
  for (const row of state.histories) {
    const k = Math.min(o.specK, Math.max(0, 24 - row.tokens.length - 1));
    const result = ngramTrace(row.tokens, Math.min(o.specN, row.tokens.length), k).at(-1);
    row.matchStart = result.matchStart; row.matchLength = result.best; row.copyStart = result.start;
    state.status = row.enabled ? `${row.id} 的最长后缀匹配长度 ${result.best}` : `${row.id} 被 combined_mask 屏蔽`;
    snap(1, row.enabled && result.best ? `请求 ${row.id} 最早匹配从 ${result.matchStart} 开始，复制起点 ${result.start}。` : `请求 ${row.id} 不提出候选。`);
    if (row.enabled) for (const token of result.candidates) {
      row.candidates.push(token); state.status = `${row.id} 复制 ${row.candidates.length} 个候选`;
      snap(2, '从历史匹配后的片段逐项复制，不能超过可用长度和教学上下文余量。');
    }
    row.tensor = Array.from({ length: o.specK }, (_, i) => row.candidates[i] ?? -1);
    row.valid = row.candidates.length;
    snap(2, `${row.id} 的有效候选长度 ${row.valid}；−1 填充不进入验证。`);
  }
  state.candidates = [...state.histories[0].candidates];
  verifyGreedy(state, snap, o.specRejectAt);
  return frames;
}

// Small empirical frequency tree, deliberately separate from the external
// SuffixDecodingCache algorithm and its request retention/length policy.
export function suffixMethodTrace(input = {}) {
  const { o, state, frames, snap } = setup('suffix', input);
  state.history = tokens(o.specHistory); state.edges = []; state.path = [];
  const corpus = ['A B C D A B C D', 'A B C E A B C D', 'B C D A B C D'].map(tokens);
  snap(0, '固定片段组成初始频次树；当前请求历史稍后加入。');
  corpus.push(state.history); state.status = '当前历史已计入频次';
  snap(1, '对每个长度不超过窗口的上下文统计后继次数，增加当前请求的已知历史。');
  const sequence = [...state.history], limit = Math.min(o.specK, Math.max(0, 24 - sequence.length - 1));
  for (let i = 0; i < limit; i++) {
    let counts = new Map(), pattern = [];
    for (let n = Math.min(o.specN, sequence.length); n >= 1; n--) {
      pattern = sequence.slice(-n); counts = new Map();
      for (const text of corpus) for (let p = 0; p + n < text.length; p++)
        if (pattern.every((token, j) => token === text[p + j])) counts.set(text[p + n], (counts.get(text[p + n]) ?? 0) + 1);
      if (counts.size) break;
    }
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    state.edges = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([token, count]) => ({ pattern, token, count, probability: count / total }));
    const winner = state.edges[0]; state.status = winner ? `后缀 ${pattern.join(' ')} 的最常见后继 ${winner.token}` : '树中无可用后继';
    snap(2, '读取当前节点后继频次，按条件频率选择最常见项。');
    if (!winner || winner.probability < o.specMinProb) { state.status = '路径停止'; snap(2, winner ? '最高频后继低于门限，停止提出候选。' : '未知后缀没有证据，停止提出候选。'); break; }
    state.path.push(winner); state.candidates.push(winner.token); sequence.push(winner.token);
    snap(2, '提交一个树路径候选，新的后缀继续查询下一层。');
  }
  if (!limit) snap(2, '上下文余量为零，不提出候选。');
  verifyGreedy(state, snap, o.specRejectAt);
  return frames;
}

export function serialMethodTrace(id, input = {}) {
  const { o, state, frames, snap } = setup(id, input);
  state.anchor = abc[o.specAnchor]; state.kv = []; state.hidden = [o.specFeature, 1]; state.aux = [];
  const layers = id === 'eagle3' ? o.specAuxLayers : 1;
  state.status = id === 'mlp-spec' ? '教学级联可观察，运行路径未接入' : '匹配草稿路径';
  snap(0, id === 'mtp' ? '观察 MTPSpeculator 继承的多步路径；只在匹配模型具备两个接口时共享索引。' : '教学网络使用三词词表和固定二维特征，不加载真实模型。');
  state.aux = Array.from({ length: layers }, (_, i) => [o.specFeature + i / 10, 1]);
  state.featureWidth = id === 'draft-model' ? 0 : state.aux.flat().length;
  snap(1, id === 'eagle3' ? `${layers} 层二维辅助特征按同一位置拼接为 ${state.featureWidth} 维。` : id === 'draft-model' ? '独立草稿只读取自己的 token 历史与 KV。' : '当前 token、position 与对应隐藏状态组成同一行输入。');
  let previous = o.specAnchor;
  for (let i = 0; i < o.specK; i++) {
    const hiddenInput = [...state.hidden], offset = ['eagle', 'eagle3', 'mlp-spec'].includes(id) ? Math.round(hiddenInput[0]) : 0;
    const winner = (previous + 1 + offset) % 3;
    const logits = abc.map((_, j) => j === winner ? 3 : 0);
    const row = { position: 4 + i, input: abc[previous], output: abc[argmax(logits)], logits, hiddenInput, width: state.featureWidth, indexState: id === 'mtp' ? i === 0 || !o.specMtpShare ? '重新计算' : '复用首轮索引' : '不适用' };
    state.rows.push(row); state.forwards++; state.kv.push({ position: row.position, token: row.input }); state.candidates.push(row.output);
    state.hidden = [winner / 2, hiddenInput[1] + 0.1]; previous = winner;
    state.status = `候选 ${i + 1} 已起草`;
    snap(2, id === 'mlp-spec' ? '前级预测 token 的 embedding 与递推特征组成后级输入；没有接入 Runner 执行。' : '本轮输出成为下一轮 token 输入；只为已输入位置记录草稿 KV。');
  }
  if (id === 'mlp-spec') { state.blocked = true; state.status = '当前源码未接入 · 禁止执行'; snap(3, 'registry 中此模型仍未注册；GPUModelRunner 会拒绝未知方法，不进入目标验证。'); }
  else verifyGreedy(state, snap, o.specRejectAt);
  return frames;
}

export function parallelMethodTrace(id, input = {}) {
  const { o, state, frames, snap } = setup(id, input);
  state.anchor = abc[o.specAnchor]; state.context = Array.from({ length: o.specContext }, (_, i) => i); state.queries = []; state.hidden = [o.specFeature, 1];
  snap(0, id === 'medusa' ? '目标隐藏状态由所有预测头共享。' : '已处理上下文与本轮查询位置分开保存。');
  const queryBase = id === 'medusa' || id === 'parallel-draft' ? 4 : o.specContext;
  const anchorPredicts = id === 'parallel-draft' || id === 'dspark' && o.specAnchorPrediction;
  state.anchorPredicts = anchorPredicts;
  state.queries = id === 'medusa' ? Array.from({ length: o.specK }, (_, i) => ({ position: queryBase + i, input: '共享 h', kind: 'head' })) : Array.from({ length: o.specK + (anchorPredicts ? 0 : 1) }, (_, i) => ({ position: queryBase + i, input: i ? id === 'dspark' ? 'noise' : 'mask' : state.anchor, kind: i ? 'query' : 'anchor' }));
  snap(1, id === 'medusa' ? '不同预测头读取同一个隐藏状态，各头没有前一候选依赖。' : anchorPredicts ? 'K 个查询，anchor 所在位置预测第一枚候选，其余 K−1 位置填充查询 token。' : '1+K 查询，anchor 后有 K 个查询位置；只在这些位置取候选。');
  if (id === 'parallel-draft' && !o.specParallelTrained) {
    state.blocked = true; state.status = '并行训练配置不匹配'; snap(2, '缺少并行训练约定，不能把串行草稿直接当成 PARD。'); snap(2, '没有骨干前向，也没有有效候选。'); snap(3, '阻止这条方法路径进入验证。'); return frames;
  }
  const baseLogits = Array.from({ length: o.specK }, (_, i) => abc.map((_, j) => j === (o.specAnchor + i + 2 + (id === 'medusa' ? o.specFeature : 0)) % 3 ? 1.5 : 0));
  state.baseLogits = baseLogits; state.forwards = id === 'medusa' ? 0 : 1;
  snap(2, id === 'medusa' ? '各预测头得到各自 logits，尚未组成候选序列。' : '一次骨干前向为所有查询位置产生基础 logits。');
  let previous = o.specAnchor;
  for (let i = 0; i < o.specK; i++) {
    const bias = abc.map((_, j) => id === 'dspark' && j === (previous + 1) % 3 ? o.specMarkov : 0);
    const logits = baseLogits[i].map((x, j) => x + bias[j]), winner = argmax(logits);
    state.rows.push({ position: queryBase + i + (id === 'medusa' ? 0 : 1), input: id === 'dspark' ? abc[previous] : id === 'medusa' ? '共享 h' : 'query', output: abc[winner], base: baseLogits[i], logits, bias, dependency: id === 'dspark' ? i ? `候选 ${i}` : 'anchor' : '无前一候选依赖' });
    state.candidates.push(abc[winner]); previous = winner; state.status = `候选位置 ${i + 1} 就绪`;
    snap(2, id === 'dspark' ? '基础 logits 加上一 token 的 Markov 偏置；当前候选成为下一位置的 prev。' : '按位置收集各头 / 查询的 argmax；逐行显示仅为观察顺序，不增加骨干调用。');
  }
  verifyGreedy(state, snap, o.specRejectAt);
  return frames;
}

export const roadmapSpecTraces = {
  ngram: (o) => lookupMethodTrace('ngram', o), 'ngram-gpu': (o) => lookupMethodTrace('ngram-gpu', o), suffix: suffixMethodTrace,
  ...Object.fromEntries(['draft-model', 'eagle', 'eagle3', 'mtp', 'mlp-spec'].map((id) => [id, (o) => serialMethodTrace(id, o)])),
  ...Object.fromEntries(['medusa', 'parallel-draft', 'dflash', 'dspark'].map((id) => [id, (o) => parallelMethodTrace(id, o)])),
};
