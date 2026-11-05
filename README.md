# Next-message suggestions for DSH

English | [中文](README.zh.md)

## Installation entry for AI agents

Read the [setup skill](skills/dsh-next-message-setup/SKILL.md) to guide detection, compatible npm installation and configuration in one conversation. You can tell your agent: “Help me install and configure https://github.com/Dopetaiga/dsh-next-message”. A repository link provides instructions for the agent to read; it does not itself authorize or automatically run installation. If GitHub is unreachable, give the agent the npm package name `dsh-next-message` and use the official DSH plugin installer; the installed package provides the local setup skill.

An independent third-party bundle for official **DSH 0.2.1-rc.5**. It modifies no application files and requires no custom Host build.

Starting with the third completed root assistant turn, one suggestion appears in grey while the composer is empty. `/suggest` refreshes three directions, including during the first two turns or while the main task is running. The empty composer shows “Generating suggestions…” while a manual request is pending. Typing hides this status without changing the draft. Left/right arrows change direction; Tab inserts the selected text into the draft and **never sends it**. Typing hides the suggestion. Menus, IME, modifiers, attachments and normal editing take priority. New human input cancels obsolete generation. Automatic failures remain silent; manual failures show a short inline message. A model may return no suggestions.

## Install or remove

In official DSH, open **Plugins → Add plugin**, enter `dsh-next-message@0.1.4`, review the package and install it. For mainland China networks, choose the Host’s **npmmirror** source; registry fallback follows Host settings. The npm package contains the prebuilt runtime and setup skill: installation does not fetch GitHub or run package install/build scripts. Another Web/Desktop profile needs its own installation. Existing model credentials are reused through the Host LLM service, without reading or copying credential files. DSH compatibility remains restricted to the declared version.

After installation, tell your DSH agent: “Use dsh-next-message-setup to configure suggestions”, “Change only my suggestion model”, or “Set this up in a new Web/profile environment”. The plugin registers its bundled [conversational wizard](skills/dsh-next-message-setup/SKILL.md) with the official skill service; the agent can discover and load it locally. It detects current settings and asks only missing choices. Unloading the plugin removes this contribution without copying files into global skill folders. Configuring an installed plugin does not require reinstalling it.

For CLI installation, use the actual profile and the official CLI shipped with your installation. If `dsh` is not on PATH, locate the installed CLI wrapper instead of assuming a path. An external CLI operation on Desktop requires fully quitting the app; the built-in installer operates through the running Host and may request a restart when live application is unavailable.

```sh
dsh plugin --profile desktop add dsh-next-message@0.1.4 --registry=https://registry.npmmirror.com
dsh plugin --profile desktop list --depth 0
# To remove, fully quit Desktop first when using this external CLI:
dsh plugin --profile desktop remove dsh-next-message
```

Omit `--registry` to use Host/pnpm defaults. The official npm registry is `https://registry.npmjs.org`; mirror synchronization may lag a new release. [GitHub Releases](https://github.com/Dopetaiga/dsh-next-message/releases) and local tgz files remain optional alternatives. To use the wizard outside DSH, give its SKILL.md to your agent or copy the whole skill directory into a location that agent supports; its loading mechanism still applies.

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
