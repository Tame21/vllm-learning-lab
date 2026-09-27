// Run on a separate origin/context so the real learner's progress stays intact.
export async function runFoundationBrowserRegressions(tab) {
  const page = tab.playwright || tab,
    results = [];
  const check = (ok, message) => {
    if (!ok) throw Error(message);
  };
  const lesson = (slug) => page.locator(`.lesson-nav [data-lesson="base-${slug}"]`).click();
  const last = () => page.getByLabel('执行时间轴', { exact: true }).press('End');
  const scene = () => page.locator('#scene').innerText();
  const preset = (value) =>
    page.getByLabel('输入案例', { exact: true }).selectOption(String(value));
  const source = () => page.getByRole('tab', { name: '对应源码', exact: true }).click();

  await page.locator('.topbar [data-view="foundations"]').click();
  check((await page.locator('.foundation-card').count()) === 20, '前置目录有 20 节');
  check(
    await page.locator('.lesson-nav [data-view="foundations"]').isVisible(),
    '左栏前置课入口可见',
  );
  await page.getByLabel('搜索学习专题').fill('贝叶斯');
  check((await page.locator('.foundation-card').count()) === 1, '按概念查基础课');
  await page.getByLabel('搜索学习专题').press('ControlOrMeta+A');
  await page.getByLabel('搜索学习专题').press('Backspace');
  await page.locator('.foundation-card[data-lesson="base-bayes"]').click();
  await last();
  check((await scene()).includes('0.6667'), '贝叶斯默认后验为 2/3');
  check((await page.locator('.foundation-boxes section').count()) === 2, '两个来源盒子可见');
  await page.getByLabel('先验 P(H)', { exact: true }).press('End');
  await last();
  check(!(await scene()).includes('0.6667'), '调整先验会改变后验');
  results.push('前置课目录、搜索、左栏入口与贝叶斯可调图');

  await lesson('conditional');
  await preset(2);
  await page.getByLabel('已知 B 的值', { exact: true }).selectOption('1');
  await last();
  check(
    (await page.locator('.foundation-warning').innerText()).includes('未定义'),
    '零条件概率有明确解释',
  );
  check(!/NaN|无效数值/.test(await scene()), '零条件未除零');
  await source();
  check(
    (await page.locator('.source-anchor').innerText()).includes('概念在 vLLM 中的参考位置'),
    '基础例子不冒充生产源码执行',
  );
  await page.locator('[data-step-source="0"]').click();
  await page.locator('.code-line.highlight').first().waitFor({ state: 'visible' });
  await page.locator('[data-close]').click();
  await lesson('cdf');
  await preset(0);
  await page.getByLabel('均匀随机数 U', { exact: true }).press('Home');
  await last();
  check((await scene()).includes('选中 A'), 'U=0 命中首个非空区间');
  await preset(1);
  await last();
  check((await scene()).includes('选中 B'), '零质量 A 跳过');
  await page.getByLabel('均匀随机数 U', { exact: true }).press('End');
  await last();
  check((await scene()).includes('选中 C'), '末端随机数落入 C');
  results.push('条件概率边界、源码应用说明与 CDF 区间');

  await lesson('monte-carlo');
  await last();
  check((await page.locator('.foundation-plot').count()) === 1, '频率曲线可见');
  check((await scene()).includes('理论标准误差'), '频率与误差尺度分开');
  await lesson('gaussian');
  await last();
  check((await page.locator('.foundation-plot polygon').count()) === 1, '高斯区间面积高亮');
  check((await scene()).includes('0.6827'), '一倍标准差概率');
  await lesson('training');
  await page.getByLabel('训练模式（关闭为冻结参数）', { exact: true }).setChecked(false);
  await last();
  check((await page.locator('.metrics').innerText()).includes('最终 θ'), '冻结模式结果可见');
  check(
    (await page.locator('.metrics .metric').first().innerText()).startsWith('0'),
    '推理权重保持为零',
  );
  await page.getByLabel('训练模式（关闭为冻结参数）', { exact: true }).setChecked(true);
  await last();
  check(
    !(await page.locator('.metrics .metric').first().innerText()).startsWith('0'),
    '训练已更新权重',
  );
  results.push('蒙特卡洛、高斯面积、训练与冻结推理交互');

  await lesson('diffusion');
  await page.locator('[data-scene-stage="1"]').click();
  check(
    (await page.locator('.foundation-diffusion .foundation-plot').count()) === 1,
    '前向单独演示',
  );
  await page.locator('[data-scene-stage="2"]').click();
  check((await scene()).includes('解析教学模型'), '另起反向链说明');
  await last();
  check(
    (await page.locator('.foundation-diffusion .foundation-plot').count()) === 2,
    '前向与独立反向曲线',
  );
  check((await scene()).includes('不使用前向噪声日志'), '不以倒放代替生成');
  check(
    (await page.locator('.foundation-references a').getAttribute('href')) ===
      'https://arxiv.org/abs/2006.11239',
    '提供原论文',
  );
  check(
    (await page.locator('.foundation-notes').innerText()).includes('真实模型学什么'),
    '训练目标与玩具后验有详细说明',
  );
  const before = await scene();
  if (tab.reload) await tab.reload();
  else await page.reload();
  await page.locator('.foundation-diffusion').waitFor({ state: 'visible' });
  check((await scene()) === before, '刷新保留扩散种子和帧');
  await source();
  check(
    (await page.locator('.foundation-source-note').innerText()).includes('离散语言扩散配置'),
    '当前源码与 DDPM 概念区别明确',
  );
  results.push('扩散前向与反向分开、详细数学、原始资料及断点恢复');

  await lesson('discrete-diffusion');
  await preset(1);
  await page.locator('[data-scene-stage="2"]').click();
  check((await scene()).includes('要'), '未确认的错误候选可见');
  await last();
  check((await scene()).includes('可提交'), '迭代后完整提交');
  await preset(2);
  await last();
  check((await scene()).includes('未完成'), '预算不足不假装完成');
  await page.locator('.lesson-nav [data-lesson="mtp"]').click();
  await page.locator('.learning-context [data-lesson="base-generation"]').click();
  check((await page.locator('h1').innerText()).includes('分清自回归'), 'MTP 前置学习链接');
  await page.getByRole('tab', { name: '想一想', exact: true }).click();
  await page.locator('[data-answer="1"]').click();
  check((await page.locator('.feedback').innerText()).includes('机制判断正确'), '独立基础理解题');
  await page.locator('.topbar [data-view="path"]').click();
  await page.locator('.foundation-entry [data-view="foundations"]').click();
  check((await page.locator('.foundation-card').count()) === 20, '学习路线回到基础课');
  results.push('离散扩散修正与预算、MTP 先修链接、理解题和路线入口');

  for (const slug of [
    'notation',
    'shapes',
    'linear',
    'exp-log',
    'probability',
    'conditional',
    'bayes',
    'moments',
    'cdf',
    'monte-carlo',
    'gaussian',
    'information',
    'tokens',
    'autoregressive',
    'attention',
    'training',
    'markov',
    'diffusion',
    'discrete-diffusion',
    'generation',
  ]) {
    await lesson(slug);
    await last();
    check((await page.locator('.foundation-notes').count()) === 1, slug + ' 详细讲解');
    check(!/NaN|undefined|无效数值/.test(await scene()), slug + ' 数值有效');
    const g = await page.evaluate(() => ({
      width: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    check(g.scroll <= g.width + 1, slug + ' 页面无横向溢出');
  }
  results.push('全部 20 节基础观察窗、详细讲解与页面布局');
  return results;
}
