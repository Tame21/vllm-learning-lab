import { scheduleTrace, scheduleMetrics } from './engines/scheduler.mjs';
import { cacheTrace, grammarTrace } from './engines/cache.mjs';
import { speculativeTrace } from './engines/speculative.mjs';
import { tensorParallelTrace, pipelineTrace, moeTrace } from './engines/parallel.mjs';

export const executableIds = [
  'scheduler',
  'chunked',
  'paged',
  'prefix',
  'structured',
  'speculative',
  'tp',
  'pp',
  'moe',
];
export function buildTrace(lesson, options) {
  if (lesson.kind === 'scheduler') return scheduleTrace(options);
  if (lesson.kind === 'cache' || lesson.kind === 'prefix')
    return cacheTrace(lesson.kind === 'prefix', options);
  if (lesson.id === 'structured') return grammarTrace();
  if (lesson.id === 'speculative') return speculativeTrace(options);
  if (lesson.id === 'tp') return tensorParallelTrace(options.ranks);
  if (lesson.id === 'pp') return pipelineTrace(options.ranks, options.microbatches);
  if (lesson.id === 'moe') return moeTrace(options.ranks);
  return lesson.steps.map((s, stepIndex) => ({ ...s, stepIndex }));
}
export function createTraceCache() {
  let key, trace, comparison;
  return (lesson, options) => {
    const next = lesson.id + JSON.stringify(options);
    if (next !== key) {
      trace = buildTrace(lesson, options);
      comparison = null;
      key = next;
      if (lesson.kind === 'scheduler')
        comparison = [false, true].map((chunked) => ({
          label: chunked ? '开启切块' : '关闭切块',
          ...scheduleMetrics(scheduleTrace({ ...options, chunked })),
        }));
    }
    return { trace, comparison };
  };
}
