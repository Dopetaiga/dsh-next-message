# DSH 下一句建议

[English](README.md) | 中文

## 给 AI 的安装入口

请 agent 先读取[配置向导](skills/dsh-next-message-setup/SKILL.md)，在同一轮对话中完成检测、兼容 npm 版本安装和配置。你可以说：“帮我安装并配置 https://github.com/Dopetaiga/dsh-next-message”。仓库链接是供 agent 读取的指引，不会自行授权或自动执行安装。GitHub 打不开时，直接提供 npm 包名 `dsh-next-message`，通过官方 DSH 插件安装器安装；安装包自带本地配置向导。

适配官方 **DSH 0.2.1-rc.5** 的独立第三方 bundle，不修改应用文件，也不需要定制宿主。

默认从第三个完整根助手回合结束起，空输入框显示一条灰字建议。`/suggest` 主动刷新三个方向，前两轮或主任务执行中也可使用；手动生成期间，空输入框显示“正在生成建议…”，打字会隐藏提示且不改变草稿。左右键切换，Tab 将选中内容填入草稿，**绝不自动发送**。开始输入即隐藏；菜单、IME、修饰键、附件和正常编辑优先。新用户输入会取消过期生成。自动失败不打扰，手动失败显示简短行内提示；无有用方向时可以不提供建议。

## 安装与卸载

在官方 DSH 打开**插件 → 添加插件**，填写 `dsh-next-message@0.1.4`，检查包信息后安装。国内网络可选择宿主提供的 **npmmirror 国内镜像**，失败回退遵循宿主设置。npm 包已包含运行文件和配置 skill，安装不下载 GitHub，也不运行包安装或构建脚本。不同 Web/Desktop profile 需分别安装；通过宿主 LLM 服务复用现有凭证，不读取或复制凭据文件。兼容版本仍以声明为准。

安装后在 DSH 对话说：“使用 dsh-next-message-setup 帮我配置建议”“只换建议模型”或“换到新的 Web/profile 环境”。插件通过官方 skill 服务注册随包的[对话式向导](skills/dsh-next-message-setup/SKILL.md)，agent 可直接发现并本地加载；向导先检测现状，只问缺失选择。卸载或禁用插件会撤销该贡献，不向全局 skill 目录复制文件。已安装插件改配置无需重装。

命令行安装使用实际 profile 及官方安装自带 CLI；`dsh` 未加入 PATH 时先定位其启动器，不假定机器路径。外部 CLI 操作 Desktop 前须完全退出应用；应用内安装器通过运行中的宿主操作，不能即时应用时可能提示重启。

```sh
dsh plugin --profile desktop add dsh-next-message@0.1.4 --registry=https://registry.npmmirror.com
dsh plugin --profile desktop list --depth 0
# 使用外部 CLI 卸载前先完全退出 Desktop：
dsh plugin --profile desktop remove dsh-next-message
```

