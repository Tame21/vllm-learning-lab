// Reusable with a Playwright Page or a Codex tab (tab.playwright).
// Run against an isolated origin/context: these tests exercise saved study state.
export async function runBrowserRegressions(tab) {
  const page = tab.playwright || tab;
  const results = [];
  const check = (condition, message) => {
    if (!condition) throw Error(message);
  };
  const lesson = (id) => page.locator(`.lesson-nav button[data-lesson="${id}"]`).click();

  await lesson('scheduler');
  await page.getByRole('button', { name: '默认', exact: true }).click();
  await page.getByLabel('每轮 token 预算').press('Home');
  await page.getByLabel('每轮 token 预算').press('ArrowRight');
  await page.locator(':focus').press('ArrowRight');
  const keyboard = await page.evaluate(() => ({
    budget: document.querySelector('[data-param="budget"]').value,
    focus: document.activeElement.getAttribute('data-param'),
    step: document.querySelector('#scrubber').value,
  }));
  check(
    keyboard.budget === '12' && keyboard.focus === 'budget' && keyboard.step === '0',
    '连续方向键必须只调整预算并保留焦点',
  );
  results.push('连续方向键与焦点保持');

  await page.getByLabel('请求 A 输入长度').press('ControlOrMeta+A');
  await page.getByLabel('请求 A 输入长度').pressSequentially('12');
  await page.getByLabel('请求 A 输入长度').press('Tab');
  await page.getByLabel('执行时间轴').press('End');
  const position = await page.getByLabel('执行时间轴').getAttribute('value');
  await tab.reload();
  check(
    (await page.getByLabel('请求 A 输入长度').getAttribute('value')) === '12',
    '刷新应恢复自定义请求',
  );
  check(
    (await page.getByLabel('执行时间轴').getAttribute('value')) === position,
    '刷新应恢复时间轴位置',
  );
  results.push('自定义请求与断点恢复');

  await lesson('runner');
  await page.getByRole('button', { name: '重置', exact: true }).click();
  await page.getByRole('tab', { name: '对应源码', exact: true }).click();
  const symbols = await page.locator('.source-anchor h2').allTextContents();
  check(
    symbols.length === 2 && symbols.every((s) => s === 'GPUModelRunner.execute_model'),
    'MRV1/MRV2 应定位 execute_model',
  );
  await page.getByRole('button', { name: '展开源码与行号 ↗', exact: true }).first().click();
  check(
    (await page.locator('.code-line.highlight').innerText()).includes('def execute_model('),
    '源码高亮不能落到重载参数函数',
  );
  await page.getByRole('button', { name: '关闭源码', exact: true }).click();
  check((await page.getByRole('dialog').count()) === 0, '源码弹窗应可关闭');
  results.push('逐步源码、MRV2 与弹窗');

  await lesson('prefix');
  await page.getByLabel('执行时间轴').press('End');
  const labels = await page.locator('.logical-block small').allTextContents();
  check(
    labels.length === 6 && !labels.some((s) => /待计算|待写入/.test(s)),
    '最后一步的缓存应全部就绪',
  );
  await page.getByRole('tab', { name: '想一想', exact: true }).click();
  await page.getByRole('button', { name: 'A 12 token，因此无需目标模型前向', exact: true }).click();
  check(
    (await page.locator('.feedback').innerText()).includes('保留末尾 token'),
    '错误答案应解释末尾 logits 计算的约束',
  );
  results.push('缓存终态与错题反馈');

  await lesson('structured');
  await page.getByLabel('执行时间轴').press('Home');
  for (let i = 0; i < 4; i++) await page.getByLabel('执行时间轴').press('ArrowRight');
  const allowed = await page.locator('.grammar-candidates .generated').allTextContents();
  check(allowed.join('|') === '"vLLM"|"模型"', '字段值阶段仅允许示例字符串');
  results.push('语法状态对应允许集合');
  return results;
}
