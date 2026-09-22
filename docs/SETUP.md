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
