# Next-message suggestions for DSH

English | [中文](README.zh.md)

An independent third-party bundle for official **DSH 0.2.1-rc.5**. It modifies no application files and requires no custom Host build.

Starting with the third completed root assistant turn, one suggestion appears in grey while the composer is empty. `/suggest` refreshes three directions, including during the first two turns or while the main task is running. The empty composer shows “Generating suggestions…” while a manual request is pending. Typing hides this status without changing the draft. Left/right arrows change direction; Tab inserts the selected text into the draft and **never sends it**. Typing hides the suggestion. Menus, IME, modifiers, attachments and normal editing take priority. New human input cancels obsolete generation. Automatic failures remain silent; manual failures show a short inline message. A model may return no suggestions.

## Install or remove

Use [the conversational setup wizard](skills/dsh-next-message-setup/SKILL.md): give its SKILL.md to your agent and say “Set up suggestions for my DSH”, “Change only my suggestion model”, or “Set this up in a new Web/profile environment”. It detects existing settings, asks you to choose or answer only what is missing, then applies the selected configuration. You can copy the entire `skills/dsh-next-message-setup` folder into a skills directory your agent supports and use its loading mechanism. The self-contained skill ships with both this source tree and its release tgz; it guides setup, while the plugin still needs its local tgz. Using the wizard does not require reinstalling an existing plugin.

Download a compatible tgz from [Releases](https://github.com/Dopetaiga/dsh-next-message/releases), then fully quit Desktop; its profile must already have been initialized. Use its installed CLI wrapper. If `dsh` is not on PATH, locate the CLI wrapper shipped with your Desktop installation and assign its actual path to `$dsh` instead of using `Get-Command`:

```powershell
$dsh = (Get-Command dsh -ErrorAction Stop).Source
$package = (Resolve-Path './dsh-next-message-0.1.3.tgz').Path
& $dsh plugin --profile desktop add $package --ignore-scripts --config.auto-install-peers=false
& $dsh plugin --profile desktop list --depth 0
# To remove, fully quit Desktop again, then:
& $dsh plugin --profile desktop remove dsh-next-message
```

The official installer activates the bundle for that profile. Installation into another Web profile is separate. Existing model credentials are reused through the Host's LLM service; this plugin neither reads nor copies credential files.

## Configuration and audit

Use the setup skill above, or override `next-message` in the profile's `cordis.patch.yml`. This plugin has no dedicated configuration page; official plugins that supply companion pages can offer forms, and a Config schema alone does not create one. Defaults are `automatic: true`, `automaticSkipTurns: 2`, `maxInputBytes: 48000`, `maxOutputTokens: 2048`, `timeoutMs: 30000`, `pollIntervalMs: 750`. Set `automatic: false` to disable automatic generation. `automaticSkipTurns` skips that many completed root turns: the default 2 starts after the third; 0 starts after the first. Counts include restored conversation history, exclude interrupted turns, and never restrict `/suggest`. Omit both `provider` and `model` to reuse the current conversation model; set both to choose another registered route. Optional `reasoningEffort` must be supported by that route. When omitted, the plugin chooses the lowest advertised effort; without advertised controls it preserves the provider default. The 2048-token output cap covers reasoning and the answer, is an upper limit rather than mandatory usage, and applies only to suggestions. Failed requests are not retried automatically. Config replacement follows DSH's normal whole-config semantics, so preserve the other fields you need. `logDirectory` optionally overrides the audit location. Generation is asynchronous, so suggestions appear after the auxiliary model finishes. The manual status follows polling, normally within 750 ms plus network time. The client starts polling immediately and uses a 750 ms bootstrap retry interval until it receives the configured interval from the Host.

Suggestions use the latest `contextExchanges: 2` real user requests and their completed final assistant replies. Tool results, tool arguments, system/developer messages and intermediate assistant text are excluded. Each field keeps its first `contextHeadChars: 300` and last `contextTailChars: 900` Unicode code points; both allowances cannot be zero. `maxInputBytes` additionally caps the whole excerpt: oldest groups are dropped first, then the remaining group's fields retain proportionate head/tail text within the byte budget. No tools, cross-session retrieval or memory writes are used. Each eligible automatic suggestion consumes one additional model request.

Each human message admitted to the Session opens a group, including steering within a turn. Only the latest group of a completed turn receives its last assistant text; a running, interrupted or tool-calling message is never treated as a final reply. Manual generation during a task can include its user request without a paired assistant reply. Attachment-only messages isolate their group, but groups without user text are omitted. Pending inbox messages not yet admitted to Session history are not added. The bounded projection rebuilds from the released Session registry on restore and fork; compaction summaries do not become user requests, and an unfinished fork does not promote a partial reply. This does not alter the main model's prompt, messages or settings.

To select a separate suggestion model, add this entry to the Desktop profile's `cordis.patch.yml`. Replace both angle-bracket values with IDs already registered in DSH; this example does not register a model or credential. Omit both `provider` and `model` to keep using the conversation model. `reasoningEffort`, when supplied, and `maxOutputTokens` affect the auxiliary call only.

```yaml
- id: next-message
  config:
    automatic: true
    automaticSkipTurns: 2
    contextExchanges: 2
    contextHeadChars: 300
    contextTailChars: 900
    maxInputBytes: 48000
    provider: "<registered-provider-id>"
    model: "<registered-model-id>"
    maxOutputTokens: 2048
    timeoutMs: 30000
    pollIntervalMs: 750
```

Auxiliary requests and responses are audited separately from the main Session log, under `$DSH_HOME/plugin-data/dsh-next-message/<session-id-sha256>.jsonl`. Records contain the captured Session sequence, request identity, exact model input and resolved controls, response blocks, accepted choices and failure/cancellation status. A request is sent only after its audit write succeeds; a result is offered only after its result audit succeeds. State is process-local and suggestions can be regenerated after reopening. Uninstalling preserves the audit files.

## Compatibility and validation

`engines.dsh` pins the tested release; future official updates are not claimed compatible. The released launcher skips incompatible bundle layers with a warning and disables incompatible explicit plugin entries. Remove this plugin with the official command above if it needs adaptation after an update; do not grant a version exemption merely to force it to load.

`tests/verify.mjs` uses the installed official runtime, an isolated temporary `DSH_HOME`, a deterministic model adapter and system Edge. Maintainers need Node >=24.9, an installed compatible official Windows Desktop runtime, system Edge, and a DSH source checkout with its Web test dependencies installed. Run `node tests/verify.mjs <desktop-install-directory> <dsh-source-checkout>`; both paths are required. Playwright is resolved from that checkout only as a test tool; no source Host modules enter the application. Temporary credentials and logs stay under this repository's ignored `.artifacts/` directory. It covers automatic/manual generation, running-task cancellation, audit, owner-only state access, keyboard/menu/IME behavior, actual light/dark contrast and unload cleanup. This is keyless integration evidence, not a claim about live-model suggestion quality.
