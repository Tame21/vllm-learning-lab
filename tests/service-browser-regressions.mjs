// Use an isolated browser context: this suite changes lesson parameters.
export async function runServiceBrowserRegressions(tab) {
  const page = tab.playwright || tab, results = [];
  const check = (condition, message) => { if (!condition) throw Error(message); };
  const lesson = async (id) => {
    await page.locator(`.lesson-nav button[data-lesson="${id}"]`).click();
    await page.locator('[data-mechanism-preset="0"]').click();
  };
  const last = () => page.getByLabel('执行时间轴').press('End');
  const text = () => page.locator('.mechanism-scene').innerText();

  await lesson('model-loading');
  await page.getByLabel('TP 设备数', { exact: true }).press('End');
  await last();
  check((await page.locator('.service-rank.ready').count()) === 4, '所有 TP rank 就绪');
  check((await text()).includes('全部权重就绪'), '所有张量已装载');
  await page.locator('[data-scene-stage="2"]').click();
  await page.getByRole('tab', { name: '对应源码', exact: true }).click();
  check((await page.locator('.source-anchor h2').innerText()) === 'get_model_loader', '选择加载器定位正确');
  results.push('checkpoint 与 TP 切片、关键阶段和加载器源码');

  await lesson('logits');
  await last();
  check(!(await page.locator('[data-visual-key^="processor-output-"]').allTextContents()).includes('D'), '禁用词不采样');
  await page.locator('[data-scene-stage="2"]').click();
  await page.getByRole('tab', { name: '对应源码', exact: true }).click();
  check((await page.locator('.source-anchor h2').innerText()) === 'GumbelWatermarker.sample', '定位 Gumbel 具体实现');
  await page.getByLabel('使用 Gumbel 水印采样', { exact: true }).uncheck();
  await last();
  check((await text()).includes('普通随机采样'), '可切换普通采样对照');
  results.push('候选屏蔽、Gumbel / 普通采样与源码联动');

  await lesson('pooling');
  await page.getByLabel('汇聚方式', { exact: true }).selectOption('2');
  await last();
  check((await page.locator('.service-hidden-matrix .consumed').count()) === 1, 'LAST 只选一个位置');
  await page.locator('[data-scene-stage="2"]').click();
  await page.getByRole('tab', { name: '对应源码', exact: true }).click();
  check((await page.locator('.source-anchor h2').innerText()) === 'LastPool.forward', 'LAST 不跳到 MeanPool');
  await page.getByLabel('汇聚方式', { exact: true }).selectOption('0');
  await last();
  check((await page.locator('.service-hidden-matrix .consumed').count()) === 4, 'MEAN 使用全部有效位置');
  results.push('MEAN / LAST 数值图、归一化与汇聚源码分支');

  await lesson('prompt-embeds');
  await last();
  check((await page.locator('.service-kv-slots .ready').count()) === 4, '预计算输入仍写全部 KV');
  await page.getByLabel('直接使用预计算向量', { exact: true }).uncheck();
  check((await page.getByLabel('执行时间轴').getAttribute('value')) === '0', '改参数从头回放');
  await last();
  check((await text()).includes('已执行 4 次示例查表'), '普通输入执行查表');
  results.push('预计算输入与查表路径、位置对齐和 KV 写入');

  await lesson('sleep');
  await page.getByLabel('休眠级别', { exact: true }).selectOption('2');
  await page.getByLabel('唤醒时更新到权重 v2', { exact: true }).check();
  await page.locator('[data-scene-stage="2"]').click();
  check((await text()).includes('内存已分配，尚未恢复'), '分配内存不能提前认作有效权重');
  await last();
  check((await text()).includes('v2 有效') && (await text()).includes('为空，必须重算'), '新权重有效，旧 KV 不恢复');
  results.push('Level 2 分阶段唤醒、权重更新和空 KV');

  await lesson('metrics');
  await last();
  check((await text()).includes('120 ms') && (await text()).includes('180 ms'), '默认客户端 TTFT / E2E');
  await page.getByLabel('输出 token 数', { exact: true }).press('Home');
  await last();
  check((await text()).includes('不适用'), '单输出 token 不制造 Decode 间隔');
  await (tab.reload ? tab.reload() : page.reload());
  check((await page.getByLabel('输出 token 数', { exact: true }).getAttribute('value')) === '1', '刷新恢复参数');
  results.push('双口径时间线、单 token 指标与断点恢复');
  return results;
}
