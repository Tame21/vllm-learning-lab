// UI-only regression steps, compatible with a Playwright Page or Codex tab.
export async function runSpecBrowserRegressions(tab) {
  const page = tab.playwright || tab;
  const results = [];
  const check = (condition, message) => {
    if (!condition) throw Error(message);
  };
  await page.getByRole('button', { name: '学习路线', exact: true }).click();
  await page.getByRole('button', { name: '打开投机方法地图 →', exact: true }).click();
  await page.getByRole('button', { name: '全部方法', exact: true }).click();
  check((await page.locator('[data-method-card]').count()) === 12, '应有 12 个独立方法专题');
  await page.getByRole('button', { name: '并行起草', exact: true }).click();
  check(
    (await page.locator('[data-method-card]').count()) === 3,
    '并行方法应包含 PARD、DFlash、DSpark',
  );
  await page.getByLabel('对照方法 A', { exact: true }).selectOption('dflash');
  await page.getByLabel('对照方法 B', { exact: true }).selectOption('dspark');
  check(
    (await page.locator('.spec-comparison-table').innerText()).includes('顺序 Markov 采样'),
    '对照应包含实际依赖差异',
  );
  results.push('学习路线入口、12 个方法、按来源筛选与双方法对照');

  await page.getByRole('button', { name: '学习 DSpark →', exact: true }).click();
  await page.locator('.spec-stage-nav [data-step="2"]').click();
  check(
    (await page.locator('.spec-stage-note').innerText()).includes('Markov'),
    '单步应更新图解解释',
  );
  await page.getByRole('tab', { name: '对应源码', exact: true }).click();
  await page.getByRole('button', { name: '展开源码与行号 ↗', exact: true }).click();
  check(
    (await page.locator('.dialog-head strong').innerText()).endsWith('/dspark/speculator.py'),
    '应定位 DSpark 实现',
  );
  check(
    (await page.locator('.code-line.highlight').innerText()).includes('def _sample_sequential'),
    '应高亮 Markov 采样方法',
  );
  await page.getByRole('button', { name: '关闭源码', exact: true }).click();
  await page.locator('.lesson-nav [data-lesson="mlp-spec"]').click();
  check(
    (await page.locator('.spec-config').innerText()).includes('注册项被注释'),
    'MLP 应明确当前接入边界',
  );
  check((await page.locator('[data-spec-command]').count()) === 0, 'MLP 不应给出伪可运行模板');
  await page.locator('.spec-stage-nav [data-step="2"]').click();
  await page.getByRole('tab', { name: '对应源码', exact: true }).click();
  await page.getByRole('button', { name: '展开源码与行号 ↗', exact: true }).click();
  check(
    (await page.locator('.code-line.highlight').innerText()).includes(
      '# "MLPSpeculatorPreTrainedModel"',
    ),
    '应高亮被注释的注册项',
  );
  await page.getByRole('button', { name: '关闭源码', exact: true }).click();
  results.push('逐步图解、DSpark 函数定位与 MLP 未接入边界');

  await page.locator('.lesson-nav [data-lesson="parallel-draft"]').click();
  // Reopened lesson details may retain state in DOM; use the visible attribute.
  if ((await page.locator('.spec-config').getAttribute('open')) === null)
    await page.locator('.spec-config summary').click();
  await page.getByRole('button', { name: '带入启动命令流程图 →', exact: true }).click();
  const command = await page.evaluate(() => document.querySelector('#launch-command').value);
  check(
    command.includes('"method":"draft_model"') && command.includes('"parallel_drafting":true'),
    'PARD 参数应完整带入',
  );
  check(command.includes('VLLM_USE_V2_MODEL_RUNNER=0'), 'PARD 模板应选择本地支持的 MRV1');
  check((await page.locator('.command-errors').count()) === 0, '模板应成功解析');
  check(
    (await page.locator('[data-command-node="model-v2"]').count()) === 0,
    '模板不应展示不支持 PARD 的 MRV2 主路径',
  );
  await page.getByRole('button', { name: '◈ 投机推理 · 按方法展开', exact: true }).click();
  check(
    (await page.locator('h1').innerText()) === '投机推理方法地图',
    '左侧快捷入口应可见并能返回',
  );
  results.push('PARD 模板参数、MRV1 路径与左侧快捷入口');
  return results;
}
