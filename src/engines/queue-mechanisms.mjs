import { scheduleTrace, exampleRequests } from './scheduler.mjs';
import { mechanismDefaults } from '../mechanism-parameters.mjs';

export function queueMechanismTrace(id, input = {}) {
  const o = { ...mechanismDefaults, ...input };
  const isPriority = id === 'priority';
  const requests = isPriority
    ? [
        { id: 'A', prompt: 8, max: 3, arrival: 0 },
        { id: 'B', prompt: 4, max: 3, arrival: 0 },
        { id: 'C', prompt: 12, max: 3, arrival: 0 },
      ]
    : exampleRequests;
  const settings = {
    budget: 8,
    capacity: o.memoryBlocks,
    blockSize: 4,
    chunked: true,
    requests,
    policy: isPriority && o.priorityMode ? 'priority' : 'fcfs',
    priorityValues: { A: o.priorityA, B: o.priorityB, C: o.priorityC },
    cancelAt: isPriority ? 0 : o.cancelAt,
  };
  const frames = [];
  const steps = isPriority
    ? {
        initial: 0,
        arrival: 0,
        queue: 1,
        allocate: 2,
        compute: 2,
        recompute: 2,
        sample: 2,
        wait: 2,
        preempt: 3,
        finish: 2,
        cancel: 2,
        blocked: 2,
      }
    : {
        initial: 0,
        arrival: 0,
        queue: 0,
        allocate: 0,
        compute: 0,
        sample: 0,
        wait: 0,
        preempt: 1,
        recompute: 2,
        finish: 3,
        cancel: 3,
        blocked: 0,
      };
  const baseline = scheduleTrace({
    ...settings,
    policy: settings.policy === 'priority' ? 'fcfs' : 'priority',
  });
  const otherOrder = [];
  for (const f of baseline)
    for (const a of f.allocations) if (!otherOrder.includes(a.id)) otherOrder.push(a.id);
  const firstRun = [];
  scheduleTrace(settings, (f) => {
    if (f.kind === 'compute' && !firstRun.includes(f.requestId)) firstRun.push(f.requestId);
    frames.push({
      ...f,
      stepIndex: steps[f.kind],
      policy: settings.policy,
      firstRun: [...firstRun],
      otherOrder,
    });
  });
  return frames;
}
