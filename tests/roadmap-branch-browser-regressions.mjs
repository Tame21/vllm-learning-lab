export async function runRoadmapBranchBrowserRegressions(tab) {
  const page = tab.playwright || tab, results = [], check = (v, m) => { if (!v) throw Error(m); };
  const open = (id) => page.locator(`.lesson-nav button[data-lesson="${id}"]`).click();
  const preset = (name) => page.getByRole('button', { name, exact: true }).click();
  const last = () => page.getByLabel('执行时间轴').press('End');
  await open('configuration'); await preset('配置分组与校验'); await last(); check((await page.locator('.roadmap-protocol-fields section').count()) === 4, '四个配置输入对象');
  await preset('头数不能整除 TP'); await last(); check((await page.locator('[data-visual-key="branch-gate"]').innerText()).includes('失败'), '头数与 TP 交叉校验');
  await preset('MRV2 与 N-gram 冲突'); await last(); check((await page.getByRole('table', { name: '配置对象交叉校验' }).innerText()).includes('init_speculator'), 'Runner 未接入组合被拦截');
  results.push('配置对象分组、模型头数与 Runner 组合校验');
  await open('attention-backends'); await preset('Dense 后端条件'); await last(); check((await page.locator('[data-visual-key="branch-gate"]').innerText()).includes('FLASH_ATTN'), 'Dense 候选通过');
  await preset('无候选 / block 不合法'); await last(); check((await page.locator('[data-visual-key="branch-gate"]').innerText()).includes('无候选'), 'block 排除全部候选');
  await preset('MLA 排除 Dense 后端'); await last(); check((await page.getByRole('table', { name: 'FLASH_ATTN 条件筛选' }).innerText()).includes('请求 MLA'), 'MLA 类型原因可见');
  results.push('Attention 候选过滤、元数据门禁与淘汰原因');
  await open('adaptive-spec'); await preset('跨请求存活分配'); await last();
  const before = await page.getByRole('table', { name: '自适应验证成本与全局预算' }).innerText();
  await preset('高计算成本'); await last(); check(before !== await page.getByRole('table', { name: '自适应验证成本与全局预算' }).innerText(), '成本输入改变预算评分');
  await preset('不满足支持条件'); await last(); check((await page.locator('[data-visual-key="branch-gate"]').innerText()).includes('禁止启用'), '支持条件门禁');
  results.push('存活概率、跨请求预算与支持条件');
  await open('platform'); await preset('CPU 默认 native'); await last(); check((await page.locator('.roadmap-dispatch-path').innerText()).includes('forward_cpu') && (await page.locator('.roadmap-dispatch-path').innerText()).includes('forward_native'), 'CPU 默认委托');
  await preset('缺少 native 实现'); await last(); check((await page.locator('[data-visual-key="branch-gate"]').innerText()).includes('缺少实现'), '缺失实现阻止计算');
  results.push('CustomOp 平台方法委托与实现缺失');
  await open('compatibility'); await preset('已检查条件通过'); await last(); check((await page.locator('[data-visual-key="branch-gate"]').innerText()).includes('通过本窗口'), '部分规则通过有边界提示');
  await preset('自适应与 LoRA 冲突'); await last(); check((await page.getByRole('table', { name: '固定版本特性组合检查' }).locator('.fail').count()) === 1, 'LoRA 精确冲突');
  await preset('N-gram 与 MRV2 冲突'); await last(); check((await page.locator('[data-visual-key="branch-gate"]').innerText()).includes('1 条'), 'Runner 精确冲突');
  results.push('特性组合条件矩阵与逐项冲突理由');
  return results;
}
