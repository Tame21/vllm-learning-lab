import { esc } from './html.mjs';

const languages = {
  py: ['python', 'Python', 'PY'],
  rs: ['rust', 'Rust', 'RS'],
  cu: ['cpp', 'CUDA C++', 'CU'],
  cuh: ['cpp', 'CUDA C++', 'CU'],
  c: ['c', 'C', 'C'],
  h: ['cpp', 'C++', 'C++'],
  cpp: ['cpp', 'C++', 'C++'],
  cc: ['cpp', 'C++', 'C++'],
  hpp: ['cpp', 'C++', 'C++'],
  js: ['javascript', 'JavaScript', 'JS'],
  mjs: ['javascript', 'JavaScript', 'JS'],
  ts: ['typescript', 'TypeScript', 'TS'],
  json: ['json', 'JSON', '{}'],
  md: ['markdown', 'Markdown', 'MD'],
  sh: ['bash', 'Shell', 'SH'],
  yaml: ['yaml', 'YAML', 'YML'],
  yml: ['yaml', 'YAML', 'YML'],
  toml: ['ini', 'TOML', 'CFG'],
  ini: ['ini', 'INI', 'CFG'],
  css: ['css', 'CSS', '#'],
  html: ['xml', 'HTML', '<>'],
  svg: ['xml', 'SVG', '<>'],
};

export function sourceLanguage(path) {
  const extension = String(path).split('.').at(-1).toLowerCase();
  const [id, label, badge] = Object.hasOwn(languages, extension)
    ? languages[extension]
    : ['plaintext', '纯文本', 'TXT'];
  return { id, label, badge };
}

export function sourceReaderShell(path) {
  const language = sourceLanguage(path);
  const filename = String(path).split('/').at(-1);
  return `<div class="dialog-head source-titlebar"><div class="source-file-tab"><span class="source-file-icon" aria-hidden="true">${esc(language.badge)}</span><strong title="${esc(path)}">${esc(filename)}</strong></div><div class="source-actions"><button data-source-wrap aria-pressed="false" title="切换长行自动换行">自动换行</button><button data-source-reveal disabled>定位行</button><button data-close aria-label="关闭源码" title="关闭源码（Esc）">×</button></div></div>
    <div class="source-breadcrumb"><span aria-hidden="true">vLLM ›</span><span class="source-file-path" title="${esc(path)}">${esc(path)}</span></div>
    <div class="full-code" tabindex="0" role="region" aria-label="源码内容，可用方向键滚动" aria-busy="true"><p class="source-message" role="status">正在读取源码…</p></div>
    <div class="source-statusbar"><span>只读</span><span data-source-position role="status">正在读取…</span><span class="source-encoding">UTF-8</span><span>${esc(language.label)}</span></div>`;
}

// Highlight the entire file so multiline strings/comments keep their context.
// Close and reopen ONLY the highlighter's generated spans at line boundaries;
// raw source has already been escaped by highlight.js (or esc for plain text).
function splitHighlightedLines(html) {
  const lines = [];
  const stack = [];
  let line = '';
  for (const part of html.split(/(<span class="[^"]*">|<\/span>|\n)/g)) {
    if (part === '\n') {
      lines.push(line + '</span>'.repeat(stack.length));
      line = stack.join('');
    } else {
      if (part.startsWith('<span class="')) stack.push(part);
      else if (part === '</span>') stack.pop();
      line += part;
    }
  }
  lines.push(line + '</span>'.repeat(stack.length));
  return lines;
}

let highlighter;
export async function renderSource(text, path, requestedLine = 1) {
  const source = String(text).replace(/\r\n?/g, '\n');
  const language = sourceLanguage(path);
  let highlighted = esc(source);
  let notice = '';
  if (language.id !== 'plaintext') {
    try {
      highlighter ??= import('./vendor/highlight.js/highlight.min.js');
      const { default: hljs } = await highlighter;
      highlighted = hljs.highlight(source, { language: language.id, ignoreIllegals: true }).value;
    } catch {
      notice = '语法高亮暂不可用，已显示完整纯文本。';
    }
  }
  const lines = splitHighlightedLines(highlighted);
  const line = Math.min(
    lines.length,
    Math.max(1, Number.isInteger(requestedLine) ? requestedLine : 1),
  );
  const html = lines
    .map(
      (content, index) =>
        `<div class="code-line${index + 1 === line ? ' highlight' : ''}" id="line-${index + 1}"${index + 1 === line ? ' aria-current="location"' : ''}><span class="source-line-number" aria-hidden="true">${index + 1}</span><code>${content}</code></div>`,
    )
    .join('');
  return {
    html: `<div class="source-code-lines">${html}</div>`,
    line,
    total: lines.length,
    language,
    notice,
  };
}
