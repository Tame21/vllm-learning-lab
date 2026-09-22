// A static CLI reader, not a shell. Never run the pasted text or resolve $variables.
const definitions = Object.create(null);
function define(names, type, area, source = 'args') {
  for (const name of names.split(' ')) definitions[name] = { type, area, source };
}
define('model tokenizer dtype revision model-impl load-format', 'text', '模型加载', 'loader');
define('runner', 'runner', '任务类型', 'config');
define('quantization', 'text', '量化实现', 'quantization');
define('distributed-executor-backend data-parallel-backend', 'text', '执行器 / 并行', 'parallel');
define(
  'tensor-parallel-size pipeline-parallel-size data-parallel-size nnodes',
  'positive',
  '并行拓扑',
  'parallel',
);
define(
  'max-num-batched-tokens max-num-seqs max-model-len block-size max-loras max-lora-rank',
  'positive',
  '容量与调度',
);
define('port', 'port', 'HTTP 监听', 'routers');
define(
  'api-server-count data-parallel-size-local data-parallel-rank data-parallel-start-rank',
  'nonnegative',
  '进程布局',
  'cli',
);
define('gpu-memory-utilization', 'ratio', 'KV Cache 容量', 'kvInit');
define('cpu-offload-gb', 'nonnegativeNumber', '模型权重卸载', 'loader');
define('enable-prefix-caching enable-chunked-prefill', 'bool', '缓存 / 调度', 'defaults');
define('async-scheduling', 'bool', '调度实现', 'validation');
define('enforce-eager', 'bool', '编译与 CUDA Graph', 'validation');
define('enable-lora', 'bool', 'LoRA', 'lora');
define('enable-expert-parallel enable-eplb', 'bool', '专家并行', 'parallel');
define(
  'headless data-parallel-external-lb data-parallel-hybrid-lb data-parallel-multi-port-external-lb',
  'bool',
  '服务部署',
  'cli',
);
define('trust-remote-code', 'bool', '模型配置', 'config');
define('enable-auto-tool-choice', 'bool', '工具调用', 'chat');
define('host', 'text', 'HTTP 监听', 'routers');
define('kv-cache-dtype', 'text', 'KV Cache', 'kvInit');
define('chat-template reasoning-parser tool-call-parser', 'text', '请求与响应格式', 'chat');
define('speculative-config', 'json', '投机解码', 'speculative');
define('spec-method spec-model', 'text', '投机解码', 'speculative');
define('spec-tokens', 'positive', '投机解码', 'speculative');
define('compilation-config', 'json', '编译与 CUDA Graph', 'validation');
define('attention-config', 'json', 'Attention 后端', 'attention');
define('structured-outputs-config', 'json', '结构化输出', 'structured');
define('kv-transfer-config', 'json', '跨实例 KV 传输', 'transfer');
define('limit-mm-per-prompt', 'json', '多模态配额', 'input');
define('served-model-name lora-modules', 'list', 'API 模型名 / 适配器', 'routers');
define('api-key', 'list', '接口认证', 'routers');
define('hf-token', 'text', '模型下载认证', 'config');
define('config', 'text', '外部配置文件', 'config');
define('scheduler-cls worker-cls', 'text', '自定义实现', 'config');
define('grpc omni', 'bool', '其他服务入口', 'cli');
export const commandOptions = Object.freeze(definitions);
const aliases = {
  '-tp': 'tensor-parallel-size',
  '-pp': 'pipeline-parallel-size',
  '-dp': 'data-parallel-size',
  '-q': 'quantization',
  '-sc': 'speculative-config',
  '-cc': 'compilation-config',
  '-n': 'nnodes',
};
const unsafeKeys = new Set(['__proto__', 'prototype', 'constructor']);
export const isSensitiveOption = (key) =>
  /api[-_]?key|hf[-_]?token|password|secret|access[-_]?token/i.test(key);

export function tokenizeCommand(text) {
  if (text.length > 24000) throw Error('命令过长；请保留启动命令和参数，最多 24,000 个字符。');
  const tokens = [];
  let word = '',
    started = false,
    quote = '';
  const flush = () => {
    if (started) tokens.push(word);
    word = '';
    started = false;
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i],
      next = text[i + 1];
    if (quote === "'") {
      if (ch === "'") {
        if (next === "'") {
          word += "'";
          i++;
        } else quote = '';
      } else word += ch;
      continue;
    }
    if ((ch === '\\' || ch === '`' || ch === '^') && (next === '\n' || next === '\r')) {
      i += next === '\r' && text[i + 2] === '\n' ? 2 : 1;
      continue;
    }
    if (quote === '"') {
      if (ch === '"') quote = '';
      else if ((ch === '\\' || ch === '`') && ['"', '\\', '$', '`'].includes(next)) {
        word += next;
        i++;
      } else word += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      started = true;
    } else if (/\s/.test(ch)) flush();
    else if (ch === '#' && !started) {
      while (i + 1 < text.length && text[i + 1] !== '\n') i++;
    } else if (';|&<>'.includes(ch))
      throw Error('请只粘贴一条启动命令；暂不解析管道、重定向或多条 shell 语句。');
    else if (ch === '`') throw Error('反引号仅支持行尾续行；不解析 shell 命令替换。');
    else if (ch === '\\' && next && /[\s"'\\]/.test(next)) {
      word += next;
      started = true;
      i++;
    } else {
      word += ch;
      started = true;
    }
  }
  if (quote) throw Error('引号没有闭合，请检查模型路径或 JSON 参数的引号。');
  flush();
  return tokens;
}

