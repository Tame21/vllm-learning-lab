import test from 'node:test';
import assert from 'node:assert/strict';
import { renderSource, sourceLanguage, sourceReaderShell } from '../src/source-view.mjs';

const codeRows = (html) => [...html.matchAll(/<code>([\s\S]*?)<\/code>/g)].map((m) => m[1]);
const decode = (html) =>
  html.replace(/<\/?span\b[^>]*>/g, '').replace(
    /&(amp|lt|gt|quot|#39|#x27);/g,
    (entity) =>
      ({
        '&amp;': '&',
        '&lt;': '<',
        '&gt;': '>',
        '&quot;': '"',
        '&#39;': "'",
        '&#x27;': "'",
      })[entity],
  );

function assertPreserved(source, result) {
  const rows = codeRows(result.html);
  assert.equal(rows.map(decode).join('\n'), source.replace(/\r\n?/g, '\n'));
  assert.equal(rows.length, result.total);
  for (const row of rows) {
    let depth = 0;
    for (const [tag] of row.matchAll(/<\/?span\b[^>]*>/g)) {
      depth += tag.startsWith('</') ? -1 : 1;
      assert.ok(depth >= 0, '每行的高亮标签必须独立闭合');
    }
    assert.equal(depth, 0);
  }
}

test('Python 高亮区分语法，跨行字符串不破坏行号或原文', async () => {
  const text =
    '# 请求调度\r\nclass Runner:\r\n\t"""说明开始\r\n\t继续说明 & <tag>\r\n\t"""\r\n\tdef execute(self, budget: int = 12):\r\n\t\treturn "ready"\r\n';
  const result = await renderSource(text, 'vllm/runner.py', 6);
  assertPreserved(text, result);
  assert.equal(result.notice, '');
  assert.equal(result.total, 8);
  assert.equal(result.line, 6);
  assert.match(result.html, /hljs-comment/);
  assert.match(result.html, /hljs-keyword/);
  assert.match(result.html, /hljs-title function_/);
  assert.match(result.html, /hljs-title class_/);
  assert.match(result.html, /hljs-number/);
  assert.match(codeRows(result.html)[3], /^\t?<span class="hljs-string">/);
  assert.match(result.html, /id="line-6" aria-current="location"/);
  assert.equal((result.html.match(/class="code-line highlight"/g) || []).length, 1);
});

test('CUDA / Rust / Markdown 保留跨行语法和完整文件内容', async () => {
  for (const [path, text] of [
    [
      'kernel.cu',
      '/* first\n * second\n */\ntemplate <typename T>\n__global__ void add(T* data) { return; }\n',
    ],
    [
      'worker.rs',
      '/* comment\n continued */\nfn execute(count: usize) -> usize {\n    count + 1\n}\n',
    ],
    ['feature.md', '# Example\n\n```python\ntext = """one\ntwo"""\n```\n'],
  ]) {
    const result = await renderSource(text, path, 4);
    assertPreserved(text, result);
    assert.equal(result.notice, '', path);
    assert.match(result.html, /hljs-/);
  }
  const cuda = await renderSource('/* first\n second\n */', 'kernel.cuh');
  assert.match(codeRows(cuda.html)[1], /^<span class="hljs-comment">/);
});

test('源码和文件名中的 HTML 始终作为文本显示', async () => {
  const payload = '</code><img src=x onerror="alert(1)"><script>bad()</script>&lt;';
  for (const [path, text] of [
    ['unsafe.py', `# ${payload}\nvalue = ${JSON.stringify(payload)}\n`],
    ['unsafe.json', JSON.stringify({ value: payload })],
    ['unknown.data', payload],
  ]) {
    const result = await renderSource(text, path);
    assertPreserved(text, result);
    assert.doesNotMatch(result.html, /<(?:img|script)\b/);
  }
  const shell = sourceReaderShell(`docs/${payload}.md`);
  assert.doesNotMatch(shell, /<(?:img|script)\b/);
  assert.match(shell, /&lt;img/);
});

test('按扩展名选择语言，未知类型安全回退并约束目标行', async () => {
  assert.equal(sourceLanguage('MODEL.PY').id, 'python');
  assert.equal(sourceLanguage('cache.cuh').label, 'CUDA C++');
  assert.equal(sourceLanguage('worker.rs').id, 'rust');
  assert.equal(sourceLanguage('data.json').id, 'json');
  assert.equal(sourceLanguage('README.md').id, 'markdown');
  assert.equal(sourceLanguage('constructor').id, 'plaintext');
  const text = 'line one\n\nlast';
  const result = await renderSource(text, 'NOTICE', 1000);
  assertPreserved(text, result);
  assert.equal(result.line, 3);
  assert.doesNotMatch(result.html, /hljs-/);
  assert.equal((await renderSource(text, 'NOTICE', -1)).line, 1);
  assert.equal((await renderSource('', 'empty.py', NaN)).total, 1);
});
