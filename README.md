# vLLM Learning Lab · 推理，逐步看见

基于真实 vLLM 源码的中文交互学习工具：从一个请求的生命周期出发，逐步观察调度、KV Cache、模型执行、投机推理与多卡通信，再点击跳转到对应代码。

**70 个专题 · 289 个步骤源码定位 · 12 种投机方法 · 启动命令 → 执行流程图**

运行只需要 [Node.js](https://nodejs.org/) 20+ 和 [Git](https://git-scm.com/)。无需 GPU、模型权重、Python 或 npm 运行时依赖。

## 克隆后启动

```bash
git clone https://github.com/Tame21/vllm-learning-lab.git
cd vllm-learning-lab
npm start
```

打开 <http://127.0.0.1:4173>。Windows 也可以在克隆后双击 `启动学习工具.cmd`。保持终端运行，按 `Ctrl+C` 停止服务。不需要先运行 `npm install`。

首次启动会从官方仓库获取**固定提交**的 vLLM 参考源码，放在项目的 `.cache/vllm/`，随后构建页面并校验所有源码跳转。首次需要联网，可能等待几分钟；缓存准备好后可离线启动。不会安装或执行 vLLM，也不会下载模型。工具不依赖任何同级目录或开发者机器上的绝对路径。

```bash
npm run setup          # 只准备参考源码
npm run build          # 准备源码并构建页面
npm test               # 构建并运行测试
npm run check:release  # 检查 Git 暂存区中的发布文件
```

参考版本在 [`src/source-version.mjs`](src/source-version.mjs) 中锁定：[`84030bbe3d`](https://github.com/vllm-project/vllm/commit/84030bbe3d74d99bad477a3d2e37a973ccd8865c)。不会自动跟随上游 `main`，避免讲解、行号与实现漂移。

端口与源码位置可以通过环境变量指定。以下使用相对路径示例：

```bash
# macOS / Linux：可选，使用已有源码并更换端口
VLLM_SOURCE_DIR=../my-vllm-checkout PORT=4174 npm start
```

```powershell
# Windows PowerShell：可选；不设置时使用自动准备的源码
$env:VLLM_SOURCE_DIR = '../my-vllm-checkout'
$env:PORT = '4174'
npm start
```

服务仅监听本机 `127.0.0.1`。自定义源码只读，不自动 fetch、reset 或修改它；不同版本可能需要重新校对讲解。网络、缓存与端口问题见 [安装与排错](docs/SETUP.md)。

## 建议的学习方式

1. 打开“学习路线”，从请求生命周期、Prefill / Decode、调度和 KV Cache 建立主线。
2. 在“想一想”先作出预测，再播放或单步观察；数值挑战使用当前实验参数。
3. 对照执行图、事件和状态变化，解释为什么发生分配、共享、重算或通信。
4. 用“对应源码”阅读本步骤的具体函数或文档章节。Runner 提供 MRV1 / MRV2 两条路径。
5. 把难点加入收藏。已读、理解题成绩和待复习题分别记录；专题参数、时间轴位置与页签会自动恢复。
6. “实验链接”包含参数和时间轴位置，可在同一工具的本地实例中复现，不包含学习成绩。

播放支持暂停、回退、单步、时间轴和速度控制。页面空白处空格播放，方向键前后，`/` 搜索；在输入控件内，键盘仍用于编辑控件。

## 按方法学习投机推理

左侧搜索框下方点击“投机推理 · 按方法展开”，或打开 <http://127.0.0.1:4173/#spec-methods>。学习路线和“04 投机解码”分组也提供入口。

1. 先做共同的“接受 / 拒绝”实验，再进入方法地图。
2. 按草稿来源筛选 12 个独立方法：N-gram、N-gram GPU、Suffix、Draft Model、EAGLE、EAGLE3、MTP、MLP Speculator、Medusa、PARD、DFlash、DSpark。
3. 每个方法提供 4 步专属机制图解、输入与权重说明、当前源码边界、理解题，以及可高亮实际行号的源码入口。
4. 用双方法对照表比较输入、额外权重、候选依赖和实现边界。动态草稿长度、自适应验证、训练与接入另列为进阶专题。
5. 展开配置说明，可将模板带入“启动命令”流程图。模板模型名须替换；环境变量前置采用 POSIX 写法，并按本章路径选择 MRV1 / MRV2。不执行命令，也不证明模型、硬件和配置组合能成功启动。

边界：这些新增图解不运行草稿模型、不测量速度。PARD 是 `draft_model + parallel_drafting=true`；DSpark 是并行骨干加顺序 Markov 采样。本地 MLP 注册项被注释、Runner 未接入，因此该章标注“机制参考”并不提供启动模板。EAGLE3 辅助特征开关、MTP 模型专属分支及 DFlash / DSpark 布局变体均单独说明。

## 从启动命令生成流程图

点击左侧搜索框下方的“启动命令 → 流程图”（顶部导航也保留“启动命令”），或访问 <http://127.0.0.1:4173/#command>。粘贴命令后点击“生成流程图”（也可 Ctrl / ⌘ + Enter）：

```bash
vllm serve Qwen/Qwen3-8B \
  --tensor-parallel-size 2 \
  --distributed-executor-backend mp \
  --enable-prefix-caching \
  --enable-chunked-prefill \
  --max-num-batched-tokens 2048
```

- “服务启动”展示入口、配置校验、执行器、模型加载、KV 分配、预热和 API 注册。
- “单个请求”展示 API、输入处理、DP 路由、队列、调度、KV、模型执行、采样 / Pooling、结果处理；可以切换对话、补全或向量请求。
- 主链速览展示整体顺序，详细图显示分支与参数依据。点击任一源码节点打开本地文件并高亮实际函数行；支持逐环节导览。
- 绿色表示参数启用，虚线表示条件分支。LoRA、缓存命中、多模态、结构化输出和流式响应还依赖具体请求；Runner、后端与部分默认值还依赖模型和硬件。
- 当前覆盖 63 个参数、56 个显式源码锚点，包含 TP / PP / DP、异步调度、前缀缓存、分块 Prefill、投机解码、LoRA、量化、Graph、KV 传输等。内置 6 个例子。
- 支持 `vllm serve`、Python API server 入口、`-tp` / `-pp` / `-dp` / `-sc` / `-cc` 等别名、等号写法、JSON 和点字段、常见 shell 续行。`NAME=value` 前置环境变量中，`VLLM_USE_V2_MODEL_RUNNER=0/1` 可选择 Runner 路径。
- 根据此版本 CLI 的规则，整段 JSON 与点字段混用时，点字段组会在解析末尾覆盖整个 JSON 参数；界面提示覆盖。模型位置参数与 `--model` 同时出现会报冲突。
- 未建模参数、未读取的 `--config`、自定义实现及其他前端均明确提示范围。外部 shell / Docker / torchrun 包装、PowerShell `$env:` 语句与环境变量引用不展开。这里只解析文本，不执行命令、不读取外部配置或下载模型；自定义命令不持久化。

流程是**基于本地源码的逻辑推导**，不是调用追踪。默认以 GPU Worker 为实现示例，并标明 CPU / TPU 等平台差异；它不能替代 vLLM 的完整启动校验或确定请求实际生成的 token。

## 可推演的核心实验

| 实验                      | 可以改变什么                                                           | 可以观察什么                                                                     |
| ------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 连续批处理 / 分块 Prefill | 1–6 个请求的输入长度、输出上限、到达轮次；预算、容量、块大小、切块开关 | 混合批次、物理块池、分配与释放、P/D/R 分项、执行前后状态；相同工作负载的开关对照 |
| 分页 KV / 前缀缓存        | 共享前缀长度、salt、缓存开关                                           | 逻辑块表、物理块、引用计数、就绪状态、命中与计算量对照                           |
| 投机解码                  | 草稿长度、分布接近程度、随机种子                                       | 从 q 提议，按 p/q 检验，首次拒绝、归一化残差恢复、bonus 与提交结果               |
| 结构化输出                | 单步推进语法状态                                                       | 真实 JSON Schema 形状、当前前缀、每个状态允许的示例词法单元                      |
| TP                        | rank 数量                                                              | x 与 W 分片、每卡局部乘法、All-reduce SUM 的具体数值                             |
| PP                        | 段数与独立 microbatch 数                                               | 填充、空泡、交接与排空的时序表                                                   |
| MoE / EP                  | 设备数量                                                               | Top-2 专家与权重、token 分发、专家计算与加权合并                                 |

其他专题保留流程和专用图解；采样、量化仍提供可计算的小例子。特性全景明确展示学习深度，文档关联与实现文件目录不代表已逐个复现所有 kernel。

## 源码定位与边界

- 讲解基准提交：`84030bbe3d74d99bad477a3d2e37a973ccd8865c`。
- 70 个专题、289 个讲解步骤都有显式定位：231 个实现符号、58 个文档章节，另有 4 个 MRV2 对照定位与 1 个 DSpark 置信度定位。57 篇 `docs/features` 文档均已关联。
- `source-map.mjs` 和 `spec-methods.mjs` 按步骤指定限定类名 / 函数名、命名注册表或文档章节，可进一步指定范围内的唯一文本。不会把文件第一个函数当作当前步骤实现。
- 构建校验锚点是否存在、是否歧义，并生成函数范围、行号与片段。若文件相对讲解基准改变，界面显示“讲解待复核”。能够定位不等于讲解自动适配新版本。
- **这是教学模拟与源码导航，不是真实 GPU trace 或 Python 单步调试器。** 调度为单组缓存、同步执行的简化模型，未完整复现生产调度器的全部策略与异步约束。
- 拒绝采样使用三词示例分布；结构化输出用词法单元演示有限词表，实际后端处理 tokenizer ID；TP 是小矩阵，PP 假定各段等时，MoE 使用简单专家函数。
- 比较指标为逻辑轮次、计算位置与块数量，不换算成实际毫秒或承诺加速比。停滞配置没有完成工作，不能据较低计算量得出性能更好的结论。
- 量化面板为对称整数量化，不实现所有 AWQ/GPTQ 校准或 FP8 编码。外部后端、传输库和插件仍需阅读其自己的项目。
- 源码服务只允许源码目录内的指定文本文件，阻止目录穿越、隐藏文件与目录外链接访问。

## 项目结构

```text
src/
  app.mjs                 页面编排与交互
  dom.mjs                 保留控件节点的局部 DOM 更新
  study-state.mjs         参数链接、断点、答题与收藏存储
  content.mjs             主课程与课程注册
  extra-lessons.mjs       扩展专题
  source-map.mjs          逐步骤源码映射与基准版本
  spec-methods.mjs        投机方法课程、配置模板与源码锚点
  spec-method-view.mjs    方法地图、对照与各方法专属图解
  spec-method.css         方法专题的响应式布局
  command-parser.mjs      启动命令的静态分词与参数解析
  command-flow.mjs        参数到启动 / 请求分支的推导规则
  command-sources.mjs     命令图的显式函数锚点
  command-view.mjs        流程图、参数依据与示例界面
  command.css             命令编辑器与响应式流程图
  learning.mjs            机制题、数值挑战与学习路线
  learning-view.mjs       练习和路线界面
  engine.mjs              统一执行记录与结果缓存
  engines/                调度、KV、投机、并行的纯计算模型
  experiment-view.mjs     可推演实验图形与对照
  renderers.mjs           其他机制图解
  styles.css              基础界面样式
  experiments.css         实验、路线与练习样式
scripts/
  setup-source.mjs        下载固定版本，验证并复用本机缓存
  start.mjs               统一的跨平台启动入口
  project.mjs             可迁移路径与源码目录校验
  build.mjs               从 src 生成 dist
  build-source.mjs        读取本地 vLLM 并生成索引
  source-locator.mjs      符号与章节定位
  check-browser.mjs       可选 Playwright 回归入口
  check-release.mjs       检查实际暂存内容，防止路径和凭据误提交
 .cache/vllm/             自动获取的上游源码；不提交
 tests/                   计算模型、源码、存储和浏览器回归
 dist/                    生成物；请修改 src 后重新构建
```

运行和构建只使用 Node 标准库。存储格式版本为 2，旧的已读进度会迁移，且不会被当成理解题通过。

## 验证

```powershell
npm test
```

自动构建并运行 Node 测试，覆盖教学模型、源码映射、命令解析、投机方法差异、离线缓存、固定版本、启动与源码服务，以及发布检查。测试验证教学模型与静态推导的契约，不替代真实模型 / GPU 的集成测试。CI 从干净检出开始，在 Windows / Linux 与 Node.js 22 / 24 上验证。

浏览器回归在 `tests/browser-regressions.mjs`、`tests/command-browser-regressions.mjs` 和 `tests/spec-browser-regressions.mjs`，共 12 组。覆盖方法地图、筛选对照、专属图解、精确源码跳转、MLP 边界与 PARD 命令跳转等交互。可选的独立运行方式：

```powershell
# 仅开发验证需要；正常启动无需这些依赖。
npm install --no-save --package-lock=false playwright
npx playwright install chromium
# 先在另一个终端 npm start，再执行：
npm run test:browser
```

脚本创建独立浏览器上下文，检查连续方向键、输入提交、刷新恢复、MRV1/MRV2 定位、弹窗关闭、缓存终态、错题反馈和语法允许集合，以及命令示例、参数开关、源码跳转、请求类型冲突、启动图、逐步导航和独立路由。额外检查包括历史前后导航、390px 命令流程布局和控制台错误。

## 文档与贡献

- [安装、离线使用与排错](docs/SETUP.md)
- [数据保存、命令与隐私边界](docs/PRIVACY.md)
- [新增专题、测试和提交规范](CONTRIBUTING.md)
- [安全范围与问题反馈](SECURITY.md)
- [更新记录](CHANGELOG.md)

## 许可证与致谢

工具代码使用 [Apache-2.0](LICENSE)。参考源码来自 [vllm-project/vllm](https://github.com/vllm-project/vllm)，由启动脚本独立获取，保留其版权与许可证；详见 [第三方说明](NOTICE)。该工具是独立学习项目，不是 vLLM 官方产品。
