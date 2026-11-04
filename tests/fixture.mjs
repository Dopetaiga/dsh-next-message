/** Keyless fixture loaded only into an isolated profile of the installed official runtime. */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { readFile, writeFile, readdir } from 'node:fs/promises'

export const inject = ['llm', 'agents', 'commands', 'connection', 'webServer', 'loader', 'sessions']

export function apply(ctx, config) {
  const published = createRequire(pathToFileURL(join(config.archive, 'dsh', 'package.json')))
  const load = async name => import(pathToFileURL(published.resolve(name)))
  const run = async () => {
    const { LlmAdapter, createUserMessage, createAssistantMessage, createToolResultMessage } = await load('@deepseek-ai/dsh-llm')
    const { compactCheckpointSource } = await load('@deepseek-ai/dsh-compaction')
    const events = []
    let contextSessionId
    const contextEvents = []
    ctx.on('session/event', (session, event) => {
      events.push({ sessionId: session.id, type: event.type })
      if (session.id === contextSessionId) contextEvents.push(event)
    }, { global: true })
    let held
    let invalid = false
    let emptyResult = false
    let reasoningOnly = false
    let entered
    let mainHold
    const replacementHolds = []
    const requests = []
    class Adapter extends LlmAdapter {
      resolveModel(provider, model) {
        return Promise.resolve({ provider, id: model, name: model, reasoning: { efforts: [{ id: 'off', name: 'Off' }, { id: 'low', name: 'Low' }] } })
      }
      async *stream(options) {
        requests.push(options)
        const auxiliary = options.purpose === 'next-message-suggestions'
        if (auxiliary && held) { entered?.(); await held.promise }
        if (!auxiliary && mainHold) { mainHold.entered(); await mainHold.promise }
        if (auxiliary && reasoningOnly) {
          yield { type: 'block-start', index: 0, blockType: 'reasoning' }
          yield { type: 'reasoning-delta', index: 0, text: 'Synthetic budget-consuming reasoning. '.repeat(65) }
          yield { type: 'finish', reason: { kind: 'max-tokens' } }
          return
        }
        yield { type: 'block-start', index: 0, blockType: 'text' }
        const count = options.system?.includes('exactly 3 suggestions') ? 3 : 1
        yield { type: 'text-delta', index: 0, text: auxiliary ? invalid ? 'invalid JSON' : JSON.stringify(emptyResult ? [] : ['Continue implementation', 'Explain the result', 'Inspect the evidence'].slice(0, count)) : 'The requested work is complete.' }
        yield { type: 'finish', reason: { kind: 'stop' } }
      }
    }
    ctx.llm.registerAdapter(['suggestions-fixture', 'suggestions-aux-fixture'], new Adapter())
    ctx.connection.fetch.register({ path: '/api/next-message-fixture', methods: ['GET'], requestBody: 'buffered', fetch: async () => Response.json({ events, auxiliaryCalls: requests.filter(request => request.purpose === 'next-message-suggestions').length, primaryCalls: requests.filter(request => request.purpose !== 'next-message-suggestions').length }) })
    ctx.connection.fetch.register({ path: '/api/next-message-hold-fixture', methods: ['POST'], requestBody: 'buffered', fetch: async request => {
      const action = (await request.json()).action
      assert.ok(['hold', 'release'].includes(action))
      if (action === 'hold') held = Promise.withResolvers()
      else { held?.resolve(); held = undefined }
      return Response.json({ accepted: true })
    } })
    // This verifier outlives the tested provider so it can observe actual unload cleanup.
    const service = ctx.get('nextMessageSuggestions')
    assert.ok(service)
    const bridge = ctx.connection.createSharedFetchHandler('/api')
    const guest = ctx.connection.createPeer({ principal: { kind: 'suggestions-test-guest' }, interactions: 'none' })
    const denied = await bridge.fetch(new Request('http://localhost/api/next-message-suggestions?sessionId=test'), guest)
    assert.equal(denied.status, 403)
    await guest.dispose()
    ctx.connection.fetch.register({ path: '/api/next-message-unload-fixture', methods: ['POST'], requestBody: 'buffered', fetch: async () => {
      const agents = [...service.cells.keys()].map(session => ctx.agents.get(session.id)).filter(Boolean)
      const id = ctx.loader.locate(ctx.fiber).replace(/[^:]+$/, 'next-message')
      held?.resolve()
      held = undefined
      await ctx.loader.resolve(id).fiber.dispose()
      assert.ok(agents.every(agent => ctx.commands.find(agent, 'suggest') === undefined))
      const absent = await bridge.fetch(new Request('http://localhost/api/next-message-suggestions?sessionId=test'), ctx.connection.browserPeer)
      assert.equal(absent.status, 404)
      return Response.json({ routeRemoved: true, commandRemoved: true, drained: service.pending.size === 0 && service.writes.size === 0 })
    } })
    const settle = async () => { while (service.pending.size) await Promise.allSettled([...service.pending]) }
    let handle = await ctx.agents.create({ sessionId: randomUUID(), meta: { cwd: config.root }, agentOptions: { provider: 'suggestions-fixture', model: 'main' } })
    let agent = handle.agent
    const prompt = text => agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] }))
    const checks = []
    checks.push('non-owner Peer rejected with 403 by the authenticated exact-route carrier')
    try {
      prompt('Finish the implementation')
      await agent.whenIdle()
      await settle()
      assert.equal(service.config.automaticSkipTurns, 2)
      assert.equal(service.completedTurns(agent.session), 1)
      assert.equal(service.contextText(agent.session), 'User: Finish the implementation\nAssistant (completed): The requested work is complete.')
      assert.equal(requests.filter(request => request.purpose === 'next-message-suggestions').length, 0)
      assert.equal(service.cell(agent.session).choices.length, 0)
      const command = await ctx.commands.execute(agent, '/suggest', [], new AbortController().signal)
      assert.equal(command.result.kind, 'success')
      await settle()
      assert.equal(service.cell(agent.session).choices.length, 3)
      assert.equal(service.cell(agent.session).generating, false)
      checks.push('three distinct manual suggestions bypass the automatic two-turn threshold')

      const afterManual = requests.length
      prompt('Finish the second turn')
      await agent.whenIdle()
      await settle()
      assert.equal(service.completedTurns(agent.session), 2)
      assert.ok(service.contextText(agent.session).includes('Assistant (completed): The requested work is complete.'))
      assert.equal(requests.length, afterManual + 1)
      assert.deepEqual(service.cell(agent.session).choices, [])
      const previousSession = agent.session
      const resumeSessionId = previousSession.id
      await handle.dispose()
      handle = await ctx.agents.resume({ resumeSessionId, agentOptions: { provider: 'suggestions-fixture', model: 'main' } })
      agent = handle.agent
      assert.notEqual(agent.session, previousSession)
      assert.equal(service.completedTurns(agent.session), 2)
      prompt('Finish the third turn after reopening')
      await agent.whenIdle()
      await settle()
      assert.equal(service.completedTurns(agent.session), 3)
      assert.equal(service.cell(agent.session).choices.length, 1)
      checks.push('default skips the first two completed turns; persisted resume recovers two and the third generates one')
      const contextConfig = service.config
      try {
        service.config = { ...contextConfig, automatic: false, provider: 'suggestions-aux-fixture', model: 'fast' }
        contextSessionId = randomUUID()
        const history = ctx.sessions.create(contextSessionId)
        const seed = contextEvents
        const append = (type, data, options) => history.append(type, data, options)
        const user = text => createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] })
        const assistant = (turn, text, extra = []) => append('assistant/message', { turn, step: 1, message: createAssistantMessage({ content: [{ type: 'text', text }, ...extra], source: { provider: 'suggestions-fixture', model: 'main' } }), stream: [] }, { surfaceOp: 'append' })
        const complete = turn => append('turn/end', { turn, reason: { kind: 'completed' } })
        append('turn/start', { turn: 1 })
        const firstUser = append('user/message', user('OLD_REQUEST'), { surfaceOp: 'append' })
        assistant(1, 'OLD_FINAL')
        complete(1)
        append('turn/start', { turn: 2 })
        const longUser = '😀'.repeat(305) + 'USER_MIDDLE_NOT_RETAINED'.repeat(100) + '尾'.repeat(905)
        const longAnswer = '🚀'.repeat(305) + 'ANSWER_MIDDLE_NOT_RETAINED'.repeat(100) + '终'.repeat(905)
        append('user/message', user(longUser), { surfaceOp: 'append' })
        const callId = randomUUID()
        assistant(2, 'INTERMEDIATE_TOOL_NARRATION', [{ type: 'tool-call', id: callId, name: 'fixture-tool', arguments: JSON.stringify({ value: 'TOOL_ARGUMENT_SECRET'.repeat(1000) }) }])
        append('tool/call', { turn: 2, step: 1, callId, name: 'fixture-tool', arguments: JSON.stringify({ value: 'TOOL_ARGUMENT_SECRET'.repeat(1000) }) })
        append('tool/result', { turn: 2, step: 1, message: createToolResultMessage({ callId, content: [{ type: 'text', text: 'LONG_TOOL_OUTPUT'.repeat(10000) }], isError: false }) }, { surfaceOp: 'append' })
        assistant(2, longAnswer)
        complete(2)
        service.config = { ...service.config, maxInputBytes: 4000 }
        const clippedBytes = service.contextText(history)
        assert.ok(Buffer.byteLength(clippedBytes) <= 4000)
        assert.equal(clippedBytes.isWellFormed(), true)
        for (const character of ['😀', '尾', '🚀', '终']) assert.ok(clippedBytes.includes(character))
        service.config = { ...service.config, maxInputBytes: contextConfig.maxInputBytes }
        append('turn/start', { turn: 3 })
        append('user/message', user('LATEST_REQUEST'), { surfaceOp: 'append' })
        assistant(3, 'RUNNING_PROGRESS_NOT_FINAL')
        const running = service.contextText(history)
        assert.ok(running.endsWith('User: LATEST_REQUEST'))
        assert.ok(!running.includes('RUNNING_PROGRESS_NOT_FINAL'))
        const lastAssistant = assistant(3, 'LATEST_FINAL')
        complete(3)
        const expected = `User: ${'😀'.repeat(300)}…${'尾'.repeat(900)}\nAssistant (completed): ${'🚀'.repeat(300)}…${'终'.repeat(900)}\n\nUser: LATEST_REQUEST\nAssistant (completed): LATEST_FINAL`
        assert.equal(service.contextText(history), expected)
        service.start(history, 3, true)
        await settle()
        assert.equal(requests.at(-1).messages[0].content[0].text, expected)
        assert.equal(requests.at(-1).provider, 'suggestions-aux-fixture')
        assert.equal(requests.at(-1).model, 'fast')
        const oldContext = history.deriveMessages().filter(message => message.role === 'user' || message.role === 'assistant' || message.role === 'tool').map(message => `${message.role}: ${message.content.filter(block => block.type === 'text').map(block => block.text).join('\n')}`).join('\n\n')
        await writeFile(join(config.root, 'context-evidence.json'), JSON.stringify({ previousExcerptBytesBeforeCap: Buffer.byteLength(oldContext), previousMaxInputBytes: contextConfig.maxInputBytes, newAuxiliaryInputBytes: Buffer.byteLength(expected), contextExchanges: service.config.contextExchanges, contextHeadChars: service.config.contextHeadChars, contextTailChars: service.config.contextTailChars, byteCapCase: Buffer.byteLength(clippedBytes), unicodeWellFormed: clippedBytes.isWellFormed() }, null, 2))
        assert.ok(!/OLD_REQUEST|OLD_FINAL|MIDDLE_NOT_RETAINED|TOOL_OUTPUT|TOOL_ARGUMENT|INTERMEDIATE/.test(expected))
        const compactionId = randomUUID()
        const shadowedSeqs = seed.filter(event => event.surfaceOp !== undefined).map(event => event.seq)
        const compactionStart = append('compaction/start', { compactionId, turn: null })
        const summary = [{ type: 'text', text: 'COMPACTION_SUMMARY_NOT_A_HUMAN_REQUEST' }]
        const compactionSummary = append('compaction/summary', { compactionId, summary, shadowedRange: { start: firstUser.seq, end: lastAssistant.seq }, shadowedSeqs, shadowedTokenCount: 100, provider: 'suggestions-fixture', model: 'main' })
        append('user/message', createUserMessage({ source: compactCheckpointSource(compactionId), content: summary }), { surfaceOp: { op: 'replace', startSeq: firstUser.seq, endSeq: lastAssistant.seq }, sourceEventSeqs: [compactionStart.seq, compactionSummary.seq, ...shadowedSeqs] })
        append('compaction/end', { compactionId, turn: null })
        assert.equal(history.deriveMessages().length, 1)
        assert.equal(service.contextText(history), expected)
        const restored = ctx.sessions.create(randomUUID(), { seed })
        assert.equal(service.contextText(restored), expected)
        const fork = ctx.sessions.fork(history, undefined, randomUUID())
        assert.equal(service.contextText(fork), expected)
        service.config = { ...service.config, maxInputBytes: 100 }
        const small = service.contextText(history)
        assert.ok(Buffer.byteLength(small) <= 100)
        assert.ok(small.includes('LATEST_REQUEST'))
        service.config = { ...service.config, maxInputBytes: 4800 }
        const boundedUnicode = service.contextText(history)
        assert.ok(Buffer.byteLength(boundedUnicode) <= 4800)
        assert.equal(boundedUnicode.isWellFormed(), true)
        service.config = { ...service.config, maxInputBytes: contextConfig.maxInputBytes }
        append('turn/start', { turn: 4 })
        append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'image', attachment: { attachmentId: '0'.repeat(64), mediaType: 'image/png', bytes: 68, width: 1, height: 1 } }] }), { surfaceOp: 'append' })
        assistant(4, 'ATTACHMENT_ONLY_REPLY_NOT_PAIRED_WITH_LATEST_REQUEST')
        complete(4)
        assert.equal(service.contextText(history), 'User: LATEST_REQUEST\nAssistant (completed): LATEST_FINAL')
        append('turn/start', { turn: 5 })
        append('user/message', user('INTERRUPTED_REQUEST'), { surfaceOp: 'append' })
        assistant(5, 'INTERRUPTED_DRAFT')
        append('turn/end', { turn: 5, reason: { kind: 'aborted', reason: { kind: 'user' } } })
        append('turn/start', { turn: 6 })
        append('user/message', user('AFTER_INTERRUPTION'), { surfaceOp: 'append' })
        complete(6)
        assert.equal(service.contextText(history), 'User: INTERRUPTED_REQUEST\n\nUser: AFTER_INTERRUPTION')
        checks.push('bounded last two real exchanges exclude tools and progress, retain Unicode head/tail, obey byte cap, survive compaction/replay/fork, and isolate attachment-only/interrupted turns')
      } finally { service.config = contextConfig }
      const mainOptions = { ...agent.options }
      const previousMain = requests.find(request => request.purpose !== 'next-message-suggestions')
      try {
        service.config = { ...contextConfig, provider: 'suggestions-aux-fixture', model: 'fast', reasoningEffort: 'low', maxOutputTokens: 333 }
        await ctx.commands.execute(agent, '/suggest', [], new AbortController().signal)
        await settle()
        const auxiliary = requests.at(-1)
        assert.equal(auxiliary.provider, 'suggestions-aux-fixture')
        assert.equal(auxiliary.model, 'fast')
        assert.equal(auxiliary.reasoningEffort, 'low')
        assert.equal(auxiliary.maxTokens, 333)
        prompt('Main route must stay unchanged')
        await agent.whenIdle()
        await settle()
        assert.deepEqual(agent.options, mainOptions)
        const main = requests.findLast(request => request.purpose !== 'next-message-suggestions')
        for (const field of ['provider', 'model', 'maxTokens', 'reasoningEffort']) assert.equal(main[field], previousMain[field])
        const systemText = request => request.messages.filter(message => message.role === 'system').flatMap(message => message.content.filter(block => block.type === 'text').map(block => block.text)).join('\n')
        assert.equal(systemText(main), systemText(previousMain))
        assert.ok(!systemText(main).includes('Suggest the next message'))
        checks.push('explicit auxiliary provider/model/effort/budget affect only suggestions; main options, request controls and system prompt remain unchanged')
      } finally { service.config = contextConfig }
      const originalConfig = service.config
      try {
        service.config = { ...originalConfig, automaticSkipTurns: 0 }
        const fresh = await ctx.agents.create({ sessionId: randomUUID(), meta: { cwd: config.root }, agentOptions: { provider: 'suggestions-fixture', model: 'main' } })
        try {
          fresh.agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'First turn with zero skipped turns' }] }))
          await fresh.agent.whenIdle()
          await settle()
          assert.equal(service.completedTurns(fresh.agent.session), 1)
          assert.equal(service.cell(fresh.agent.session).choices.length, 1)
        } finally { await fresh.dispose() }
      } finally { service.config = originalConfig }
      checks.push('automaticSkipTurns zero generates after the first completed turn')

      const releaseA = Promise.withResolvers()
      replacementHolds.push(releaseA)
      const enteredA = Promise.withResolvers()
      held = releaseA
      entered = () => enteredA.resolve()
      await ctx.commands.execute(agent, '/suggest', [], new AbortController().signal)
      await enteredA.promise
      const workA = [...service.pending]
      assert.equal(service.cell(agent.session).generating, true)
      const releaseB = Promise.withResolvers()
      replacementHolds.push(releaseB)
      const enteredB = Promise.withResolvers()
      held = releaseB
      entered = () => enteredB.resolve()
      await ctx.commands.execute(agent, '/suggest', [], new AbortController().signal)
      await enteredB.promise
      releaseA.resolve()
      await Promise.allSettled(workA)
      assert.equal(service.cell(agent.session).generating, true)
      releaseB.resolve()
      await settle()
      held = undefined
      entered = undefined
      assert.equal(service.cell(agent.session).generating, false)
      emptyResult = true
      await ctx.commands.execute(agent, '/suggest', [], new AbortController().signal)
      await settle()
      assert.deepEqual(service.cell(agent.session).choices, [])
      assert.equal(service.cell(agent.session).generating, false)
      emptyResult = false
      checks.push('replacement manual request retains generating until its own success; empty successful result clears it')

      // A blocked primary stream remains running while the command starts its own blocked auxiliary stream.
      const mainRelease = Promise.withResolvers()
      const mainEntered = Promise.withResolvers()
      mainHold = { promise: mainRelease.promise, entered: () => mainEntered.resolve(), release: () => mainRelease.resolve() }
      prompt('Continue the main task')
      await mainEntered.promise
      const auxiliaryRelease = Promise.withResolvers()
      const auxiliaryEntered = Promise.withResolvers()
      held = auxiliaryRelease
      entered = () => auxiliaryEntered.resolve()
      await ctx.commands.execute(agent, '/suggest', [], new AbortController().signal)
      await auxiliaryEntered.promise
      assert.equal(agent.status, 'running')
      const captured = requests.at(-1)
      assert.ok(captured.messages[0].content[0].text.endsWith('User: Continue the main task'))
      assert.equal(captured.signal.aborted, false)
      assert.equal(service.cell(agent.session).generating, true)
      prompt('New human input invalidates old suggestions')
      assert.equal(captured.signal.aborted, true)
      assert.deepEqual(service.cell(agent.session).choices, [])
      assert.equal(service.cell(agent.session).generating, false)
      auxiliaryRelease.resolve()
      await settle()
      assert.deepEqual(service.cell(agent.session).choices, [])
      held = undefined
      mainHold = undefined
      mainRelease.resolve()
      await agent.whenIdle()
      await settle()
      checks.push('manual command returns during running primary stream; human inbox receipt aborts stale work')

      invalid = true
      await ctx.commands.execute(agent, '/suggest', [], new AbortController().signal)
      await settle()
      assert.equal(service.cell(agent.session).failed, true)
      assert.equal(service.cell(agent.session).failureCode, 'invalid-json')
      assert.equal(service.cell(agent.session).generating, false)
      service.start(agent.session, 1, false)
      await settle()
      assert.equal(service.cell(agent.session).failed, false)
      invalid = false
      checks.push('manual failure is visible; automatic failure stays silent')

      reasoningOnly = true
      const beforeLimited = requests.length
      await ctx.commands.execute(agent, '/suggest', [], new AbortController().signal)
      await settle()
      assert.equal(requests.length, beforeLimited + 1)
      assert.equal(service.cell(agent.session).failureCode, 'output-limit')
      assert.deepEqual(service.cell(agent.session).choices, [])
      reasoningOnly = false
      await ctx.commands.execute(agent, '/suggest', [], new AbortController().signal)
      await settle()
      assert.equal(service.cell(agent.session).choices.length, 3)
      assert.equal(service.cell(agent.session).failed, false)
      assert.equal(agent.options.reasoningEffort, undefined)
      checks.push('reasoning-only max-tokens response is classified without retry; a new successful request clears the failure')

      const files = await readdir(service.directory)
      const audit = (await Promise.all(files.map(async file => (await readFile(join(service.directory, file), 'utf8')).trim().split('\n').map(line => JSON.parse(line))))).flat()
      const request = audit.find(row => row.kind === 'request' && row.sessionId === agent.session.id)
      assert.equal(request.request.provider, 'suggestions-fixture')
      assert.equal(request.request.model, 'main')
      assert.equal(request.request.maxTokens, 2048)
      assert.equal(request.request.reasoningEffort, 'off')
      checks.push('auxiliary request selects the lowest advertised effort without changing main Agent options')
      assert.deepEqual(request.request.tools, [])
      assert.equal(request.request.purpose, 'next-message-suggestions')
      assert.ok(Number.isSafeInteger(request.sourceSeq))
      assert.ok(audit.some(row => row.kind === 'cancelled'))
      assert.ok(audit.some(row => row.kind === 'response' && row.blocks.some(block => block.type === 'text')))
      assert.ok(events.every(event => !event.type.startsWith('suggestions/') && !event.type.startsWith('plugin:')))
      checks.push('complete auxiliary audit is separate; no plugin Session events')
      const modules = [...ctx.loader.internal.loadCache.keys()].filter(url => url.includes('/@deepseek-ai/'))
      assert.ok(modules.every(url => url.includes('/resources/app.asar/dsh/node_modules/')))
      checks.push('all loaded host capabilities come from the official installation')
      await writeFile(join(config.root, 'host-evidence.json'), `${JSON.stringify({ checks, auditRecords: audit.length, modules }, null, 2)}\n`)
    } finally {
      for (const release of replacementHolds) release.resolve()
      held?.resolve()
      mainHold?.release()
      await handle.dispose()
    }
    await writeFile(join(config.root, 'ready.json'), `${JSON.stringify({ url: ctx.connection.authenticatedUrl(ctx.webServer.getOrigin()), checks })}\n`)
  }
  ctx.effect(() => ctx.get('appReady').onReady(() => { void run().catch(error => { console.error(error.stack); ctx.get('appExit')(1) }) }), 'next-message: published-runtime fixture')
}