function cast(value, type, flag) {
  if (type === 'json') {
    let parsed;
    try {
      parsed = JSON.parse(value);
    } catch {
      throw Error(`${flag} 需要合法 JSON；请用单引号包裹 JSON 对象。`);
    }
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object')
      throw Error(`${flag} 需要 JSON 对象。`);
    return parsed;
  }
  if (type === 'runner' && !['auto', 'generate', 'pooling', 'draft'].includes(value))
    throw Error(`${flag} 支持 auto、generate、pooling 或 draft。`);
  if (['positive', 'nonnegative', 'ratio', 'port', 'nonnegativeNumber'].includes(type)) {
    if (flag === '--max-model-len' && ['auto', '-1'].includes(String(value).toLowerCase()))
      return -1;
    // vLLM human-readable lengths accept 1k = 1000 and 1K = 1024.
    const match = String(value).match(/^(\d+(?:\.\d+)?)([kKmMgGtT])$/);
    const exponent = match ? 'kmgt'.indexOf(match[2].toLowerCase()) + 1 : 0;
    const numeric = match
      ? Math.trunc(
          Number(match[1]) * (match[2] === match[2].toLowerCase() ? 1000 : 1024) ** exponent,
        )
      : Number(value);
    const lengthFlag = ['--max-model-len', '--max-num-batched-tokens'].includes(flag);
    if (
      (match && (!lengthFlag || (match[2] === match[2].toUpperCase() && match[1].includes('.')))) ||
      (!match &&
        ['positive', 'nonnegative', 'port'].includes(type) &&
        !/^\+?\d+$/.test(String(value))) ||
      !String(value).trim() ||
      !Number.isFinite(numeric) ||
      (['positive', 'nonnegative', 'port'].includes(type) && !Number.isSafeInteger(numeric)) ||
      numeric < (['positive', 'port'].includes(type) ? 1 : 0) ||
      (type === 'ratio' && (numeric <= 0 || numeric > 1)) ||
      (type === 'port' && numeric > 65535)
    ) {
      throw Error(
        `${flag} 数值无效${type === 'ratio' ? '，应大于 0 且不超过 1' : type === 'port' ? '，应在 1–65535 之间' : '，请使用允许范围内的数字'}。`,
      );
    }
    return numeric;
  }
  return value;
}

