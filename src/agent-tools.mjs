import { defaults } from './simulations.mjs';

export function parameterNames(lesson) {
  if (lesson.id === 'pp') return ['ranks', 'microbatches'];
  return (
    {
      scheduler: ['budget', 'capacity', 'blockSize', 'chunked', 'requests'],
      prefix: ['prefix', 'salt', 'prefixEnabled'],
      speculative: ['drafts', 'quality', 'seed'],
      sampling: ['temperature', 'topP'],
      quant: ['bits'],
      parallel: ['ranks'],
    }[lesson.kind] || []
  );
}
export function registerAgentTools(api) {
  const context = document.modelContext;
  if (!context?.registerTool) return;
  const controller = new AbortController();
  const schema = Object.fromEntries(
    Object.entries(defaults)
      .filter(([key]) => key !== 'accepted')
      .map(([key, value]) => [key, { type: typeof value === 'boolean' ? 'boolean' : 'number' }]),
  );
  schema.requests = {
    type: 'array',
    minItems: 1,
    maxItems: 6,
    items: {
      type: 'object',
      required: ['id', 'prompt', 'max', 'arrival'],
      additionalProperties: false,
      properties: {
        id: { type: 'string', enum: [...'ABCDEF'] },
        prompt: { type: 'integer', minimum: 1, maximum: 32 },
        max: { type: 'integer', minimum: 1, maximum: 16 },
        arrival: { type: 'integer', minimum: 0, maximum: 12 },
      },
    },
  };
  const tool = (name, title, description, inputSchema, execute, readOnlyHint = false) => ({
    name,
    title,
    description,
    inputSchema,
    execute,
    annotations: { readOnlyHint, untrustedContentHint: false },
  });
  const registrations = [
    tool(
      'read_vllm_lab_state',
      '读取学习实验状态',
      '读取当前专题、参数与可视化执行记录，不修改页面。',
      { type: 'object', properties: {}, additionalProperties: false },
      api.readState,
      true,
    ),
    tool(
      'navigate_vllm_lesson',
      '切换学习专题',
      '按专题 ID 打开内容，并恢复该专题在本机保存的参数与步骤。',
      {
        type: 'object',
        required: ['lessonId'],
        additionalProperties: false,
        properties: { lessonId: { type: 'string', enum: api.lessons.map((l) => l.id) } },
      },
      (input) => {
        if (!api.lessons.some((l) => l.id === input?.lessonId)) throw Error('专题 ID 不存在');
        api.select(input.lessonId);
        return api.readState();
      },
    ),
    tool(
      'configure_vllm_simulation',
      '调整教学模拟参数',
      '修改当前专题可见参数，从第一个步骤重新推演。不执行真实模型。',
      {
        type: 'object',
        required: ['parameters'],
        additionalProperties: false,
        properties: {
          parameters: { type: 'object', properties: schema, additionalProperties: false },
        },
      },
      (input) => {
        if (
          !input?.parameters ||
          Object.keys(input.parameters).some((k) => !parameterNames(api.lesson()).includes(k))
        )
          throw Error('参数不属于当前可视化');
        api.configure(input.parameters);
        return api.readState();
      },
    ),
    tool(
      'set_vllm_simulation_step',
      '跳到指定执行步骤',
      '暂停播放并跳转到零起始编号的步骤。',
      {
        type: 'object',
        required: ['step'],
        additionalProperties: false,
        properties: { step: { type: 'integer', minimum: 0 } },
      },
      (input) => {
        if (!Number.isInteger(input?.step) || input.step < 0 || input.step >= api.frames().length)
          throw Error('步骤超出当前专题范围');
        api.pause();
        api.jump(input.step);
        return api.readState();
      },
    ),
  ];
  for (const registration of registrations) {
    try {
      Promise.resolve(context.registerTool(registration, { signal: controller.signal })).catch(
        () => {},
      );
    } catch {}
  }
  window.addEventListener('pagehide', () => controller.abort(), { once: true });
}
