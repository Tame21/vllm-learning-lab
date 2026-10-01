# vLLM Learning Lab · 推理，逐步看见

基于真实 vLLM 源码的中文交互学习工具：从一个请求的生命周期出发，逐步观察调度、KV Cache、模型执行、投机推理与多卡通信，再点击跳转到对应代码。

**114 个专题 · 20 节前置基础 · 114 个状态推演实验 · 24 个算法详解 · 504 个步骤源码定位 · 12 种投机方法**

运行只需要 [Node.js](https://nodejs.org/) 20+ 和 [Git](https://git-scm.com/)。无需 GPU、模型权重、Python，也无需安装 npm 依赖。

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

## 前置基础：先补知识，再学推理

点击顶部“前置基础”，或左栏“00 前置基础 → 前置基础 · 目录与学习顺序”，进入 <http://127.0.0.1:4173/#foundations>。学习路线也有入口。

20 节课程依次讲数学符号与矩阵、概率统计、语言模型基础、扩散与生成方式。包括条件概率、贝叶斯、期望方差、CDF 抽样、蒙特卡洛、高斯密度、熵 / 交叉熵 / KL、Embedding、Attention、训练与推理，以及连续扩散、离散扩散和 MTP 对照。

每课配白话直觉、符号表、公式、小算例、可调观察窗、常见误解和理解题。可以操作概率尺、联合概率表、频率曲线、向量与画布，单步观察每次计算；已有算法和机制章通过“建议先学”连接相应基础课。

扩散课分别播放前向加噪与独立反向条件采样，解释真实网络的训练目标。解析玩具先验、Mask 示例与当前 vLLM 离散扩散实现分别标明，不用倒放噪声模拟生成，也不把多 token 预测一概称为扩散。完整目录、推荐顺序和复现实验见 [前置基础学习指南](docs/FOUNDATIONS.md)。

## 算法专题：先列清单，再逐章计算

点击顶部“算法专题”，或左栏“09 算法专题 → 全部算法 · 目录与顺序”，进入 <http://127.0.0.1:4173/#algorithms>。共 24 章，按采样基础、投机与搜索、模型计算、缓存算法、数值与路由分组。

每章都有：解决的问题、直观类比、符号表、计算公式、手算例子、参数与边界案例、逐步观察窗、易错点、复杂度、理解题和具体源码。完整清单、源码位置与复现实验见 [算法学习指南](docs/ALGORITHMS.md)。

- 从稳定 Softmax、Top-k / Top-p / Min-p 到惩罚与指数竞赛采样，直接观察分数和概率变化。
- 接受 / 拒绝判断与正残差恢复分别讲解；观察阈值和随机数，再核对“接受质量 + 恢复质量 = 目标分布”。
- KMP 指针回退、贪心验证、Beam 剪枝、动态 K；Attention 加权、在线 Softmax 重缩放、RoPE 旋转、RMSNorm。
- 页表寻址、前缀哈希链、空闲队列与引用计数；INT8 误差、LoRA 矩阵、MoE 权重、EPLB 副本装箱及 Pooling。

推荐先学：稳定 Softmax → 接受 / 拒绝检验 → 正残差恢复，再按目录选择方向。算法与原机制章互相连接，保留原学习进度；公式案例与模拟数值不代表 GPU 实测。

## 按方法学习投机推理

在左侧学习地图的“04 投机解码”分组点击“投机推理方法地图”，或打开 <http://127.0.0.1:4173/#spec-methods>。学习路线也提供入口。

1. 先做共同的“接受 / 拒绝”实验，再进入方法地图。
2. 按草稿来源筛选 12 个独立方法：N-gram、N-gram GPU、Suffix、Draft Model、EAGLE、EAGLE3、MTP、MLP Speculator、Medusa、PARD、DFlash、DSpark。
3. 每个方法提供 4 个讲解环节、可调输入与逐事件观察窗、输入与权重说明、当前源码边界、理解题，以及可高亮实际行号的源码入口。
4. 用双方法对照表比较输入、额外权重、候选依赖和实现边界。动态草稿长度、自适应验证、训练与接入另列为进阶专题。
5. 展开配置说明，可将模板带入“启动命令”流程图。模板模型名须替换；环境变量前置采用 POSIX 写法，并按本章路径选择 MRV1 / MRV2。不执行命令，也不证明模型、硬件和配置组合能成功启动。

边界：这些教学推演不运行草稿模型、不测量速度。PARD 是 `draft_model + parallel_drafting=true`；DSpark 是并行骨干加顺序 Markov 采样。本地 MLP 注册项被注释、Runner 未接入，因此该章标注“机制参考”并不提供启动模板。EAGLE3 辅助特征开关、MTP 模型专属分支及 DFlash / DSpark 布局变体均单独说明。

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

第二轮为模型加载、Logits Processor / Gumbel 水印、Pooling、Prompt Embeddings、休眠唤醒、请求指标、CUDA Graph 和 KV 卸载补齐了 8 个交互观察窗。每个窗口提供可调参数、场景预设、逐事件回放和源码联动。先点“选个场景”，再单步比较切片、向量、缓存或时间线的变化；具体步骤和教学边界见 [实验指南](docs/MECHANISM_EXPERIMENTS.md)。

第三轮再补齐编译融合、KV FP8、在线权重量化、DBO、DP 路由和 Prefill / Decode 分离 6 个窗口。观察算子变换与缓存命中、字节编码和误差、加载期与运行期尺度、计算 / 通信依赖、路由分数和传输失败阻塞。两轮合计 44 个场景预设，数值和教学时隙都可检查。

按路线本轮新增 39 个窗口，全部 114 个专题具有教学执行记录：20 个基础、24 个算法、70 个机制专题。12 种投机方法提供可编辑历史、特征形状或查询布局，服务专题增加 parser / SSE / 故障状态，模型与平台专题展示条件分支与支持边界。MLP 仅演示级联机制并保持未接入终态。

原有 9 个状态专题也已深化，卸载补齐 GPU / CPU / 外部容量与淘汰，分离部署并排对照单实例读依赖。场景预设累计 170 个。完整逐项操作见 [路线实验指南](docs/ROADMAP_EXPERIMENTS.md)，验收与边界见 [路线清单](docs/VISUALIZATION_ROADMAP.md)。左侧可按关键词筛选；只有存在多种非空内容形式时才显示形式筛选。可推演实验仍是无需模型或 GPU 的教学模拟。

第一轮按学习主线补齐了 8 个观察窗。每个讲解环节可包含多个事件，播放、单步、拖动时间轴和点击关键环节会同步更新画面与源码。没有被当前参数触发的环节仍可阅读机制说明。可复现的操作步骤见 [观察窗实验指南](docs/MECHANISM_EXPERIMENTS.md)。

| 实验                      | 可以改变什么                                                           | 可以观察什么                                                                     |
| ------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 请求生命周期              | 输入长度、输出上限、EOS 时机                                           | 请求在六个阶段移动；KV 分配、前向写入、采样和交付分开；停止后回收                |
| Model Runner V1 / V2      | Runner、请求完成 / 加入、输入顺序                                      | 持久请求行、本轮 gather、输入张量、位置、块表与输出归属                          |
| 抢占、重算与取消          | KV 容量、取消 B 的轮次                                                 | 逐事件块池、历史 KV 重算、输出保留、取消释放；一键跳到关键事件                   |
| FCFS / Priority           | 策略、三个请求的优先级、容量                                           | 等待候选顺序、实际准入、抢占与另一策略的首运行顺序                               |
| 异步调度                  | 同步 / 重叠、CPU / GPU 逻辑耗时                                        | CPU、GPU、结果交付三条泳道；准备队列、完成事件与结果依赖                         |
| 滑动窗口与混合 KV         | 窗口、序列长度、块大小、状态空间对照                                   | Full Attention 与窗口读取范围、部分块保留、整块回收与物理块复用                  |
| Beam Search 与多样本      | 宽度、深度、候选偏好、长度指数、种子                                   | 候选树、累计 log 概率、排序剪枝、EOS 完成集合与独立采样                          |
| 动态草稿长度              | batch size、区间上限、各区间 K                                         | 四轮负载变化、闭区间匹配、草稿位置数量、K=0 的普通解码路径                       |
| 连续批处理 / 分块 Prefill | 1–6 个请求的输入长度、输出上限、到达轮次；预算、容量、块大小、切块开关 | 混合批次、物理块池、分配与释放、P/D/R 分项、执行前后状态；相同工作负载的开关对照 |
| 分页 KV / 前缀缓存        | 共享前缀长度、salt、缓存开关                                           | 逻辑块表、物理块、引用计数、就绪状态、命中与计算量对照                           |
| 投机解码                  | 草稿长度、分布接近程度、随机种子                                       | 从 q 提议，按 p/q 检验，首次拒绝、归一化残差恢复、bonus 与提交结果               |
| 结构化输出                | 单步推进语法状态                                                       | 真实 JSON Schema 形状、当前前缀、每个状态允许的示例词法单元                      |
| TP                        | rank 数量                                                              | x 与 W 分片、每卡局部乘法、All-reduce SUM 的具体数值                             |
| PP                        | 段数与独立 microbatch 数                                               | 填充、空泡、交接与排空的时序表                                                   |
| MoE / EP                  | 设备数量                                                               | Top-2 专家与权重、token 分发、专家计算与加权合并                                 |

当前 17 个专题具有状态推演，30 个仍是流程概览，其余为专用图解与投机方法图。采样、量化提供数值小例子。“特性全景”和专题徽标明确展示学习深度；后续顺序见 [可视化改进路线](docs/VISUALIZATION_ROADMAP.md)。文档关联与实现文件目录不代表已逐个复现所有 kernel。

## 源码定位与边界

- 源码窗口右上角“在 VS Code 中打开”会定位本机 VS Code 的同一文件与当前高亮行；文件位置由当前参考源码目录动态解析，支持默认缓存和 `VLLM_SOURCE_DIR`。本机需已安装 VS Code，并允许浏览器打开外部应用。
- 若浏览器未唤起编辑器，点击“复制文件定位”，在 VS Code 按 `Ctrl+P`（macOS 为 `⌘+P`）粘贴后回车。复制权限不可用时会显示可手动复制的定位框。相关排错见 [VS Code 打开源码](docs/SETUP.md#在-vs-code-中打开源码)。
- 源码弹窗采用 VS Code Dark+ 风格：文件标签、相对路径、固定行号、目标行高亮、自动换行与只读状态栏。Python、CUDA / C++、Rust、JSON、Markdown 等按语言区分关键字、字符串、注释和函数名；多行语法保持上下文。
- 高亮组件随项目打包，离线可用，不向 CDN 请求资源或上传源码。未知文件类型按纯文本显示。
- 讲解基准提交：`84030bbe3d74d99bad477a3d2e37a973ccd8865c`。
- 70 个专题、289 个讲解步骤都有显式定位：232 个实现符号、57 个文档章节，另有 4 个 MRV2 对照定位与 1 个 DSpark 置信度定位。57 篇 `docs/features` 文档均已关联。
- `source-map.mjs` 和 `spec-methods.mjs` 按步骤指定限定类名 / 函数名、命名注册表或文档章节，可进一步指定范围内的唯一文本。不会把文件第一个函数当作当前步骤实现。
- 构建校验锚点是否存在、是否歧义，并生成函数范围、行号与片段。若文件相对讲解基准改变，界面显示“讲解待复核”。能够定位不等于讲解自动适配新版本。
- **这是教学模拟与源码导航，不是真实 GPU trace 或 Python 单步调试器。** 调度为单组缓存、同步执行的简化模型，未完整复现生产调度器的全部策略与异步约束。
- 拒绝采样使用三词示例分布；结构化输出用词法单元演示有限词表，实际后端处理 tokenizer ID；TP 是小矩阵，PP 假定各段等时，MoE 使用简单专家函数。
- 新增观察窗的 token、批次、三词概率和状态空间递推均为教学输入。异步泳道使用输入相互独立的批次；取消发生在轮次边界；窗口示例省略投机额外保留和 Mamba checkpoint；Beam 长度分母包含固定的 2 token 前缀并排除 EOS。详细简化边界见实验指南。
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
  source-view.mjs         语法高亮、完整行号与源码阅读器
  source-view.css         VS Code Dark+ 风格的只读源码窗口
  source-editor.mjs       本机编辑器链接与文件定位复制
  vendor/highlight.js/    固定版本的本地高亮组件与 BSD 许可证
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
  engines/mechanisms.mjs   生命周期、Runner、异步、混合 KV、Beam、动态 K 的事件推演
  engines/queue-mechanisms.mjs  调度事件到抢占 / 优先级观察窗的映射
  mechanism-parameters.mjs 参数范围、默认值与专题参数映射
  mechanism-view.mjs      机制控件、状态场景分发与关键事件入口
  roadmap-parameters.mjs  新增观察窗的输入、标签、场景与边界目录
  roadmap-*-view.mjs      核心、投机、协议、平台与模型专属场景
  engines/roadmap-*.mjs   39 个新增专题的纯状态与数值记录
  engines/observation-depth.mjs 原有九专题的观察微事件
  engines/tiered-cache.mjs 三层容量、淘汰、回载与完成依赖
  observation-depth-view.mjs 地址链、局部部分和与同步对照
  mechanisms.css          请求行、块池、泳道与候选树的响应式样式
  algorithm-catalog.mjs   24 个算法的清单、讲解、公式、算例与理解题
  algorithm-sources.mjs   算法逐步骤源码符号
  algorithm-parameters.mjs 算法输入范围与默认值
  engines/algorithms.mjs  可复现的逐步数值模型
  algorithm-view.mjs      算法目录、控件与专属图形
  algorithms.css         算法图表和详解的响应式样式
  foundation-catalog.mjs  20 节前置基础、公式、算例、先修关系与源码应用
  foundation-parameters.mjs 基础课程分组、参数范围与默认值
  engines/foundations.mjs 概率统计、模型与扩散的纯教学计算
  foundation-view.mjs     基础目录、参数控件、向量、概率尺、曲线与画布
  foundations.css        基础课与图表的响应式样式
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
  source-files.mjs        文件访问边界、VS Code 定位与同源校验
  check-browser.mjs       可选 Playwright 回归入口
  check-release.mjs       检查实际暂存内容，防止路径和凭据误提交
 .cache/vllm/             自动获取的上游源码；不提交
 tests/                   计算模型、源码、存储和浏览器回归
 dist/                    生成物；请修改 src 后重新构建
```

服务和构建只使用 Node 标准库；浏览器端高亮组件已随源码打包，无需安装 npm 依赖。存储格式版本为 2，旧的已读进度会迁移，且不会被当成理解题通过。

## 验证

```powershell
npm test
```

自动构建并运行 Node 测试，覆盖教学模型、源码映射、命令解析、投机方法差异、离线缓存、固定版本、启动与源码服务，以及发布检查。测试验证教学模型与静态推导的契约，不替代真实模型 / GPU 的集成测试。CI 从干净检出开始，在 Windows / Linux 与 Node.js 22 / 24 上验证。

浏览器回归在 `tests/*browser-regressions.mjs`，共 99 组（本轮新增 39 组专题交互和 11 组观察过程深化；其余覆盖原机制、算法、前置基础、命令与编辑器）。覆盖方法地图、筛选对照、专属图解、精确源码跳转、MLP 边界、PARD 命令、基础概率与扩散交互等。编辑器回归核对协议目标、当前文件与行号及复制功能，不在自动化中启动桌面应用。可选的独立运行方式：

```powershell
# 仅开发验证需要；正常启动无需这些依赖。
npm install --no-save --package-lock=false playwright
npx playwright install chromium
# 先在另一个终端 npm start，再执行：
npm run test:browser
```

脚本创建独立浏览器上下文，检查连续方向键、输入提交、刷新恢复、MRV1/MRV2 定位、弹窗关闭、缓存终态、错题反馈和语法允许集合，以及命令示例、参数开关、源码跳转、请求类型冲突、启动图、逐步导航和独立路由。额外检查包括历史前后导航、390px 命令流程布局和控制台错误。

## 文档与贡献

- [20 节前置基础、学习顺序与复现实验](docs/FOUNDATIONS.md)
- [24 个算法清单、源码与复现实验](docs/ALGORITHMS.md)
- [机制观察窗实验指南](docs/MECHANISM_EXPERIMENTS.md)
- [可视化覆盖与后续路线](docs/VISUALIZATION_ROADMAP.md)
- [安装、离线使用与排错](docs/SETUP.md)
- [数据保存、命令与隐私边界](docs/PRIVACY.md)
- [新增专题、测试和提交规范](CONTRIBUTING.md)
- [安全范围与问题反馈](SECURITY.md)
- [更新记录](CHANGELOG.md)

## 许可证与致谢

工具代码使用 [Apache-2.0](LICENSE)。参考源码来自 [vllm-project/vllm](https://github.com/vllm-project/vllm)，由启动脚本独立获取，保留其版权与许可证；高亮组件 [highlight.js](https://github.com/highlightjs/highlight.js) 使用 [BSD-3-Clause](src/vendor/highlight.js/LICENSE)。详见 [第三方说明](NOTICE)。该工具是独立学习项目，不是 vLLM 官方产品。
