# 贡献指南

感谢改进 vLLM Learning Lab。请让讲解、图解和实际源码保持一致，明确教学简化与真实实现的边界。

## 本地开发

```bash
git clone https://github.com/Tame21/vllm-learning-lab.git
cd vllm-learning-lab
npm start
```

首次启动自动准备固定版本的参考源码。修改 `src/` 后运行 `npm run build` 并刷新页面。不要编辑或提交 `dist/`，不要直接修改自动管理的 `.cache/vllm/`。如需分析自己的 vLLM 分支，用 `VLLM_SOURCE_DIR` 显式指定。

## 新增或修订专题

1. 在 `content.mjs` / `extra-lessons.mjs` 注册专题；投机方法在 `spec-methods.mjs` 中维护。
2. 为每步指定准确的类方法、命名注册表或文档章节。需要时追加范围内唯一的文本锚点，不使用写死的行号。
3. 模拟类实验先定义可验证的执行记录，再让图形、事件和指标读取同一份数据。仅解释机制的图解应明确标注，不伪装成模型实测。
4. 添加理解题并保持旧专题 ID 与既有答案顺序，避免破坏本机学习记录。
5. 更新文档映射、测试、README 和 CHANGELOG。

`src/source-version.mjs` 是上游地址和讲解基准的唯一来源。更新它时需核对相关代码变化与支持边界；锚点能定位不等于内容自动正确。

## 验证与提交

```bash
npm test
git add src scripts tests docs README.md CHANGELOG.md
npm run check:release
```

只暂存本次需要发布的文件，并检查 `git diff --cached`。发布检查读取的是暂存 blob，工作区里未暂存的脱敏修改不会掩盖旧秘密。不要提交真实密钥、日志、用户目录、内部地址、截图中的个人信息或本机配置。

浏览器交互回归为可选开发流程，安装方法见 README。涉及布局或导航时，请检查桌面与窄屏、键盘操作、源码行号和浏览器控制台。CI 自动验证 Windows / Linux、Node.js 22 / 24 的独立启动与测试。

提交 PR 时说明具体问题、修改后的行为、验证结果，以及仍未覆盖的真实模型或硬件场景。提交身份可在本仓库单独配置为自己的 GitHub 用户名和 GitHub 提供的 noreply 邮箱，无需改变全局 Git 设置。

提交的贡献应允许按本项目 Apache-2.0 许可证分发；第三方内容保留相应版权与许可证说明。
