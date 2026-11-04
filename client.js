/** Browser artifact in the published DSH client module format; React is a shared external. */
window.__ModuleLoader__.load({
  id: 'dsh-next-message',
  factory(require) {
    const React = require('react')
    const { createElement: h, useEffect, useLayoutEffect, useRef, useState } = React
    const css = '[data-composer-card]:has([data-next-message-visible]) [data-composer-placeholder]{visibility:hidden}.next-message-ghost{position:absolute;pointer-events:none;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--dsw-alias-label-secondary);font:inherit;line-height:inherit}.next-message-instructions{position:absolute;width:1px;height:1px;padding:0;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap}'

    /** An overlay consumes only the published session hooks, input actions and fixed-input observer. */
    function Suggestions(props) {
      const input = props.useInput(value => value)
      const menu = props.useNextMessageMenu(value => value)
      const pending = props.useSession(value => value.pendingSubmissions.length)
      const removed = props.useSession(value => value.removed)
      const root = useRef(null)
      const [view, setView] = useState({ sessionId: props.sessionId, choices: [], revision: -1, failed: false })
      const [selection, setSelection] = useState({ sessionId: props.sessionId, revision: -1, index: 0 })
      const [suppression, setSuppression] = useState({ sessionId: props.sessionId, revision: -1 })
      const [box, setBox] = useState(null)
      const active = view.sessionId === props.sessionId && view.revision > (suppression.sessionId === props.sessionId ? suppression.revision : -1)
      const choices = active ? view.choices : []
      const index = selection.sessionId === props.sessionId && selection.revision === view.revision ? selection.index : 0
      const selected = choices[index]
      const empty = input !== undefined && input.draft === '' && input.attachmentIds.length === 0 && input.phase === 'plain'
      const generating = active && view.generating
      const visible = empty && !removed && !pending && !menu.open && (selected !== undefined || active && view.failed || generating)

      useEffect(() => {
        if (pending) setSuppression({ sessionId: props.sessionId, revision: view.revision })
      }, [pending, view.revision, props.sessionId])

      useEffect(() => {
        const controller = new AbortController()
        let timer
        let interval = props.nextMessagePollInterval
        const poll = async () => {
          try {
            const response = await props.readNextMessage(controller.signal)
            if (controller.signal.aborted) return
            if (!response.ok) throw new Error('Suggestion state is unavailable')
            const next = response.value
            if (!next || !Array.isArray(next.choices) || !next.choices.every(item => typeof item === 'string') || !Number.isSafeInteger(next.revision) || typeof next.generating !== 'boolean' || typeof next.pollIntervalMs !== 'number') throw new Error('Invalid suggestion state')
            interval = next.pollIntervalMs
            setView(previous => previous.sessionId === props.sessionId && previous.revision === next.revision ? previous : { ...next, sessionId: props.sessionId })
          } catch (error) {
            // An unavailable state channel has no toast or automatic retry notification.
            if (!controller.signal.aborted) setView(previous => ({ ...previous, revision: -1, choices: [], generating: false, failed: false }))
          } finally {
            if (!controller.signal.aborted) timer = setTimeout(poll, interval)
          }
        }
        void poll()
        return () => { controller.abort(); clearTimeout(timer) }
      }, [props.sessionId, props.readNextMessage, props.nextMessagePollInterval])

      useLayoutEffect(() => {
        if (!visible || !root.current) { setBox(null); return }
        const card = root.current.closest('[data-composer-card]')
        const editor = card?.querySelector('[data-composer-input]')
        if (!editor) return
        const measure = () => {
          const anchor = card.getBoundingClientRect()
          const placeholder = card.querySelector('[data-composer-placeholder]')
          const target = (placeholder ?? editor).getBoundingClientRect()
          const style = getComputedStyle(placeholder ?? editor)
          setBox({ left: target.left - anchor.left, top: target.top - anchor.top, width: target.width, fontSize: style.fontSize, lineHeight: style.lineHeight, fontFamily: style.fontFamily })
        }
        measure()
        const observer = new ResizeObserver(measure)
        observer.observe(card)
        observer.observe(editor)
        return () => observer.disconnect()
      }, [visible, props.sessionId])

      useEffect(() => {
        if (!visible || selected === undefined) return
        const span = props.inputActions.captureInsertion()
        if (span.draftRev !== input.draftRev) return
        return props.observeNextMessageKeys(event => {
          if (event.type !== 'keydown') return
          const { gesture, context } = event
          if (gesture.composing || gesture.defaultPrevented || gesture.control || gesture.alt || gesture.meta || gesture.shift || context.modal !== null || context.region !== 'editable') return
          if (!['Tab', 'ArrowLeft', 'ArrowRight'].includes(gesture.code)) return
          if (props.inputActions.captureInsertion().draftRev !== span.draftRev) return
          const card = root.current?.closest('[data-composer-card]')
          const editor = context.target?.closest('[data-composer-input]')
          if (!editor || !card?.contains(editor) || editor.getAttribute('contenteditable') !== 'true' || editor.hasAttribute('data-composer-composing') || props.nextMessageMenuOpen()) return
          if (gesture.code === 'Tab') {
            if (props.inputActions.insertText(selected, span)) event.consume()
            return
          }
          if (choices.length < 2) return
          setSelection(previous => ({ sessionId: props.sessionId, revision: view.revision, index: ((previous.sessionId === props.sessionId && previous.revision === view.revision ? previous.index : 0) + (gesture.code === 'ArrowLeft' ? choices.length - 1 : 1)) % choices.length }))
          event.consume()
        })
      }, [visible, selected, choices, view.revision, props.sessionId, input?.draftRev, props.inputActions, props.observeNextMessageKeys, props.nextMessageMenuOpen])

      return h('div', { ref: root, 'data-next-message-visible': visible ? '' : undefined }, visible && box && h('div', { className: 'next-message-ghost', style: box, role: 'status', 'data-next-message-ghost': '' },
        h('span', null, generating ? props.t('generating') : selected ?? props.t(view.failureCode === 'output-limit' ? 'outputLimit' : view.failureCode === 'timeout' ? 'timeout' : 'failed')),
        selected !== undefined && h('span', { className: 'next-message-instructions' }, props.t('instructions'))))
    }

    return {
      inject: ['slots', 'uiSession', 'locale', 'shortcuts', 'inputTriggers', 'connection'],
      apply(ctx, config = {}) {
        ctx.effect(() => ctx.locale.register('nextMessage', {
          en: { instructions: 'Next-message suggestion. Tab adds it to your draft. Left and right arrows change direction.', generating: 'Generating suggestions…', failed: 'Could not generate suggestions. Try /suggest again', outputLimit: 'Suggestion output limit reached. Increase the plugin’s maxOutputTokens', timeout: 'Suggestions timed out. Check the model connection or plugin timeout' },
          zh: { instructions: '下一句建议。按 Tab 填入草稿，左右方向键切换方向。', generating: '正在生成建议…', failed: '建议生成失败，请用 /suggest 重试', outputLimit: '建议输出预算不足，请提高插件 maxOutputTokens', timeout: '建议生成超时，请检查模型连接或插件超时设置' },
        }))
        ctx.effect(() => {
          const style = document.createElement('style')
          style.dataset.plugin = 'dsh-next-message'
          style.textContent = css
          document.head.append(style)
          return () => style.remove()
        }, 'next-message: overlay stylesheet')
        ctx.uiSession.provide({
          hooks: ['nextMessageMenu'],
          props: ['readNextMessage', 'observeNextMessageKeys', 'nextMessageMenuOpen', 'nextMessagePollInterval'],
          resolve(binding) {
            // Source materialization must not warm a controller that can notify this binding.
            const menu = () => ctx.inputTriggers.sessionOf(binding.ctx).menu
            return {
              hooks: { nextMessageMenu: { getSnapshot: () => menu().getSnapshot(), subscribe: listener => menu().subscribe(listener) } },
              props: {
                nextMessagePollInterval: config.pollIntervalMs ?? 750,
                readNextMessage: async signal => {
                  const response = await fetch(`api/next-message-suggestions?sessionId=${encodeURIComponent(binding.sessionId)}`, { signal, credentials: 'same-origin' })
                  return response.ok ? { ok: true, value: await response.json() } : { ok: false }
                },
                nextMessageMenuOpen: () => menu().getSnapshot().open,
                observeNextMessageKeys: listener => {
                  const dispose = ctx.effect(() => ctx.shortcuts.observeFixedInput(listener), 'next-message: fixed input')
                  return () => { void dispose() }
                },
              },
            }
          },
        })
        ctx.slots.inject('conversation.input.overlay', () => ctx.slots.register({ name: 'conversation.input.overlay', id: 'dsh-next-message', locale: 'nextMessage' }, Suggestions))
      },
    }
  },
})
