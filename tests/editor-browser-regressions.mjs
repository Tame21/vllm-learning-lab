// Inspect the native protocol target without launching a desktop app in automated runs.
export async function runEditorBrowserRegressions(tab) {
  const page = tab.playwright || tab,
    results = [];
  const check = (ok, message) => {
    if (!ok) throw Error(message);
  };
  const readTarget = async () => {
    await page.locator('[data-source-vscode][href]').waitFor({ state: 'attached' });
    const href = await page.locator('[data-source-vscode]').getAttribute('href');
    const relative = await page.locator('.source-file-path').innerText();
    const line = Number((await page.locator('.code-line.highlight').getAttribute('id')).slice(5));
    const url = new URL(href);
    check(url.protocol === 'vscode:' && url.host === 'file', '使用 VS Code 文件协议');
    check(
      decodeURIComponent(url.pathname).endsWith('/' + relative + ':' + line + ':1'),
      '定位到当前文件与高亮行',
    );
    check(
      (await page.locator('[data-source-vscode]').getAttribute('aria-disabled')) === null,
      '链接已启用',
    );
    check(
      (await page.locator('.source-editor').innerText()).includes('Ctrl / ⌘+P'),
      '未唤起时有备用方式',
    );
    return { href, relative, line };
  };

  await page.locator('.lesson-nav [data-lesson="runner"]').click();
  await page.getByRole('button', { name: '重置', exact: true }).click();
  await page.getByRole('tab', { name: '对应源码', exact: true }).click();
  await page.locator('[data-step-source="0"]').click();
  const first = await readTarget();
  check(first.relative === 'vllm/v1/worker/gpu_model_runner.py', 'MRV1 当前文件');
  await page.getByRole('button', { name: '复制文件定位', exact: true }).click();
  const hint = await page.locator('[data-source-editor-status]').innerText();
  check(/已复制文件定位|浏览器未允许自动复制/.test(hint), '复制成功或明确提供手动复制');
  if (hint.includes('浏览器未允许')) {
    check(await page.locator('[data-source-location-fallback]').isVisible(), '手动复制框显示');
  }

  await page.getByRole('button', { name: '关闭源码', exact: true }).click();
  await page.locator('[data-step-source="1"]').click();
  const second = await readTarget();
  check(
    second.href !== first.href && second.relative === 'vllm/v1/worker/gpu/model_runner.py',
    '切换 MRV2 不残留旧文件链接',
  );
  await page.getByRole('button', { name: '关闭源码', exact: true }).click();
  results.push('VS Code 链接与当前文件/高亮行同步，复制备用与 MRV1/MRV2 切换');

  await page.locator('.topbar [data-view="coverage"]').click();
  const doc = page.locator('.doc-row [data-source]').first();
  const expected = await doc.getAttribute('data-source');
  await doc.click();
  const target = await readTarget();
  check(target.relative === expected && target.line === 1, '参考文档可在 VS Code 从首行打开');
  await page.getByRole('button', { name: '自动换行', exact: true }).click();
  check(
    (await page
      .getByRole('button', { name: '自动换行', exact: true })
      .getAttribute('aria-pressed')) === 'true',
    '原换行操作仍可用',
  );
  const geometry = await page.evaluate(() => {
    const dialog = document.querySelector('.source-editor'),
      actions = dialog.querySelector('.source-actions');
    const viewport = document.documentElement.clientWidth;
    return {
      viewport,
      right: dialog.getBoundingClientRect().right,
      actionsWidth: actions.clientWidth,
      actionsScroll: actions.scrollWidth,
    };
  });
  check(
    geometry.right <= geometry.viewport + 1 && geometry.actionsScroll <= geometry.actionsWidth + 1,
    '源码操作栏无横向溢出',
  );
  await page.getByRole('button', { name: '关闭源码', exact: true }).click();
  results.push('文档首行定位、原阅读控件与源码操作栏布局');
  return results;
}