export function parseCommand(text) {
  const result = {
    options: Object.create(null),
    env: Object.create(null),
    parameters: [],
    unknown: [],
    warnings: [],
    errors: [],
    entry: 'serve',
  };
  try {
    const tokens = tokenizeCommand(text.trim());
    if (!tokens.length) throw Error('请先输入 vllm serve 启动命令。');
    let i = 0;
    if (tokens[0] === 'env') i++;
    while (/^[A-Za-z_]\w*=/.test(tokens[i] || '')) {
      const at = tokens[i].indexOf('='),
        name = tokens[i].slice(0, at),
        value = tokens[i].slice(at + 1);
      result.env[name] = value;
      result.parameters.push({
        name,
        value,
        kind: 'env',
        area: name === 'VLLM_USE_V2_MODEL_RUNNER' ? 'Runner 选择' : '环境设置（未推导）',
        source: 'runnerChoice',
      });
      i++;
    }
    const executable = tokens[i]?.split(/[\\/]/).at(-1);
    if (/^vllm(?:\.exe)?$/.test(executable) && tokens[i + 1] === 'serve') i += 2;
    else if (
      /^(?:python(?:\d+(?:\.\d+)?)?|py)(?:\.exe)?$/.test(executable) &&
      tokens[i + 1] === '-m' &&
      [
        'vllm.entrypoints.openai.api_server',
        'vllm.entrypoints.launchers.api_server.entry',
      ].includes(tokens[i + 2])
    ) {
      result.entry = 'python';
      i += 3;
    } else
      throw Error(
        '支持 vllm serve [模型] ... 或 python -m vllm.entrypoints.openai.api_server ...；容器 / torchrun 命令请取其中的 vLLM 启动部分。',
      );
    let positional;
    const dotted = Object.create(null);
    while (i < tokens.length) {
      const token = tokens[i++];
      if (!token.startsWith('-')) {
        if (result.entry === 'serve' && positional === undefined) {
          positional = token;
          continue;
        }
        throw Error(
          '发现额外的位置参数；请检查缺少的 --参数名，或是否给布尔开关多写了 true / false。',
        );
      }
      const equal = token.indexOf('=');
      const rawName = equal < 0 ? token : token.slice(0, equal);
      const [rawBase, ...rawFields] = rawName.split('.');
      let name = aliases[rawBase] || rawBase.replace(/^--/, '').replaceAll('_', '-');
      if (!aliases[rawBase] && rawFields.length) name += '.' + rawFields.join('.');
      if (aliases[rawName.split('.')[0]] && rawName.includes('.'))
        name += rawName.slice(rawName.indexOf('.'));
      let negative = name.startsWith('no-');
      if (negative) name = name.slice(3);
      const [base, ...fields] = name.split('.');
      const appendList = fields.at(-1)?.endsWith('+');
      if (appendList) fields[fields.length - 1] = fields.at(-1).slice(0, -1);
      const def = definitions[base];
      let value = equal < 0 ? undefined : token.slice(equal + 1);
      if (!def || (negative && def.type !== 'bool') || (fields.length && def.type !== 'json')) {
        if (value === undefined && tokens[i] && !tokens[i].startsWith('-')) value = tokens[i++];
        result.unknown.push({ name: rawName, value });
        continue;
      }
      if (def.type === 'bool') {
        if (value !== undefined)
          throw Error(`${rawName} 是开关，不接收值；关闭时使用 --no-${base}。`);
        value = !negative;
      } else {
        if (value === undefined) {
          if (tokens[i] === undefined || (/^-/.test(tokens[i]) && !/^-\d/.test(tokens[i])))
            throw Error(`${rawName} 缺少参数值。`);
          value = tokens[i++];
        }
        if (def.type === 'list') {
          value = [value];
          while (tokens[i] !== undefined && !tokens[i].startsWith('-')) value.push(tokens[i++]);
        } else if (fields.length) {
          if (appendList) value = value.split(',');
          else
            try {
              value = JSON.parse(value);
            } catch {
              if (/^\d+(?:\.\d+)?[kKmMgGtT]$/.test(value)) {
                try {
                  value = cast(value, 'positive', '--max-num-batched-tokens');
                } catch {
                  /* Keep strings, like the local CLI. */
                }
              }
            }
        } else value = cast(value, def.type, `--${base}`);
      }
      if (fields.some((field) => !field || unsafeKeys.has(field)))
        throw Error('JSON 子字段名称无效。');
      if (fields.length) {
        const object = (dotted[base] ||= Object.create(null));
        let target = object;
        fields.slice(0, -1).forEach((field) => {
          if (
            target[field] !== undefined &&
            (!target[field] || typeof target[field] !== 'object' || Array.isArray(target[field]))
          )
            throw Error(`${rawName} 与已有 JSON 字段冲突。`);
          target = target[field] ||= Object.create(null);
        });
        if (Object.hasOwn(target, fields.at(-1)))
          result.warnings.push(`${rawName} 重复指定，后面的值覆盖前面的值。`);
        const previous = target[fields.at(-1)];
        target[fields.at(-1)] =
          Array.isArray(previous) && Array.isArray(value) ? [...previous, ...value] : value;
      } else {
        if (Object.hasOwn(result.options, base))
          result.warnings.push(`--${base} 重复指定，后面的值覆盖前面的值。`);
        result.options[base] = value;
      }
      result.parameters.push({
        name: `--${negative ? 'no-' : ''}${name}`,
        value,
        kind: 'option',
        ...def,
      });
    }
    // FlexibleArgumentParser appends each collected dotted group after regular
    // arguments. Thus that group replaces a whole JSON option, regardless of order.
    for (const [base, value] of Object.entries(dotted)) {
      if (Object.hasOwn(result.options, base))
        result.warnings.push(
          `--${base} 混用了整段 JSON 与点字段；此版本 CLI 在末尾用点字段组覆盖整个 JSON 参数，未保留的字段不参与推导。`,
        );
      result.options[base] = value;
    }
    if (positional !== undefined) {
      if (result.options.model !== undefined)
        throw Error(
          '请只提供一个模型名；此版本 CLI 会把 --model 移到位置参数，不能再同时提供位置模型名。',
        );
      result.options.model = positional;
      result.parameters.unshift({
        name: 'model',
        value: positional,
        area: '服务模型',
        source: 'cli',
        kind: 'option',
      });
    }
    if (/\$\(|\$\{|\$\w+|%\w+%/.test(text))
      result.warnings.push(
        '包含环境变量引用或 shell 表达式：按原文保留，未展开；请替换为实际值后再核对路径。',
      );
    if (result.options.config)
      result.warnings.push(
        '--config 文件未读取；图仅使用命令中显式参数及已知默认规则，缺失配置可能改变路径。',
      );
    if (result.unknown.length)
      result.warnings.push('存在未建模参数；图只推导已支持的部分，不能代表完整配置。');
    if (Object.keys(result.env).some((key) => key !== 'VLLM_USE_V2_MODEL_RUNNER'))
      result.warnings.push('其他环境变量已保留，但未据此推断硬件、进程或后端；运行环境仍需确认。');
  } catch (error) {
    result.errors.push(error.message);
  }
  return result;
}
