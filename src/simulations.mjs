import { scheduleTrace, validateRequests } from './engines/scheduler.mjs';
import { prefixResult } from './engines/cache.mjs';
export { scheduleTrace, prefixResult };
export const defaults = {
  budget: 8,
  blockSize: 4,
  capacity: 16,
  chunked: true,
  prefix: 8,
  salt: false,
  drafts: 4,
  temperature: 1,
  topP: 0.9,
  bits: 8,
  ranks: 2,
  quality: 50,
  seed: 42,
  microbatches: 3,
  prefixEnabled: true,
};
export function validateParameters(input, current = defaults) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('参数必须为对象');
  const rules = {
    budget: [4, 16, 4],
    capacity: [4, 20, 2],
    prefix: [0, 12, 1],
    drafts: [1, 6, 1],
    temperature: [0, 2, 0.1],
    topP: [0.1, 1, 0.05],
    bits: [4, 8, 4],
    ranks: [2, 4, 1],
    blockSize: [2, 8, 2],
    quality: [0, 100, 10],
    seed: [1, 9999, 1],
    microbatches: [1, 6, 1],
  };
  for (const [key, value] of Object.entries(input)) {
    if (['chunked', 'salt', 'prefixEnabled'].includes(key)) {
      if (typeof value !== 'boolean') throw Error(`${key} 必须为布尔值`);
      continue;
    }
    if (key === 'requests') {
      validateRequests(value);
      continue;
    }
    if (key === 'blockSize' && ![2, 4, 8].includes(value)) throw Error('blockSize 只支持 2、4、8');
    const rule = rules[key];
    if (!rule) throw Error(`未知参数：${key}`);
    const [min, max, step] = rule;
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      value < min ||
      value > max ||
      Math.abs((value - min) / step - Math.round((value - min) / step)) > 1e-7
    )
      throw Error(`${key} 不在支持范围内`);
  }
  const next = { ...current, ...input };
  if (next.requests) next.requests = validateRequests(next.requests);
  return next;
}
export function sampleDistribution(temperature = 1, topP = 0.9) {
  const logits = [3.2, 2.4, 1.6, 0.8, 0.1],
    words = ['缓存', '模型', '显存', '调度', '苹果'];
  if (temperature === 0)
    return words.map((word, i) => ({
      word,
      prob: i === 0 ? 1 : 0,
      raw: i === 0 ? 1 : 0,
      kept: i === 0,
    }));
  const exps = logits.map((v) => Math.exp((v - logits[0]) / temperature)),
    sum = exps.reduce((a, b) => a + b, 0);
  let cumulative = 0;
  const values = exps.map((v, i) => {
    const raw = v / sum,
      kept = cumulative < topP;
    cumulative += raw;
    return { word: words[i], raw, kept };
  });
  const keptSum = values.filter((v) => v.kept).reduce((a, v) => a + v.raw, 0);
  return values.map((v) => ({ ...v, prob: v.kept ? v.raw / keptSum : 0 }));
}
export function quantize(bits = 8) {
  const values = [-1.2, -0.76, -0.31, 0.08, 0.47, 0.91, 1.08, 1.4];
  const max = 2 ** (bits - 1) - 1,
    scale = Math.max(...values.map(Math.abs)) / max;
  return {
    scale,
    values: values.map((value) => {
      const q = Math.round(value / scale);
      return { value, q, restored: q * scale, error: Math.abs(value - q * scale) };
    }),
  };
}
export function stageFor(lesson, index, options = defaults) {
  const value = { ...lesson.steps[Math.min(index, lesson.steps.length - 1)] };
  if (lesson.kind === 'prefix') {
    const r = prefixResult(options.prefix, options.salt || !options.prefixEnabled);
    if (index === 2) {
      value.change = `B 命中 ${r.hit} 个 token，剩余 ${r.computed} 个需计算`;
      value.body = options.salt
        ? 'B 使用不同 cache salt，缓存键不同；即使 token 一样，也不能命中 A 的缓存。'
        : `相同前缀为 ${options.prefix} 个 token，按 4 token 整块对齐后命中 ${r.hit} 个。此源码为获取 logits 至少保留最后一个 token 的计算，因此 12 token 完全相同也只能在这个例子中复用前 8 个。`;
    }
    if (index === 3)
      value.change = r.blocks
        ? `${r.blocks} 个共享块的 ref_cnt = 2`
        : '没有缓存命中，A、B 独立分配物理块';
    if (index === 4) value.change = `B 计算 ${r.computed} 个未命中 token；decode 仍需执行`;
  }
  return value;
}
