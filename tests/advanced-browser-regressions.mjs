export async function runAdvancedBrowserRegressions(tab) {
  const page = tab.playwright || tab, results = [];
  const check = (condition, message) => { if (!condition) throw Error(message); };
  const open = (id) => page.locator(`.lesson-nav button[data-lesson="${id}"]`).click();
  const preset = (name) => page.getByRole('button', { name, exact: true }).click();
  const last = () => page.getByLabel('执行时间轴').press('End');
  const text = () => page.locator('.mechanism-scene').innerText();

  await open('compile');
  await preset('融合并复用');
  await last();
  check((await page.locator('.advanced-node.fused').count()) === 1, '融合节点呈现');
  check((await page.locator('.advanced-cache span').count()) === 1, '相同形状编译缓存复用');
  await preset('形状变化');
  await last();
  check((await page.locator('.advanced-cache span').count()) === 2, '形状变化新增编译项');
  await preset('关闭融合对照');
  await last();
  check((await page.locator('.advanced-node.fused').count()) === 0 && (await text()).includes('分离路径'), '关闭融合路径');
  results.push('编译融合、中间物化与形状缓存复用');

  await open('kv-quant');
  await preset('scale 太小 / 饱和');
  await last();
  check((await page.locator('.fp8-value.clipped').count()) > 0, '小 scale 导致可见饱和');
  check((await text()).includes('输出绝对误差'), 'Attention 误差对照');
  await preset('当前张量自动 scale');
  await last();
  check((await page.locator('.fp8-value.clipped').count()) === 0, '当前张量选 scale 消除溢出');
  results.push('KV FP8 编码、scale 饱和与 Attention 误差');

  await open('online-quant');
  await preset('普通权重');
  await last();
  const weightCodes = await page.getByRole('table', { name: '在线权重量化' }).innerText();
  await preset('激活幅度变化');
  await last();
  check((await page.getByRole('table', { name: '在线权重量化' }).innerText()) === weightCodes, '激活幅度不更改加载期权重');
  check((await page.locator('.advanced-activation').innerText()).includes('2.520'), '运行时激活输入变化');
  results.push('在线权重转换与运行时激活独立变化');

  await open('dbo');
  await preset('双批次重叠');
  await last();
  check((await page.locator('.dbo-job.done').count()) === 8, '两个 microbatch 全部依赖完成');
  await page.getByRole('tab', { name: '这一步', exact: true }).click();
  check((await page.locator('.watch').innerText()).includes('两个 microbatch 完成交付'), '观察重点读取当前执行记录');
  const overlapped = await page.locator('.dbo-axis').innerText();
  await preset('串行执行对照');
  await last();
  check((await page.locator('.dbo-axis').innerText()) !== overlapped, '串行总时隙与重叠对照');
  results.push('DBO 两泳道、依赖完成与串行对照');

  await open('dp');
  await preset('空队列 / 同分轮转');
  await last();
  check((await page.getByRole('table', { name: 'DP 路由决策记录' }).innerText()).includes('DP 2'), '同分路由覆盖多个副本');
  await preset('显式指定副本');
  await last();
  check(!(await page.getByRole('table', { name: 'DP 路由决策记录' }).innerText()).includes('DP 1'), '显式路由跳过负载选择');
  check((await page.locator('.dp-replicas').innerText()).includes('本客户端在途 0'), '结果返回扣减在途');
  results.push('DP 负载分数、同分轮转与显式路由');

  await open('disagg');
  await preset('传输失败阻塞');
  await last();
  check((await page.locator('.advanced-gate.ready').count()) === 0 && (await text()).includes('D 尚未产生输出'), '失败阻塞 Decode');
  await preset('合并四块传输');
  await last();
  check((await page.locator('.advanced-gate.ready').count()) === 1, '完成确认后解除读依赖');
  check((await page.locator('.disagg-block.ready').count()) === 8, 'P / D 四块均有效');
  results.push('Prefill/Decode 分离、分组传输确认与失败阻塞');
  return results;
}