省略 `--registry` 则遵循宿主/pnpm 默认；官方 npm 源为 `https://registry.npmjs.org`，镜像同步新版本可能有延迟。[GitHub Releases](https://github.com/Dopetaiga/dsh-next-message/releases) 和本地 tgz 作为备选。在 DSH 之外使用向导时，将 SKILL.md 交给 agent，或将完整技能目录复制到该 agent 支持的位置，再按其机制加载。

## 配置与审计

可使用上述设置 skill，或在对应 profile 的 `cordis.patch.yml` 中覆盖 `next-message`。本插件没有专属配置页；官方插件可由伴生配置页提供表单，Config schema 本身不会自动生成表单。默认值：`automatic: true`、`automaticSkipTurns: 2`、`maxInputBytes: 48000`、`maxOutputTokens: 2048`、`timeoutMs: 30000`、`pollIntervalMs: 750`。设 `automatic: false` 关闭自动建议。`automaticSkipTurns` 表示跳过多少个完整根回合：默认 2 从第三轮结束起生成，设为 0 从第一轮结束起生成；计数包含恢复的历史会话，不计中断回合，不限制 `/suggest`。同时省略 `provider`、`model` 复用当前会话模型，同时指定两者可选择其他已注册模型。可选 `reasoningEffort` 必须受目标模型支持；省略时选择已公布的最低推理档位，未公布控制能力时保留提供方默认行为。2048 token 上限覆盖推理和正文，仅用于建议，并非每次必耗这么多；失败不自动重试。配置替换遵循 DSH 的整份 config 语义，应保留所需其他字段。可用 `logDirectory` 指定审计目录。建议在后台模型完成后出现；手动生成提示随轮询刷新，默认最多约 750 毫秒加网络耗时。客户端立即首次读取，在收到宿主配置的间隔前使用 750 毫秒的启动重试间隔。

建议只读取最近 `contextExchanges: 2` 组真实用户请求及对应的已完成最终回复，排除工具结果、工具参数、system/developer 和助手中间过程。每段默认保留前 `contextHeadChars: 300`、后 `contextTailChars: 900` 个 Unicode 码点，两项不能同时为 0。`maxInputBytes` 另外限制整份摘录：先丢最旧的组，仍超限时按头尾比例缩短剩余组内字段，保持字节预算。不调用工具、不跨会话检索、不写记忆；每次符合门槛的自动建议额外调用一次模型。

每条已进入 Session 的真实用户消息开一组，同轮 steering 也如此；完整回合的最后助手文本只配给该轮最新请求，执行中、中断或带工具调用的消息不视为最终回复。执行中 `/suggest` 可以包含最新用户请求但没有配对回复。纯附件消息会隔离配对，但没有用户文本的组不发送；尚在 inbox、未进入 Session 历史的消息不额外拼入。受限投影在恢复和 fork 时由发布版 Session registry 重建；压缩摘要不当作用户请求，未完成的 fork 不把部分回复升级成最终回复。插件不改变主模型提示词、消息和设置。

如需单独指定建议模型，在 Desktop profile 的 `cordis.patch.yml` 添加以下条目。两个尖括号占位值须替换为 DSH 中已注册的 provider ID、model ID；此例不会注册模型或凭据。同时省略 `provider`、`model` 则继续使用会话模型。可选 `reasoningEffort` 和 `maxOutputTokens` 只影响辅助调用。

```yaml
- id: next-message
  config:
    automatic: true
    automaticSkipTurns: 2
    contextExchanges: 2
    contextHeadChars: 300
    contextTailChars: 900
    maxInputBytes: 48000
    provider: "<已注册的provider-id>"
    model: "<已注册的model-id>"
    maxOutputTokens: 2048
    timeoutMs: 30000
    pollIntervalMs: 750
```

辅助请求和响应独立审计，不写入主 Session 日志。位置为 `$DSH_HOME/plugin-data/dsh-next-message/<会话ID的SHA256>.jsonl`，记录捕获时的 Session 序号、请求标识、完整模型输入和最终参数、响应块、采纳的候选及失败/取消状态。请求审计写入成功才调用模型，结果审计成功才展示。建议状态保存在进程内，重新打开后可再生成；卸载保留审计文件。

## 兼容性与验证

`engines.dsh` 固定为已验证版本，不承诺兼容后续官方更新。发布版启动器会警告并跳过不兼容的 bundle 层，显式插件条目则被禁用；更新后如需适配，可先用上述官方命令卸载，不应仅为强制加载而添加版本豁免。

`tests/verify.mjs` 使用真实安装版、隔离临时 `DSH_HOME`、确定性模型适配器和系统 Edge。维护者需要 Node >=24.9、兼容的官方 Windows Desktop 安装版、系统 Edge，以及已安装 Web 测试依赖的 DSH 源码 checkout。运行 `node tests/verify.mjs <desktop安装目录> <dsh源码checkout>`，两个路径均必填。Playwright 仅从该 checkout 作为测试工具解析，源码宿主模块不会进入应用；临时凭据和日志仅写入本仓库忽略的 `.artifacts/` 目录。覆盖自动/手动生成、执行中取消、独立审计、仅 owner 可读状态、键盘/菜单/IME、真实明暗主题对比度和卸载清理。它证明无密钥集成行为，不代表真实模型建议质量验收。
