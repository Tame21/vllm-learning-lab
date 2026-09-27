// Use a separate origin/context: this suite changes only the test learner's state.
export async function runAlgorithmBrowserRegressions(tab) {
  const page = tab.playwright || tab,
    results = [];
  const check = (condition, message) => {
    if (!condition) throw Error(message);
  };
  const lesson = (id) => page.locator(`.lesson-nav [data-lesson="alg-${id}"]`).click();
  const last = () => page.getByLabel('执行时间轴', { exact: true }).press('End');
  const scene = () => page.locator('#scene').innerText();
  const preset = (value) =>
    page.getByLabel('输入案例', { exact: true }).selectOption(String(value));
  const readSource = () => page.getByRole('tab', { name: '对应源码', exact: true }).click();

  await page.locator('.topbar [data-view="algorithms"]').click();
  check((await page.locator('.algorithm-card').count()) === 24, '算法目录列出 24 章');
  await page.getByLabel('搜索学习专题').fill('残差');
  check((await page.locator('.algorithm-card').count()) === 1, '目录响应搜索');
  await page.getByLabel('搜索学习专题').press('ControlOrMeta+A');
  await page.getByLabel('搜索学习专题').press('Backspace');
  await page.locator('.algorithm-card[data-lesson="alg-rejection"]').click();
  await preset(0);
  await page.getByLabel('观察候选 token', { exact: true }).selectOption('0');
  await last();
  check((await scene()).includes('× 拒绝'), '默认 A 被拒绝');
  await page.getByLabel('观察候选 token', { exact: true }).selectOption('1');
  await last();
  check((await scene()).includes('✓ 接受'), 'B 的比值大于 1，全收');
  await preset(2);
  await last();
  check((await scene()).includes('q(x)=0'), '非法提议分支可观察');
  await readSource();
  check(
    (await page.locator('.source-anchor h2').innerText()).includes('rejection_random'),
    '当前源码正确',
  );
  await page.locator('[data-step-source="0"]').click();
  await page.locator('.code-line.highlight').first().waitFor({ state: 'visible' });
  await page.locator('[data-close]').click();
  results.push('算法目录、搜索、接受/拒绝与源码高亮');

  await lesson('residual');
  await preset(0);
  await last();
  check((await page.locator('.algorithm-mass-balance').count()) === 1, '恢复质量堆叠对照');
  await page.locator('[data-scene-stage="3"]').click();
  check((await scene()).includes('0.75'), '恢复分布在中间步骤计算');
  await preset(1);
  await last();
  check((await scene()).includes('无需恢复'), 'p=q 不除零');
  await page.locator('[data-scene-stage="3"]').click();
  check((await scene()).includes('恢复分支不可达'), '关键环节跳转对应帧');
  results.push('残差质量守恒与 p=q 的恢复边界');

  await lesson('softmax');
  await page.getByLabel('温度 T（0 为贪心）', { exact: true }).press('Home');
  await last();
  await readSource();
  check(
    (await page.locator('.source-anchor h2').innerText()) === 'Sampler.greedy_sample',
    '零温度源码切换贪心',
  );
  await lesson('pooling');
  await page.getByLabel('Pooling 规则', { exact: true }).selectOption('1');
  await page.locator('[data-scene-stage="1"]').click();
  await readSource();
  check(
    (await page.locator('.source-anchor h2').innerText()) === 'LastPool.forward',
    'Last 动态源码',
  );
  await page.getByLabel('Pooling 规则', { exact: true }).selectOption('2');
  check(
    (await page.locator('.source-anchor h2').innerText()) === 'CLSPool.forward',
    'CLS 动态源码',
  );
  await preset(1);
  await last();
  check((await scene()).includes('输出 L2 长度'), '零向量可渲染');
  results.push('温度与 Pooling 参数改变真实源码分支');

  await lesson('topk');
  await preset(1);
  await last();
  check(
    (await page.locator('.metrics .metric').first().innerText()).includes('3'),
    '并列 Top-k 保留三项',
  );
  await lesson('ngram');
  await preset(1);
  await last();
  check((await scene()).includes('复制 0 个候选'), '无匹配历史不产生草稿');
  await preset(0);
  await last();
  check((await page.locator('.algorithm-kmp').innerText()).includes('LPS'), 'KMP 回退表可见');
  await lesson('cache-queue');
  await preset(2);
  await last();
  check((await scene()).includes('申请失败'), '满容量保持原队列');
  results.push('并列 Top-k、KMP 空结果和缓存满容量');

  for (const slug of [
    'softmax',
    'topk',
    'topp',
    'minp',
    'penalties',
    'exponential',
    'rejection',
    'residual',
    'greedy-verify',
    'ngram',
    'beam',
    'dynamic',
    'attention',
    'online-softmax',
    'rope',
    'rmsnorm',
    'paged-address',
    'prefix-hash',
    'cache-queue',
    'int8',
    'lora',
    'moe-topk',
    'eplb',
    'pooling',
  ]) {
    await lesson(slug);
    await last();
    check((await page.locator('.algorithm-notes').count()) === 1, slug + ' 详细讲解');
    check(!/NaN|undefined|无效数值/.test(await scene()), slug + ' 无无效数值');
    const geometry = await page.evaluate(() => ({
      width: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    check(geometry.scroll <= geometry.width + 1, slug + ' 页面不横向溢出');
  }
  results.push('24 章最终帧、详细讲解与页面布局回归');

  await lesson('rope');
  await preset(1);
  await last();
  const before = await scene();
  if (tab.reload) await tab.reload();
  else await page.reload();
  await page.locator('.algorithm-rotation').waitFor({ state: 'visible' });
  check((await scene()) === before, '刷新后相同旋转与参数');
  await page.getByRole('tab', { name: '想一想', exact: true }).click();
  await page.locator('[data-answer="0"]').click();
  check((await page.locator('.feedback').count()) === 1, '理解题给出解释');
  results.push('实验链接/刷新恢复与算法理解题');
  return results;
}
