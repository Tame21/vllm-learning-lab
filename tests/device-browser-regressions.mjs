export async function runDeviceBrowserRegressions(tab) {
  const page = tab.playwright || tab, results = [];
  const check = (condition, message) => { if (!condition) throw Error(message); };
  const last = () => page.getByLabel('执行时间轴').press('End');
  const text = () => page.locator('.mechanism-scene').innerText();
  await page.locator('.lesson-nav button[data-lesson="cudagraph"]').click();
  await page.getByRole('button', { name: '匹配并回放', exact: true }).click();
  await last();
  check((await text()).includes('Graph Replay') && (await page.locator('.device-kernel-lane .executed').count()) === 3, '回放仍执行全部 kernel');
  await page.getByRole('button', { name: '超出捕获范围', exact: true }).click();
  check((await page.getByLabel('执行时间轴').getAttribute('value')) === '0', '场景切换重置事件位置');
  await last();
  check((await text()).includes('Eager') && (await text()).includes('批次超出已捕获范围'), '大批次回退分支');
  results.push('CUDA Graph 场景、大小匹配和回放设备工作');

  await page.locator('.lesson-nav button[data-lesson="offload"]').click();
  await page.getByRole('button', { name: '小容量 / 必须重算', exact: true }).click();
  await last();
  check((await page.locator('.device-tier.gpu .ready').count()) === 1, '单槽容量保持');
  check((await page.locator('[data-visual-key="offload-cpu-3"]').innerText()).includes('有效副本'), '重算后淘汰时先备份');
  await page.getByRole('button', { name: '增加 GPU 容量', exact: true }).click();
  await last();
  check((await page.locator('.device-tier.gpu .ready').count()) === 3, '增加容量减少淘汰');
  results.push('KV 卸载、缺失重算与容量场景');

  check((await page.getByLabel('筛选学习内容形式', { exact: true }).count()) === 0, '只有一种内容形式时隐藏无效筛选');
  check((await page.locator('.lesson-nav button[data-lesson]').count()) === 114, '全部专题仍可访问');
  await page.getByLabel('搜索学习专题', { exact: true }).fill('CUDA');
  check((await page.locator('.lesson-nav button[data-lesson]').count()) === 2 && (await page.locator('.lesson-nav button[data-lesson="cudagraph"]').count()) === 1 && (await page.locator('.lesson-nav button[data-lesson="platform"]').count()) === 1, '关键词筛选保留');
  await page.getByLabel('搜索学习专题', { exact: true }).press('ControlOrMeta+A');
  await page.getByLabel('搜索学习专题', { exact: true }).press('Backspace');
  check((await page.locator('.lesson-nav button[data-lesson]').count()) === 114, '清空搜索后恢复全部专题');
  results.push('单一内容形式隐藏筛选，关键词搜索与清空恢复');
  return results;
}
