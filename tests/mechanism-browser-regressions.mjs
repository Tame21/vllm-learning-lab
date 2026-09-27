// Run on an isolated origin/context; this suite changes saved lesson parameters.
export async function runMechanismBrowserRegressions(tab) {
  const page = tab.playwright || tab,
    results = [];
  const check = (condition, message) => {
    if (!condition) throw Error(message);
  };
  const lesson = (id) => page.locator(`.lesson-nav button[data-lesson="${id}"]`).click();
  const last = () => page.getByLabel('执行时间轴').press('End');
  const text = () => page.locator('.mechanism-scene').innerText();
  const slider = async (label, count) => {
    await page.getByLabel(label, { exact: true }).press('Home');
    for (let i = 0; i < count; i++)
      await page.getByLabel(label, { exact: true }).press('ArrowRight');
  };

  await lesson('lifecycle');
  await slider('第几枚输出为 EOS（0 关闭）', 3);
  await last();
  check((await text()).includes('EOS 停止'), 'EOS 应停止请求');
  check((await page.locator('.mechanism-block.occupied').count()) === 0, '结束释放 KV');
  check((await page.locator('.mechanism-chip.delivered').count()) === 2, 'EOS 不交付为文本 token');
  await page.locator('[data-scene-stage="4"]').click();
  check(
    (await page.getByLabel('执行时间轴').getAttribute('value')) === '4',
    '关键环节应定位首个采样事件',
  );
  await page.getByRole('tab', { name: '对应源码', exact: true }).click();
  check(
    (await page.locator('.source-anchor h2').innerText()).includes('Sampler'),
    '源码随动画阶段变化',
  );
  results.push('生命周期 EOS、资源释放、关键环节与源码联动');

  await lesson('runner');
  await page.getByLabel('使用 MRV2 持久行与 gather', { exact: true }).uncheck();
  await last();
  check((await text()).includes('MRV1'), '切换到 MRV1');
  const v1 = await page
    .getByRole('table', { name: 'Runner 本轮输入张量', exact: true })
    .innerText();
  check(/C\s+0\s+0/.test(v1), 'V1 输入行与持久行同序');
  await page.getByLabel('使用 MRV2 持久行与 gather', { exact: true }).check();
  await last();
  const v2 = await page
    .getByRole('table', { name: 'Runner 本轮输入张量', exact: true })
    .innerText();
  check(/C\s+0\s+2/.test(v2), 'V2 gather 应从 C 的持久行 2 取输入');
  results.push('Runner V1 / V2 布局、gather 与请求增删');

  await lesson('preemption');
  await slider('取消 B 的轮次（0 不取消）', 0);
  await page.getByRole('button', { name: '观察抢占 →', exact: true }).click();
  check(
    (await page.locator('.state-strip code').innerText()).includes('保留 1 个输出'),
    '抢占保留输出',
  );
  await page.getByRole('button', { name: '观察重算 →', exact: true }).click();
  await page.getByRole('tab', { name: '对应源码', exact: true }).click();
  check(
    (await page.locator('.source-anchor h2').innerText()) === 'Scheduler.schedule',
    '重算定位重新调度实现',
  );
  await slider('取消 B 的轮次（0 不取消）', 2);
  await page.getByRole('button', { name: '观察取消 →', exact: true }).click();
  check(
    (await page.locator('[data-visual-key="queue-B"]').innerText()).includes('已取消'),
    '取消状态可观察',
  );
  check(!(await page.locator('.mechanism-pool').innerText()).includes('B'), '取消释放 B 的块');
  results.push('抢占、KV 重算、取消与源码跳转');

  await lesson('priority');
  await page.getByLabel('启用 Priority（关闭为 FCFS）', { exact: true }).check();
  await last();
  check(
    (await page.locator('.queue-comparison').innerText()).includes('B → C → A'),
    '优先级首运行顺序',
  );
  await page.getByLabel('启用 Priority（关闭为 FCFS）', { exact: true }).uncheck();
  await last();
  check(
    (await page.locator('.queue-comparison > div').first().innerText()).includes('A → B → C'),
    'FCFS 首运行顺序',
  );
  results.push('Priority / FCFS 相同负载对照');

  await lesson('async');
  await page.getByLabel('允许 CPU / GPU 重叠', { exact: true }).check();
  await last();
  check((await page.locator('.scene-caption').innerText()).includes('15 / 15'), '异步逻辑时间线');
  await page.getByLabel('允许 CPU / GPU 重叠', { exact: true }).uncheck();
  await last();
  check((await page.locator('.scene-caption').innerText()).includes('21 / 21'), '同步总时隙');
  results.push('同步 / 异步泳道与完成事件');

  await lesson('hybrid');
  await page.getByLabel('每块 token 数', { exact: true }).selectOption('2');
  await last();
  await page.getByLabel('执行时间轴').press('ArrowLeft');
  await page.getByLabel('执行时间轴').press('ArrowLeft');
  check(
    (await page.locator('.history-tokens .retained').count()) > 0,
    '窗口外位置仍可保留在部分块中',
  );
  await page.getByLabel('显示状态空间层对照', { exact: true }).uncheck();
  check((await page.locator('.ssm-state').count()) === 0, '状态空间对照可切换');
  results.push('滑动窗口、整块回收与层类型对照');

  await lesson('beam');
  await page.getByLabel('Beam 宽度', { exact: true }).press('End');
  await last();
  check(
    (await page
      .getByRole('table', { name: 'Beam 最终结果', exact: true })
      .locator('tbody tr')
      .count()) === 4,
    '返回 4 条候选',
  );
  check((await page.locator('.beam-node.pruned').count()) > 0, '展示被剪枝分支');
  await page.getByRole('tab', { name: '对应源码', exact: true }).click();
  check(
    (await page.locator('.source-anchor h2').innerText()) === 'BeamSearchOfflineMixin.beam_search',
    '最终排序定位 Beam 实现',
  );
  results.push('Beam 候选树、剪枝与结果源码');

  await lesson('dynamic-spec');
  await slider('执行时间轴', 6);
  check(
    (await page.locator('.sd-disabled').innerText()).includes('普通目标模型解码'),
    'K=0 关闭草稿但继续目标解码',
  );
  await page.getByLabel('低并发区间上限', { exact: true }).press('End');
  check((await page.locator('#parameter-error').innerText()).includes('上限'), '拒绝逆序区间');
  check(
    (await page.getByLabel('低并发区间上限', { exact: true }).getAttribute('value')) === '64',
    '无效配置不覆盖已验证参数',
  );
  await page.getByLabel('初始 batch size', { exact: true }).press('End');
  await slider('执行时间轴', 2);
  const position = await page.getByLabel('执行时间轴').getAttribute('value');
  if (tab.reload) await tab.reload();
  else await page.reload();
  check(
    (await page.getByLabel('执行时间轴').getAttribute('value')) === position,
    '刷新恢复事件位置',
  );
  check(
    (await page.getByLabel('初始 batch size', { exact: true }).getAttribute('value')) === '512',
    '刷新恢复新参数',
  );
  results.push('动态 K 区间、关闭草稿、校验与断点恢复');
  return results;
}
