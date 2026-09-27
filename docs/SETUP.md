# 安装与排错

## 环境与首次启动

安装 Node.js 20 或更新版本，以及 Git。先确认 `node --version`、`npm --version`、`git --version` 均可运行。Windows、macOS 和 Linux 共用相同 Node 入口。

```bash
git clone https://github.com/Tame21/vllm-learning-lab.git
cd vllm-learning-lab
npm start
```

若仓库为私有，克隆时需使用有权限的 GitHub 账号认证；不要把访问令牌写进 URL 或提交到文件。

首次启动分为三步：

1. 从官方 `vllm-project/vllm` 仓库浅拉取 `src/source-version.mjs` 中锁定的完整 commit。
2. 验证提交与必要目录，保存到 `.cache/vllm/`。不下载模型，不安装 Python 包，不执行上游代码。
3. 把前端复制到 `dist/`，校验源码锚点并生成索引，启动仅监听 `127.0.0.1` 的服务。

进入终端显示的地址，默认为 <http://127.0.0.1:4173>。结束时按 `Ctrl+C`。没有 npm 运行时依赖，所以无需 `npm install`；浏览器回归的 Playwright 是可选开发依赖。

## 离线使用与已有源码

完成一次 `npm run setup` 后，正常启动和测试复用缓存，不再访问上游。也可以把完整的 vLLM 源码放在任意位置，通过环境变量显式指定。相对路径相对于执行命令时的当前目录。

```bash
VLLM_SOURCE_DIR=../my-vllm-checkout npm start
```

```powershell
$env:VLLM_SOURCE_DIR = '../my-vllm-checkout'
npm start
```

自定义源码只读，不会被脚本修改。源码需含 `vllm/`、`docs/features/`、`LICENSE` 及专题引用的文件。没有 Git 信息的源码导出也可读取，但界面会标记版本无法确认。不同提交的函数或文档可能变化，构建会报告缺失锚点；不要用错误代码凑齐行号。

恢复自动缓存：macOS / Linux 使用 `unset VLLM_SOURCE_DIR`；PowerShell 使用 `Remove-Item Env:VLLM_SOURCE_DIR`。

## 在 VS Code 中打开源码

打开任意源码或参考文档后，点击窗口右上角 **“在 VS Code 中打开”**。工具使用 VS Code 官方的 [文件与行列 URL 协议](https://code.visualstudio.com/docs/configure/command-line#_opening-vs-code-with-urls)，目标行与网页里的高亮行一致。无需安装本工具专用的 VS Code 扩展，也无需配置 `code` 命令的 PATH。

本机需安装 VS Code 稳定版并注册 `vscode://` 协议。首次点击时，浏览器可能要求允许打开外部应用；选择 VS Code 即可。某些内嵌浏览器会限制外部协议，可以改用系统浏览器访问本机学习页面。

备用方式：点击“复制文件定位”，切换到 VS Code，按 `Ctrl+P`（macOS 为 `⌘+P`），粘贴并回车。若浏览器拒绝写入剪贴板，工具会显示并选中定位内容，手动复制即可。复制的是本机绝对文件位置与行列，不是分享链接。

如果按钮一直不可用，并提示定位服务不可用，先在启动终端 `Ctrl+C`，重新 `npm start`，刷新页面后再打开源码。本功能包含服务端接口更新，旧的常驻服务仅构建前端还不够。

位置来自当前使用的参考源码：默认是项目缓存，也可以是 `VLLM_SOURCE_DIR`。浏览器、服务和 VS Code 应位于同一台机器；本功能不自动转换 SSH、WSL、容器或远端文件系统路径。打开的就是这份参考代码，保存修改会改变它；需要编辑研究时，建议使用自己维护的源码副本并通过 `VLLM_SOURCE_DIR` 指定。

## 常见问题

| 现象                            | 处理                                                                                                             |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 找不到 Git / Node               | 安装后重开终端，确认命令在 PATH 中。                                                                             |
| PowerShell 不允许运行 `npm.ps1` | 使用 `npm.cmd start`，或运行附带的 Windows 启动脚本。                                                            |
| 第一次下载失败                  | 检查到 GitHub 的连接与 Git 代理配置，重试 `npm run setup`；也可指定已准备好的源码。不要关闭 TLS 校验。           |
| 文件被占用 / EPERM              | 关闭打开缓存目录的编辑器或其他占用程序后重试。源码直接在缓存中准备，不重命名整个 Git 目录。                      |
| 缓存有本地改动或版本不匹配      | 脚本会保留文件并停止。先备份，再移走 `.cache/vllm/` 后重新准备；若要学习修改后的实现，请使用 `VLLM_SOURCE_DIR`。 |
| 端口 4173 被占用                | 用 `PORT=4174 npm start`；PowerShell 先设置 `$env:PORT='4174'`。                                                 |
| 页面提示索引未就绪              | 从项目根目录执行 `npm start`，不要用文件协议直接打开 `src/index.html`。                                          |
| 修改页面后没变化                | `npm run build` 后刷新浏览器；`dist/` 为生成物，不直接修改。                                                     |
| 源码锚点校验失败                | 核对自定义源码版本和 `source-version.mjs`。查看报出的相对文件路径、符号与章节。                                  |

若提示源码正在准备，请先等待其他准备进程。确认进程已停止后，备份并移走 `.cache/vllm/` 和 `.cache/vllm.setup.lock` 再试；不会自动覆盖已有文件。

## 更新参考版本

只有核对过源码变化后才修改 `src/source-version.mjs` 的版本。同步修订专题内容、源码锚点、命令规则和测试。默认缓存版本不一致时，脚本不会覆盖它；备份并移走旧缓存后运行 `npm test`。具体流程见 [贡献指南](../CONTRIBUTING.md)。
