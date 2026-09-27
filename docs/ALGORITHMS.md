# 算法学习指南

从顶部“算法专题”或左栏“09 算法专题”进入。目录路由为 `#algorithms`，课程使用稳定的 `#alg-…` 路由。以下 24 章均已提供详细讲解和数值观察窗，不是待办清单。

## 学习顺序与范围

建议先学 **稳定 Softmax → 接受 / 拒绝检验 → 正残差恢复**，再按兴趣进入各组。每章都按“问题 → 类比 → 符号 → 公式 → 手算 → 修改参数 → 检查边界 → 理解题 → 源码”组织。点击关键环节可跳到对应动画帧；未触发的分支会说明原因。

本清单覆盖当前固定 vLLM 版本中的 24 个核心算法或规则，不代表穷尽每个模型、硬件后端和优化 kernel。所有动画由浏览器内的教学计算生成，不运行 vLLM，也不测 GPU 吞吐。每章单独标注简化边界；例如动态 K 是配置查表规则，不是自动学习最优 K。

## 算法清单与源码入口

源码基准：[vllm-project/vllm 84030bbe3d](https://github.com/vllm-project/vllm/tree/84030bbe3d74d99bad477a3d2e37a973ccd8865c)。应用中的“对应源码”会打开本机缓存并高亮准确函数，下面提供上游固定版本链接。

### 采样基础

从分数到概率，再到一个 token。

| 算法 / 入口                                                  | 观察的计算                                                     | 主要源码                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [稳定 Softmax 与温度](http://127.0.0.1:4173/#alg-softmax)    | 把任意分数变成概率，并解释为什么温度为 0 要走另一条路径。      | [`Sampler.apply_temperature`](https://github.com/vllm-project/vllm/blob/84030bbe3d74d99bad477a3d2e37a973ccd8865c/vllm/v1/sample/sampler.py)<br>[`TopKTopPSampler.forward_native`](https://github.com/vllm-project/vllm/blob/84030bbe3d74d99bad477a3d2e37a973ccd8865c/vllm/v1/sample/ops/topk_topp_sampler.py)                  |
| [Top-k 阈值筛选](http://127.0.0.1:4173/#alg-topk)            | 只让分数足够高的候选继续参与抽样，注意并列阈值。               | [`apply_top_k_only`](https://github.com/vllm-project/vllm/blob/84030bbe3d74d99bad477a3d2e37a973ccd8865c/vllm/v1/sample/ops/topk_topp_sampler.py)                                                                                                                                                                               |
| [Top-p 累积概率截断](http://127.0.0.1:4173/#alg-topp)        | 按概率质量而非固定个数保留候选，观察跨过阈值的那一项。         | [`apply_top_k_top_p_pytorch`](https://github.com/vllm-project/vllm/blob/84030bbe3d74d99bad477a3d2e37a973ccd8865c/vllm/v1/sample/ops/topk_topp_sampler.py)                                                                                                                                                                      |
| [Min-p 相对概率门槛](http://127.0.0.1:4173/#alg-minp)        | 用最高概率作为基准，移除相对它太小的候选。                     | [`MinPLogitsProcessor.apply`](https://github.com/vllm-project/vllm/blob/84030bbe3d74d99bad477a3d2e37a973ccd8865c/vllm/v1/sample/logits_processor/builtin.py)<br>[`TopKTopPSampler.forward_native`](https://github.com/vllm-project/vllm/blob/84030bbe3d74d99bad477a3d2e37a973ccd8865c/vllm/v1/sample/ops/topk_topp_sampler.py) |
| [重复、频率与存在惩罚](http://127.0.0.1:4173/#alg-penalties) | 区分三种惩罚的公式，以及 prompt 与已生成历史的不同作用。       | [`apply_penalties`](https://github.com/vllm-project/vllm/blob/84030bbe3d74d99bad477a3d2e37a973ccd8865c/vllm/model_executor/layers/utils.py)<br>[`TopKTopPSampler.forward_native`](https://github.com/vllm-project/vllm/blob/84030bbe3d74d99bad477a3d2e37a973ccd8865c/vllm/v1/sample/ops/topk_topp_sampler.py)                  |
| [指数竞赛随机采样](http://127.0.0.1:4173/#alg-exponential)   | 解释源码为什么用 probability / exponential_noise 再取 argmax。 | [`sample_with_exponential_noise`](https://github.com/vllm-project/vllm/blob/84030bbe3d74d99bad477a3d2e37a973ccd8865c/vllm/v1/sample/ops/topk_topp_sampler.py)                                                                                                                                                                  |

### 投机与搜索

候选如何被验证、纠正和保留。

| 算法 / 入口                                                       | 观察的计算                                                            | 主要源码                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [投机推理：接受 / 拒绝检验](http://127.0.0.1:4173/#alg-rejection) | 从一个候选的 p/q 比值出发，弄清接受概率与首拒绝截断。                 | [`rejection_random_sample_kernel`](https://github.com/vllm-project/vllm/blob/84030bbe3d74d99bad477a3d2e37a973ccd8865c/vllm/v1/sample/rejection_sampler.py)                                                                                                                                                                                  |
| [拒绝后的残差恢复分布](http://127.0.0.1:4173/#alg-residual)       | 逐项推导 max(p−q,0)，验证“接受质量 + 恢复质量 = p”。                  | [`sample_recovered_tokens_kernel`](https://github.com/vllm-project/vllm/blob/84030bbe3d74d99bad477a3d2e37a973ccd8865c/vllm/v1/sample/rejection_sampler.py)                                                                                                                                                                                  |
| [贪心投机验证与 Bonus](http://127.0.0.1:4173/#alg-greedy-verify)  | 逐位置比较目标 argmax，首个不一致处纠正，全部一致才追加 Bonus。       | [`rejection_greedy_sample_kernel`](https://github.com/vllm-project/vllm/blob/84030bbe3d74d99bad477a3d2e37a973ccd8865c/vllm/v1/sample/rejection_sampler.py)                                                                                                                                                                                  |
| [N-gram 的反转 KMP 匹配](http://127.0.0.1:4173/#alg-ngram)        | 观察 LPS 回退、最长后缀匹配和候选复制，理解无模型草稿。               | [`_find_longest_matched_ngram_and_propose_tokens`](https://github.com/vllm-project/vllm/blob/84030bbe3d74d99bad477a3d2e37a973ccd8865c/vllm/v1/spec_decode/ngram_proposer.py)                                                                                                                                                                |
| [Beam Search 累积评分与剪枝](http://127.0.0.1:4173/#alg-beam)     | 把现有候选树提升为算法推演：累计 log 概率、长度惩罚、EOS 与最终排序。 | [`BeamSearchOfflineMixin.beam_search`](https://github.com/vllm-project/vllm/blob/84030bbe3d74d99bad477a3d2e37a973ccd8865c/vllm/entrypoints/generate/beam_search/offline.py)<br>[`get_beam_search_score`](https://github.com/vllm-project/vllm/blob/84030bbe3d74d99bad477a3d2e37a973ccd8865c/vllm/entrypoints/generate/beam_search/utils.py) |
| [动态草稿长度的区间查表](http://127.0.0.1:4173/#alg-dynamic)      | 把并发数映射为草稿数 K，区分配置规则和在线优化算法。                  | [`build_dynamic_sd_schedule_lookup`](https://github.com/vllm-project/vllm/blob/84030bbe3d74d99bad477a3d2e37a973ccd8865c/vllm/v1/spec_decode/dynamic/utils.py)                                                                                                                                                                               |

### 模型计算

注意力、位置与数值稳定性。

| 算法 / 入口                                                                | 观察的计算                                                    | 主要源码                                                                                                                                                                                                                                                                                                                     |
| -------------------------------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [因果缩放点积 Attention](http://127.0.0.1:4173/#alg-attention)             | 用一个 query、四个 key/value 手算相关性、掩码和加权和。       | [`kernel_unified_attention`](https://github.com/vllm-project/vllm/blob/84030bbe3d74d99bad477a3d2e37a973ccd8865c/vllm/v1/attention/ops/triton_unified_attention.py)                                                                                                                                                           |
| [在线 Softmax 与分块 Attention](http://127.0.0.1:4173/#alg-online-softmax) | 逐块维护最大值、指数和与加权累加器，解释重缩放为何不可省。    | [`softmax_step`](https://github.com/vllm-project/vllm/blob/84030bbe3d74d99bad477a3d2e37a973ccd8865c/vllm/v1/attention/ops/triton_attention_helpers.py)<br>[`kernel_unified_attention`](https://github.com/vllm-project/vllm/blob/84030bbe3d74d99bad477a3d2e37a973ccd8865c/vllm/v1/attention/ops/triton_unified_attention.py) |
| [RoPE：成对坐标旋转](http://127.0.0.1:4173/#alg-rope)                      | 在平面里转动 query/key 的一个坐标对，理解位置差如何进入点积。 | [`RotaryEmbedding.forward_static`](https://github.com/vllm-project/vllm/blob/84030bbe3d74d99bad477a3d2e37a973ccd8865c/vllm/model_executor/layers/rotary_embedding/base.py)                                                                                                                                                   |
| [RMSNorm：均方根归一化](http://127.0.0.1:4173/#alg-rmsnorm)                | 逐项平方、求均值、加 epsilon，再恢复方向并乘学习权重。        | [`rms_norm`](https://github.com/vllm-project/vllm/blob/84030bbe3d74d99bad477a3d2e37a973ccd8865c/vllm/ir/ops/layernorm.py)                                                                                                                                                                                                    |

### 缓存算法

从逻辑位置到可复用的物理块。

| 算法 / 入口                                                          | 观察的计算                                                        | 主要源码                                                                                                                                                                                                                                                                                  |
| -------------------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [分页 KV 的地址映射](http://127.0.0.1:4173/#alg-paged-address)       | 从 token 位置求逻辑块、块内偏移，再通过块表得到物理 slot。        | [`ComputeSlotMappingKernel.kernel`](https://github.com/vllm-project/vllm/blob/84030bbe3d74d99bad477a3d2e37a973ccd8865c/vllm/v1/worker/block_table.py)                                                                                                                                     |
| [前缀缓存的链式哈希键](http://127.0.0.1:4173/#alg-prefix-hash)       | 逐块组合父键、当前 token 与附加键，解释相同后缀为何不能随便复用。 | [`hash_block_tokens`](https://github.com/vllm-project/vllm/blob/84030bbe3d74d99bad477a3d2e37a973ccd8865c/vllm/v1/core/kv_cache_utils.py)<br>[`BlockPool.get_cached_block`](https://github.com/vllm-project/vllm/blob/84030bbe3d74d99bad477a3d2e37a973ccd8865c/vllm/v1/core/block_pool.py) |
| [空闲块队列、引用计数与淘汰](http://127.0.0.1:4173/#alg-cache-queue) | 观察命中触碰、释放入队和从队头重新分配，区分缓存与占用。          | [`BlockPool.get_new_blocks`](https://github.com/vllm-project/vllm/blob/84030bbe3d74d99bad477a3d2e37a973ccd8865c/vllm/v1/core/block_pool.py)                                                                                                                                               |

### 数值与路由

小矩阵、低精度和专家分配。

| 算法 / 入口                                                       | 观察的计算                                             | 主要源码                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [逐 Token 对称 INT8 量化](http://127.0.0.1:4173/#alg-int8)        | 逐项计算 absmax、scale、舍入值和还原误差。             | [`_per_token_quant_int8`](https://github.com/vllm-project/vllm/blob/84030bbe3d74d99bad477a3d2e37a973ccd8865c/vllm/model_executor/layers/quantization/utils/int8_utils.py)                                                                                                                                                               |
| [LoRA 的低秩增量计算](http://127.0.0.1:4173/#alg-lora)            | 用两次小矩阵乘法得到 Δy，并与基础输出逐维相加。        | [`BaseLinearLayerWithLoRA._apply_lora_to_output`](https://github.com/vllm-project/vllm/blob/84030bbe3d74d99bad477a3d2e37a973ccd8865c/vllm/lora/layers/base_linear.py)                                                                                                                                                                   |
| [MoE Top-k 路由与权重归一化](http://127.0.0.1:4173/#alg-moe-topk) | 区分选哪些专家、给它们多少权重，以及最后如何合并结果。 | [`fused_topk`](https://github.com/vllm-project/vllm/blob/84030bbe3d74d99bad477a3d2e37a973ccd8865c/vllm/model_executor/layers/fused_moe/router/fused_topk_router.py)                                                                                                                                                                     |
| [EPLB：副本分配与均衡装箱](http://127.0.0.1:4173/#alg-eplb)       | 观察高负载专家获得副本，再按容量约束装入设备。         | [`DefaultEplbPolicy.balanced_packing`](https://github.com/vllm-project/vllm/blob/84030bbe3d74d99bad477a3d2e37a973ccd8865c/vllm/distributed/eplb/policy/default.py)                                                                                                                                                                      |
| [序列 Pooling 与 L2 归一化](http://127.0.0.1:4173/#alg-pooling)   | 把 token 向量聚合成一个序列向量，再决定是否归一化。    | [`MeanPool.forward`](https://github.com/vllm-project/vllm/blob/84030bbe3d74d99bad477a3d2e37a973ccd8865c/vllm/model_executor/layers/pooler/seqwise/methods.py)<br>[`EmbeddingPoolerHead.forward`](https://github.com/vllm-project/vllm/blob/84030bbe3d74d99bad477a3d2e37a973ccd8865c/vllm/model_executor/layers/pooler/seqwise/heads.py) |

## 六组可复现的学习实验

### 1. 接受阈值不是目标概率

打开“接受 / 拒绝检验”，使用 p=[0.1,0.6,0.3]、q=[0.5,0.3,0.2]，候选选 A。阈值为 0.2，默认 u=0.25 应拒绝。把 u 改为 0.15 应接受；把候选改为 B，即使 u=0.99 也接受。再选择“q 为单点分布”与候选 B，观察 q(B)=0 的非法提议防御分支。这个控制器固定一个候选供观察，不声称手动选择等同于从 q 抽样。

### 2. 为什么拒绝后用正残差

打开“残差恢复分布”，单步得到接受质量 h=min(p,q)=[0.1,0.3,0.2]，总和为 0.6。还缺 d=max(p−q,0)=[0,0.3,0.1]，总和 R=0.4。已发生拒绝的条件下，恢复分布 r=d/R=[0,0.75,0.25]。

最终每项质量是 h+Rr=[0.1,0.6,0.3]=p。注意这里加的是 **R×r**，不是直接加 r；如果拒绝后简单从 p 抽一次，就变成 h+Rp，一般不等于 p。观察窗最后一帧用两种颜色叠加两部分，并列出逐项数值。切换 p=q 时，R=0，不会进入恢复，不能强行把零向量归一化。

### 3. Top-k 和 Top-p 的边界

Top-k 切换“并列分数”，k=2，输入 [2,1,1,0,−1] 会保留 3 项：当前 PyTorch 阈值路径屏蔽的是严格小于第 k 大分数的项。Top-p 的 0.8 表示截断前的概率质量目标，跨过门槛的 token 需要留下，随后再归一化为总和 1。各后端的并列处理不一定相同。

### 4. 在线 Softmax 不等于每块单独归一化后相加

用分数 [0,1,3,2]、Value=[1,2,4,−1]。每块维护最大值 m、指数和 l、加权和 a。后续块出现更大的最大值时，旧 l/a 必须先乘 exp(m旧−m新)，再累加当前块。最后才取 a/l。把块大小从 2 改为 1、3、4，再切换整体加 1000 的分数，在线结果应与一次性计算一致。

### 5. 一个逻辑 token 怎么找到 KV

“分页 KV 的地址映射”默认位置 5、block size=4，逻辑块为 1、块内偏移为 1。默认块表的第 1 项是物理块 0，所以 slot=0×4+1=1。拖动位置跨过边界，逻辑位置连续，但物理块可以跳到另一处。slot 是元素槽位，不是完整的 K/V 字节地址。

### 6. 缓存存在，不代表不能重新分配

“空闲块队列”先把 ref=0 的块放入可分配队列；命中后移出并增加引用，释放到零后放回队尾。申请时从队头取走，清除旧缓存映射。选择“仍有引用”观察块不能入队；选择“没有空闲块”观察整个申请失败，已有状态不会被部分破坏。

## 如何验证与继续扩展

运行 `npm test` 会校验概率守恒、KMP 与朴素匹配对照、因果掩码、分块数值等价、缓存不变量、INT8 误差、LoRA 矩阵等价、路由与 Pooling，以及每个算法案例的渲染、参数链接和源码锚点。浏览器用例在 `tests/algorithm-browser-regressions.mjs`，可从 `npm run test:browser` 一并运行。

新增算法需同时更新 `algorithm-catalog.mjs`、`algorithm-sources.mjs`、`algorithm-parameters.mjs` 与 `engines/algorithms.mjs`。每帧必须有有效 stepIndex、事件和可解释状态，不能只增加泛用流程节点。通用柱图与数值表可复用；特殊数据结构在 `algorithm-view.mjs` 中单独绘制。旧 ID 与已有题目选项顺序不能随注册顺序变化。

## 代码来源与数值约定

原始参考代码和文档来自 [vLLM](https://github.com/vllm-project/vllm)，Apache-2.0；固定版本、来源与许可证保留在本项目的 NOTICE。N-gram 教学引擎的反转 KMP 控制逻辑由该版本的 `vllm/v1/spec_decode/ngram_proposer.py` 移植，原项目版权声明保留在文件头；其余章节是围绕所列源码规则编写的小规模教学实现。

INT8 章节对照源码的 CUDA `libdevice.round` 分支：最近整数，恰好半格时远离零（见 [NVIDIA roundf 定义](https://docs.nvidia.com/cuda/libdevice-users-guide/__nv_roundf.html)）。示例使用 JavaScript 双精度，并不保证与所有 GPU dtype 的末位舍入相同。哈希使用完整输入签名和 Hₙ 教学代号表达相等关系，不声称计算了真实的生产摘要。随机种子用于复现教学过程，与 GPU 随机数流不等价。
