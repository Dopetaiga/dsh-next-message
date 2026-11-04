# DSH 下一句建议

[English](README.md) | 中文

适配官方 **DSH 0.2.1-rc.5** 的独立第三方 bundle，不修改应用文件，也不需要定制宿主。

默认从第三个完整根助手回合结束起，空输入框显示一条灰字建议。`/suggest` 主动刷新三个方向，前两轮或主任务执行中也可使用；手动生成期间，空输入框显示“正在生成建议…”，打字会隐藏提示且不改变草稿。左右键切换，Tab 将选中内容填入草稿，**绝不自动发送**。开始输入即隐藏；菜单、IME、修饰键、附件和正常编辑优先。新用户输入会取消过期生成。自动失败不打扰，手动失败显示简短行内提示；无有用方向时可以不提供建议。

## 安装与卸载

使用[对话式配置向导](skills/dsh-next-message-setup/SKILL.md)：把 SKILL.md 交给 agent，说“帮我首次安装并配置建议插件”“只换建议模型”或“换到新的 Web/profile 环境”。向导先检测现有设置，再让你选择或回答缺失项，随后自动落配置。也可将整个 `skills/dsh-next-message-setup` 目录复制到所用 agent 支持的 skills 目录，按该 agent 的机制加载。skill 可独立分发，同时随源码目录和发布 tgz 提供；它负责设置，建议功能仍需本地插件包，已有插件不必为使用向导重装。

从 [Releases](https://github.com/Dopetaiga/dsh-next-message/releases) 下载兼容的 tgz，再完全退出 Desktop，且其 profile 已初始化。使用安装版自带 CLI；如果 `dsh` 未加入 PATH，找到实际安装目录自带的 CLI 启动器，将其真实路径赋给 `$dsh`，不使用下面的 `Get-Command`：

```powershell
$dsh = (Get-Command dsh -ErrorAction Stop).Source
$package = (Resolve-Path './dsh-next-message-0.1.3.tgz').Path
& $dsh plugin --profile desktop add $package --ignore-scripts --config.auto-install-peers=false
& $dsh plugin --profile desktop list --depth 0
# 卸载前再次完全退出 Desktop：
& $dsh plugin --profile desktop remove dsh-next-message
```

官方安装器会在指定 profile 激活 bundle；其他 Web profile 需要分别安装。插件通过宿主 LLM 服务复用已有模型凭证，不读取或复制凭据文件。

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
