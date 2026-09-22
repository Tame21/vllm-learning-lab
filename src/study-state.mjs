import { defaults, validateParameters } from './simulations.mjs';

export const storageKey = 'vllm-lab-study-v2';
function restoreOptions(options) {
  // Early v2 drafts stored a manual acceptance knob. Acceptance is computed now.
  const { accepted, ...rest } = options || {};
  return validateParameters(rest);
}
export function emptyStudy() {
  return {
    version: 2,
    sessions: {},
    quiz: {},
    completed: [],
    bookmarks: [],
    lastLesson: 'lifecycle',
  };
}
export function loadStudy(storage, ids) {
  const study = emptyStudy(),
    allowed = new Set(ids);
  try {
    const value = JSON.parse(storage.getItem(storageKey) || 'null');
    if (!value || value.version !== 2) {
      const legacy = JSON.parse(storage.getItem('vllm-lab-completed') || '[]');
      if (Array.isArray(legacy)) study.completed = legacy.filter((id) => allowed.has(id));
      return study;
    }
    for (const field of ['completed', 'bookmarks']) {
      if (Array.isArray(value[field]))
        study[field] = [...new Set(value[field])].filter((id) => allowed.has(id));
    }
    for (const [id, session] of Object.entries(value.sessions || {})) {
      if (!allowed.has(id)) continue;
      try {
        study.sessions[id] = {
          options: restoreOptions(session.options),
          index: validStep(session.index),
          tab: validTab(session.tab),
        };
      } catch {}
    }
    for (const [id, record] of Object.entries(value.quiz || {})) {
      if (allowed.has(id) && record && [0, 1].includes(record.answer))
        study.quiz[id] = {
          answer: record.answer,
          passed: record.passed === true,
          attempts: Math.max(1, Math.min(10000, Number(record.attempts) || 1)),
        };
    }
    if (allowed.has(value.lastLesson)) study.lastLesson = value.lastLesson;
  } catch {
    /* Corrupt or unavailable storage never prevents learning. */
  }
  return study;
}
export function saveStudy(storage, study) {
  try {
    storage.setItem(storageKey, JSON.stringify(study));
    return true;
  } catch {
    return false;
  }
}
function validStep(value = 0) {
  if (!Number.isInteger(value) || value < 0 || value > 255) throw Error('时间轴位置无效');
  return value;
}
function validTab(value = 'explain') {
  return ['explain', 'source', 'quiz'].includes(value) ? value : 'explain';
}
export function decodeRoute(hash, ids) {
  if (!hash || hash === '#') return null;
  if (hash.length > 7000) throw Error('实验链接过长');
  const [id, query = ''] = hash.replace(/^#/, '').split('?');
  if (!ids.includes(id)) throw Error('实验链接中的专题不存在');
  const params = new URLSearchParams(query);
  return {
    id,
    explicit: !!query,
    options: params.has('p') ? restoreOptions(JSON.parse(params.get('p'))) : { ...defaults },
    index: validStep(Number(params.get('step') || 0)),
    tab: validTab(params.get('tab') || 'explain'),
  };
}
export function encodeRoute(id, options, index, tab = 'explain') {
  const params = new URLSearchParams({ step: String(index) });
  const changed = Object.fromEntries(
    Object.entries(options).filter(
      ([key, value]) => JSON.stringify(value) !== JSON.stringify(defaults[key]),
    ),
  );
  if (Object.keys(changed).length) params.set('p', JSON.stringify(changed));
  if (tab !== 'explain') params.set('tab', tab);
  return '#' + id + '?' + params;
}
