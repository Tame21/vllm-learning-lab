export async function requestEditorTarget(path, line, request = fetch) {
  const query = new URLSearchParams({ path, line: String(line) });
  const response = await request('/api/editor-link?' + query, {
    cache: 'no-store',
    credentials: 'same-origin',
    signal: AbortSignal.timeout(6000),
  });
  if (!response.ok) throw Error('无法生成 VS Code 定位；请重启本地服务，再重新打开源码。');
  const target = await response.json();
  const url = new URL(target.url);
  if (
    url.protocol !== 'vscode:' ||
    url.host !== 'file' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !url.pathname.endsWith(`:${line}:1`) ||
    typeof target.location !== 'string' ||
    !target.location.endsWith(`:${line}:1`) ||
    /[\x00-\x1f\x7f]/.test(target.location)
  )
    throw Error('编辑器定位信息无效，请重新打开源码。');
  return { url: url.href, location: target.location };
}

export async function prepareEditorLink(dialog, path, line, isCurrent) {
  const link = dialog.querySelector('[data-source-vscode]');
  const copy = dialog.querySelector('[data-source-copy-location]');
  const status = dialog.querySelector('[data-source-editor-status]');
  const fallback = dialog.querySelector('[data-source-location-fallback]');
  try {
    const target = await requestEditorTarget(path, line);
    if (!isCurrent()) return;
    link.href = target.url;
    link.removeAttribute('aria-disabled');
    link.removeAttribute('tabindex');
    link.title = `在 VS Code 中打开 ${path} 第 ${line} 行`;
    copy.disabled = false;
    status.textContent =
      '需本机已安装 VS Code。未唤起时，可复制文件定位，在 VS Code 按 Ctrl / ⌘+P 粘贴。';
    link.addEventListener('click', () => {
      if (isCurrent())
        status.textContent =
          '已请求打开 VS Code；浏览器可能提示允许打开外部应用。未唤起可使用“复制文件定位”。';
    });
    copy.addEventListener('click', async () => {
      if (!isCurrent()) return;
      try {
        await navigator.clipboard.writeText(target.location);
        if (isCurrent())
          status.textContent = '已复制文件定位。在 VS Code 按 Ctrl / ⌘+P，粘贴后回车。';
      } catch {
        if (!isCurrent()) return;
        fallback.hidden = false;
        fallback.value = target.location;
        fallback.focus();
        fallback.select();
        status.textContent =
          '浏览器未允许自动复制。请复制已选中的文件定位，在 VS Code 按 Ctrl / ⌘+P 粘贴。';
      }
    });
  } catch {
    if (isCurrent())
      status.textContent = 'VS Code 定位暂不可用。请重启本地服务（npm start），再重新打开源码。';
  }
}
