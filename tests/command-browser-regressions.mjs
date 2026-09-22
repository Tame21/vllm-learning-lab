// Uses only UI actions and DOM reads; accepts a Playwright Page or a Codex tab.
export async function runCommandBrowserRegressions(tab) {
  const page = tab.playwright || tab;
  const results = [];
  const check = (condition, message) => {
    if (!condition) throw Error(message);
  };
  const analyze = async (command) => {
    await page.getByLabel('vLLM 启动命令', { exact: true }).fill(command);
    await page.getByRole('button', { name: '生成流程图', exact: true }).click();
  };
  await page.getByRole('button', { name: '启动命令', exact: true }).click();
  await page
    .getByRole('button', { name: 'TP + 前缀复用 双卡张量并行与分块 Prefill', exact: true })
    .click();
  check((await page.locator('.command-errors').count()) === 0, 'TP 示例必须可解析');
  check(
    (await page.evaluate(() => document.querySelector('#launch-command').value)).includes(
      '--tensor-parallel-size 2',
    ),
    '示例需要更新 textarea 的实时值',
  );
  check(
    (await page.locator('[data-command-node="tensor-parallel"]').innerText()).includes(
      '--tensor-parallel-size=2',
    ),
    'TP 分支必须有触发参数',
  );
  await page.getByRole('button', { name: '查看源码：TP：分片计算与归并', exact: true }).click();
  check(
    (await page.locator('.dialog-head strong').innerText()).endsWith('/linear.py'),
    'TP 应打开 linear.py',
  );
  check(
    (await page.locator('.code-line.highlight').innerText()).includes('def forward('),
    '应高亮实际 forward 函数',
  );
  await page.getByRole('button', { name: '关闭源码', exact: true }).click();
  results.push('示例填充、分支依据与点击源码');

  await analyze(
    'VLLM_USE_V2_MODEL_RUNNER=1 vllm serve demo --no-enable-prefix-caching --enforce-eager',
  );
  check(
    (await page.locator('[data-command-node="model-v1"]').count()) === 0,
    '显式 V2 不应绘出 V1',
  );
  check(
    (await page.locator('[data-command-node="prefix-cache"]').count()) === 0,
    '关闭前缀缓存应移除分支',
  );
  await page.getByRole('button', { name: '查看源码：Model Runner V2', exact: true }).click();
  check(
    (await page.locator('.dialog-head strong').innerText()).endsWith('/gpu/model_runner.py'),
    'V2 应打开对应文件',
  );
  check(
    (await page.locator('.code-line.highlight').innerText()).includes('def execute_model('),
    '应高亮执行入口',
  );
  await page.getByRole('button', { name: '关闭源码', exact: true }).click();
  results.push('关闭分支与 V2 精确定位');

  await page
    .getByRole('button', { name: '向量请求 Pooling 路径，无逐 token 采样循环', exact: true })
    .click();
  check(
    (await page.locator('[data-command-node="pool"]').count()) === 1,
    'Pooling 示例应显示向量路径',
  );
  check(
    (await page.locator('[data-command-node="sampling"]').count()) === 0,
    'Pooling 不应显示采样',
  );
  await page.getByLabel('观察请求', { exact: true }).selectOption('chat');
  check(await page.locator('#command-dirty').isVisible(), '编辑后应提示需要重新生成');
  await page.getByRole('button', { name: '生成流程图', exact: true }).click();
  check(
    (await page.locator('.command-errors').innerText()).includes('pooling'),
    '不兼容请求必须显示错误',
  );
  check((await page.locator('.command-flow-list').count()) === 0, '出错后不得保留旧流程');
  await page.getByLabel('观察请求', { exact: true }).selectOption('auto');
  results.push('请求类型、编辑状态与错误隔离');

  await analyze('vllm serve demo --spec-method ngram --spec-tokens 4');
  await page.getByRole('tab', { name: /服务启动/ }).click();
  check(
    (await page.locator('[data-command-node="spec-config"]').count()) === 1,
    '启动图应包含投机配置',
  );
  await page.getByRole('button', { name: '下一个流程环节', exact: true }).click();
  check(
    (await page
      .locator('.command-flow-row[aria-current="step"] .command-trunk strong')
      .innerText()) === '生成并校验引擎配置',
    '逐步导航应指向下一环节',
  );
  await tab.reload();
  await page.locator('#launch-command').waitFor({ state: 'visible' });
  check(
    (await page.locator('h1').innerText()).includes('启动命令'),
    '#command 刷新仍应保留工具视图',
  );
  check(
    !(await page.evaluate(() => document.querySelector('#launch-command').value)).includes(
      '--spec-tokens',
    ),
    '自定义命令不应持久保存',
  );
  results.push('启动流程、逐步导航与独立路由');
  return results;
}
