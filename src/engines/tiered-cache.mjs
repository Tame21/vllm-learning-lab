import { mechanismDefaults } from '../mechanism-parameters.mjs';

export function tieredCacheTrace(input = {}) {
  const o = { ...mechanismDefaults, ...input }, frames = [];
  const order = [o.offloadTarget, ...Array.from({ length: 6 }, (_, i) => i).filter((i) => i !== o.offloadTarget)];
  const seed = order.filter((id) => o.offloadHit || id !== o.offloadTarget).slice(0, o.offloadCpuCapacity);
  const state = {
    cpu: Array.from({ length: 6 }, (_, id) => ({ id, valid: seed.includes(id), used: 0 })),
    external: Array.from({ length: 6 }, (_, id) => ({ id, valid: o.offloadExternalCapacity > 0 && o.offloadExternalHit && id === o.offloadTarget, used: 0 })),
    gpu: [{ id: 0, slot: 0, used: 0 }], pending: null, current: 0, round: 0, time: 0,
    accesses: [0, o.offloadTarget, 1, o.offloadTarget, 0], reads: [], loads: 0, stores: 0, archives: 0, restores: 0, recomputes: 0, hits: 0, evictions: [], status: '三层缓存就绪',
  };
  const record = (stepIndex, event) => frames.push(structuredClone({ ...state, stepIndex, events: [event] }));
  const transfer = (direction, id, from, to, slot = null) => {
    state.pending = { direction, id, from, to, slot, progress: 0, duration: o.offloadDelay };
    state.status = `${from} → ${to} 传输`;
    record(2, `提交 H${id} / group 0，从 ${from} 到 ${to}；目标副本仍无效。`);
    for (let tick = 0; tick < o.offloadDelay; tick++) {
      state.time++;
      state.pending.progress++;
      record(2, `H${id} 进度 ${state.pending.progress}/${o.offloadDelay}；等待独立完成确认，禁止读目标。`);
    }
  };
  const oldest = (blocks) => blocks.filter((b) => b.valid).sort((a, b) => a.used - b.used || a.id - b.id)[0];
  let pinnedExternal = null;
  const roomExternal = () => {
    if (state.external.filter((b) => b.valid).length < o.offloadExternalCapacity) return;
    const victim = oldest(state.external.filter((b) => b.id !== pinnedExternal));
    victim.valid = false;
    state.evictions.push({ tier: '外部', id: victim.id });
    record(1, `外部层容量已满，LRU 淘汰 H${victim.id}；若其他层也缺失，后续只能重算。`);
  };
  const roomCpu = () => {
    if (state.cpu.filter((b) => b.valid).length < o.offloadCpuCapacity) return;
    const victim = oldest(state.cpu);
    const canArchive = state.external.filter((b) => b.valid).length < o.offloadExternalCapacity || state.external.some((b) => b.valid && b.id !== pinnedExternal);
    if (o.offloadExternalCapacity > 0 && !state.external[victim.id].valid && canArchive) {
      roomExternal();
      transfer('archive', victim.id, 'CPU', '外部');
      state.external[victim.id].valid = true;
      state.external[victim.id].used = state.round;
      state.archives++;
      state.pending = null;
      record(2, `外部副本 H${victim.id} 确认完成，CPU 原副本此时仍保留。`);
    }
    victim.valid = false;
    state.evictions.push({ tier: 'CPU', id: victim.id });
    record(1, `CPU LRU 淘汰 H${victim.id}，释放一个容量槽。`);
  };
  record(0, `六个独立教学块；容量 GPU ${o.offloadCapacity}、CPU ${o.offloadCpuCapacity}、外部 ${o.offloadExternalCapacity}。GPU 初始驻留块 0。`);
  for (const [index, id] of state.accesses.entries()) {
    state.current = id;
    state.round = index + 1;
    record(0, `访问 H${id}：依次查找 GPU、CPU、外部层。`);
    let resident = state.gpu.find((b) => b.id === id);
    if (resident) {
      state.hits++;
      record(1, `GPU 命中 H${id}。`);
    } else {
      if (state.gpu.length >= o.offloadCapacity) {
        const victim = [...state.gpu].sort((a, b) => a.used - b.used)[0];
        if (!state.cpu[victim.id].valid) {
          roomCpu();
          transfer('store', victim.id, 'GPU', 'CPU');
          state.cpu[victim.id].valid = true;
          state.cpu[victim.id].used = state.round;
          state.stores++;
          state.pending = null;
          record(2, `CPU 已确认 H${victim.id}；现在才允许释放源 GPU 槽。`);
        }
        state.gpu = state.gpu.filter((b) => b !== victim);
        record(1, `释放 GPU LRU 槽 ${victim.slot}。`);
      }
      const slot = Array.from({ length: o.offloadCapacity }, (_, i) => i).find((i) => !state.gpu.some((b) => b.slot === i));
      if (!state.cpu[id].valid && state.external[id].valid) {
        // Reserve CPU capacity before starting the restore; the external source stays valid.
        state.external[id].used = state.round;
        pinnedExternal = id;
        roomCpu();
        transfer('restore', id, '外部', 'CPU');
        state.cpu[id].valid = true;
        state.cpu[id].used = state.round;
        state.restores++;
        pinnedExternal = null;
        state.pending = null;
        record(2, `外部 → CPU 的 H${id} 已完成，后续才可提交 CPU → GPU。`);
      }
      if (state.cpu[id].valid) {
        state.cpu[id].used = state.round;
        transfer('load', id, 'CPU', 'GPU', slot);
        resident = { id, slot, used: state.round };
        state.gpu.push(resident);
        state.loads++;
        state.pending = null;
        record(2, `GPU 槽 ${slot} 的 H${id} 完成确认，可以消费。`);
      } else {
        state.recomputes++;
        resident = { id, slot, used: state.round };
        state.gpu.push(resident);
        record(2, `三层均缺失 H${id}，示例重算后写入 GPU 槽 ${slot}。`);
      }
    }
    resident.used = state.round;
    state.reads.push(id);
    state.status = '读取有效 GPU 副本';
    record(3, `读取 H${id} / GPU 槽 ${resident.slot}，没有未完成依赖。`);
  }
  record(3, '访问序列完成；容量、缓存键、物理位置和有效性分别观察。');
  return frames;
}
