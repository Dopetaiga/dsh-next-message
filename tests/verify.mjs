/** Official installed-runtime integration and real Edge acceptance; no workspace Host imports. */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile, stat } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
// Playwright is a test tool only; none of its workspace modules enter the Host process.
import { createRequire } from 'node:module'
if (!process.argv[2] || !process.argv[3]) throw new Error('Usage: node tests/verify.mjs <desktop-install-directory> <dsh-source-checkout>')
const sourceRequire = createRequire(join(resolve(process.argv[3]), 'apps/web/package.json'))
const { chromium } = sourceRequire('playwright')

const project = fileURLToPath(new URL('../', import.meta.url))
const install = resolve(process.argv[2])
const executable = join(install, 'DeepSeek Harness.exe')
const archive = join(install, 'resources', 'app.asar')
const cli = join(archive, 'dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js')
const artifacts = resolve(project, '.artifacts')
await mkdir(artifacts, { recursive: true })
const root = await mkdtemp(join(artifacts, 'next-message-acceptance-'))
const home = join(root, 'home')
const profile = join(home, 'profiles', 'next-message-test')
await mkdir(profile, { recursive: true })
await writeFile(join(profile, 'package.json'), JSON.stringify({ name: 'next-message-test-profile', private: true, dependencies: {}, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } } }))
await writeFile(join(profile, 'cordis.patch.yml'), '[]\n')
const environment = { ...process.env, ELECTRON_RUN_AS_NODE: '1', DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1' }
delete environment.NODE_OPTIONS
delete environment.NODE_PATH
const commands = []
let server
let browser
let page
const errors = []

async function command(label, program, args, env = environment) {
  const child = spawn(program, args, { cwd: project, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  const chunks = []
  child.stdout.on('data', data => chunks.push(data))
  child.stderr.on('data', data => chunks.push(data))
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }) }, 60000)
  const code = await new Promise((accept, reject) => { child.once('error', reject); child.once('close', accept) }).finally(() => clearTimeout(timer))
  await writeFile(join(root, `${label}.log`), Buffer.concat(chunks))
  commands.push({ label, program, args, code, timedOut })
  assert.equal(timedOut, false, `${label} exceeded its deadline`)
  assert.equal(code, 0, `${label} failed; see ${join(root, `${label}.log`)}`)
}
const dsh = (label, args) => command(label, executable, ['--expose-internals', cli, ...args])
const waitFor = async (test, label, timeout = 45000) => {
  const end = Date.now() + timeout
  while (Date.now() < end) { if (errors.length) throw new Error(`Browser error: ${errors[0].slice(0, 500)}`); if (await test()) return; await new Promise(accept => setTimeout(accept, 50)) }
  throw new Error(`Timed out waiting for ${label}; inspect ${root}`)
}

try {
  await dsh('version', ['--version'])
  assert.equal((await readFile(join(root, 'version.log'), 'utf8')).trim(), '0.2.1-rc.5')
  await command('pack', process.execPath, [join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'), 'pack', '--ignore-scripts', '--pack-destination', root], process.env)
  const tarball = join(root, `dsh-next-message-${JSON.parse(await readFile(join(project, 'package.json'), 'utf8')).version}.tgz`)
  await dsh('install', ['plugin', '--profile', 'next-message-test', 'add', tarball])
  const patches = [
    { id: 'webserver', config: { host: '127.0.0.1', port: 0, compression: 'gzip', compressionLevel: 1, compressionThresholdBytes: 1024 } },
    { id: 'web-runtime', config: { openBrowser: false, printUrl: false, surfaceContext: false } },
    { id: 'session-title-llm', disabled: true },
    { id: 'agent-default-model', config: { provider: 'suggestions-fixture', model: 'main' } },
    { id: 'directory-picker', disabled: true },
    { insert: [
      { id: 'directory-picker-browse', name: '@deepseek-ai/dsh-host-directory-picker-browse' },
      { id: 'ui-directory-picker-browse', name: '@deepseek-ai/dsh-client-ui-directory-picker-browse' },
      { id: 'next-message-test-fixture', name: pathToFileURL(join(root, 'fixture.mjs')).href, config: { archive, root } },
    ] },
  ]
  await writeFile(join(root, 'fixture.mjs'), await readFile(join(project, 'tests/fixture.mjs')))
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'next-message-test-only', private: true, type: 'module' }))
  await writeFile(join(profile, 'cordis.patch.yml'), JSON.stringify(patches, null, 2))
  server = spawn(executable, ['--expose-internals', cli, '--profile', 'next-message-test'], { cwd: project, env: environment, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  const serverChunks = []
  server.stdout.on('data', data => serverChunks.push(data))
  server.stderr.on('data', data => serverChunks.push(data))
  server.on('close', () => { void writeFile(join(root, 'server.log'), Buffer.concat(serverChunks)) })
  await waitFor(async () => { if (server.exitCode !== null) throw new Error(`Official Web exited ${server.exitCode}: ${Buffer.concat(serverChunks).toString().slice(-3000)}`); return stat(join(root, 'ready.json')).then(() => true, () => false) }, 'official Web and host checks')
  const ready = JSON.parse(await readFile(join(root, 'ready.json'), 'utf8'))
  browser = await chromium.launch({ channel: 'msedge', headless: true })
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'en-US' })
  page.setDefaultTimeout(5000)
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await page.goto(ready.url)
  await page.screenshot({ path: join(root, 'initial-page.png') })
  await writeFile(join(root, 'initial-page.txt'), await page.locator('body').innerText())
  const preview = page.getByRole('dialog').filter({ hasText: 'Preview Notice' })
  if (await preview.count()) await preview.getByRole('button', { name: 'Continue', exact: true }).click()
  await page.getByRole('button', { name: 'Add workspace', exact: true }).click({ timeout: 20000 })
  const dialog = page.getByRole('dialog', { name: 'Select Workspace Directory' })
  await dialog.getByRole('button', { name: 'Edit path' }).click()
  await dialog.getByRole('textbox', { name: 'Edit path' }).fill(root)
  await dialog.getByRole('textbox', { name: 'Edit path' }).press('Enter')
  await dialog.getByRole('button', { name: 'Open', exact: true }).click()
  await page.getByRole('button', { name: 'Choose workspace', exact: true }).click()
  await page.getByText(basename(root), { exact: true }).last().click()
  const editor = page.locator('[data-composer-input][contenteditable="true"]').first()
  await waitFor(() => editor.isVisible(), 'published composer binding', 20000)
  const controlHold = action => page.evaluate(async action => (await fetch('api/next-message-hold-fixture', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action }) })).json(), action)
  await controlHold('hold')
  await editor.fill('/suggest')
  await editor.press('Enter')
  const ghost = page.locator('[data-next-message-ghost]')
  await waitFor(async () => (await ghost.textContent().catch(() => '')) === 'Generating suggestions…', 'manual generating status')
  await editor.fill('My draft while suggestions are generating')
  assert.equal(await ghost.count(), 0)
  assert.equal(await editor.innerText(), 'My draft while suggestions are generating')
  await editor.fill('')
  await waitFor(async () => (await ghost.textContent().catch(() => '')) === 'Generating suggestions…', 'generating status restored on empty draft')
  await page.screenshot({ path: join(root, 'suggestions-generating.png') })
  await controlHold('release')
  await waitFor(async () => (await ghost.textContent().catch(() => ''))?.startsWith('Continue implementation'), 'three manual directions')
  await editor.press('ArrowRight')
  await editor.press('ArrowRight')
  await waitFor(async () => (await ghost.textContent())?.startsWith('Inspect the evidence'), 'two consecutive right arrows')
  const readCounts = () => page.evaluate(async () => (await fetch('api/next-message-fixture')).json())
  const beforeTab = await readCounts()
  const contrast = []
  for (const theme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: theme })
    if (theme === 'dark') await waitFor(async () => await ghost.evaluate(element => getComputedStyle(element.closest('[data-composer-card]')).backgroundColor) !== contrast[0].background, 'actual dark palette', 5000)
    const reading = await ghost.evaluate(element => {
      const color = getComputedStyle(element).color
      const background = getComputedStyle(element.closest('[data-composer-card]')).backgroundColor
      const luminance = css => {
        const rgb = css.match(/[\d.]+/g).slice(0, 3).map(Number).map(channel => channel / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
        return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722
      }
      const a = luminance(color), b = luminance(background)
      return { color, background, ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) }
    })
    assert.ok(reading.ratio >= 4.5)
    contrast.push({ theme, ...reading })
    await page.screenshot({ path: join(root, `suggestions-${theme}.png`) })
  }
  assert.notEqual(contrast[0].background, contrast[1].background)
  await writeFile(join(root, 'contrast.json'), JSON.stringify(contrast, null, 2))
  await editor.press('Shift+Tab')
  assert.equal(await editor.textContent(), '')
  await editor.focus()
  await editor.press('Control+ArrowLeft')
  assert.ok((await ghost.textContent()).startsWith('Inspect the evidence'))
  await editor.dispatchEvent('compositionstart')
  const duringIme = await editor.evaluate(element => {
    const event = new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', isComposing: true, bubbles: true, cancelable: true })
    element.dispatchEvent(event)
    return { prevented: event.defaultPrevented, text: element.textContent }
  })
  assert.equal(duringIme.prevented, false)
  assert.ok(!duringIme.text.includes('Inspect the evidence'))
  await editor.dispatchEvent('compositionend')
  await waitFor(() => editor.evaluate(element => !element.hasAttribute('data-composer-composing')), 'IME completion')
  await editor.fill('')
  const launcher = page.locator('[data-composer-card] button[aria-haspopup="listbox"]').first()
  await launcher.click()
  await page.getByRole('listbox').waitFor({ timeout: 5000 })
  assert.equal(await ghost.count(), 0)
  page.once('filechooser', chooser => { void chooser.setFiles([]) })
  await editor.press('Tab')
  assert.notEqual(await editor.innerText(), 'Inspect the evidence')
  await editor.press('Escape')
  await editor.fill('')
  await waitFor(async () => await ghost.count() === 1, 'suggestion restored after menu')
  await editor.press('Tab')
  assert.equal(await editor.innerText(), 'Inspect the evidence')
  assert.equal(await ghost.count(), 0)
  const afterTab = await readCounts()
  assert.equal(afterTab.primaryCalls, beforeTab.primaryCalls)
  assert.equal(afterTab.events.filter(event => event.type === 'user/message').length, beforeTab.events.filter(event => event.type === 'user/message').length)
  await editor.fill('My own draft')
  await editor.press('Tab')
  assert.equal(await editor.innerText(), 'My own draft')
  await editor.fill('Finish the example task')
  await editor.press('Enter')
  await waitFor(async () => (await readCounts()).primaryCalls > afterTab.primaryCalls, 'first primary completion')
  await editor.fill('Finish the second example turn')
  await editor.press('Enter')
  await waitFor(async () => (await readCounts()).primaryCalls > afterTab.primaryCalls + 1, 'second primary completion')
  await editor.fill('Finish the third example turn')
  await editor.press('Enter')
  await waitFor(async () => (await ghost.textContent().catch(() => ''))?.startsWith('Continue implementation'), 'one automatic suggestion')
  assert.equal((await readCounts()).modelCatalogHasSetup, true)
  await controlHold('hold')
  await editor.fill('/suggest')
  await editor.press('Enter')
  await waitFor(async () => (await ghost.textContent().catch(() => '')) === 'Generating suggestions…', 'generating status before unload')
  const unload = await page.evaluate(async () => (await fetch('api/next-message-unload-fixture', { method: 'POST' })).json())
  assert.deepEqual(unload, { routeRemoved: true, commandRemoved: true, skillRemoved: true, drained: true })
  await waitFor(async () => await ghost.count() === 0, 'plugin unload')
  assert.equal(await page.locator('style[data-plugin="dsh-next-message"]').count(), 0)
  assert.equal(errors.length, 0, errors.join('\n'))
  await writeFile(join(root, 'browser-evidence.json'), JSON.stringify({ manualGeneratingVisible: true, generatingHiddenDuringTyping: true, generatingClearedOnSuccess: true, generatingClearedOnUnload: true, manualThree: true, consecutiveRight: true, tabDraftOnly: true, tabAddedNoMessagesOrPrimaryCalls: true, shiftTabPassed: true, modifierArrowPassed: true, imePassed: true, menuPriority: true, draftProtected: true, automaticAfterThirdTurn: true, unload, errors }, null, 2))
  await browser.close()
  browser = undefined
  await writeFile(join(root, 'result.json'), JSON.stringify({ passed: true, root, install, commands }, null, 2))
  console.log(`PASS ${root}`)
} catch (error) {
  if (page && !page.isClosed()) {
    await page.screenshot({ path: join(root, 'failure-page.png') })
    await writeFile(join(root, 'failure-page.txt'), `${await page.locator('body').innerText()}\n\nPage errors:\n${errors.join('\n')}`)
  }
  await writeFile(join(root, 'result.json'), JSON.stringify({ passed: false, root, commands, error: String(error) }, null, 2))
  console.error(`FAIL ${root}`)
  throw error
} finally {
  try { await browser?.close() } finally {
    if (server && server.exitCode === null) {
      const stopped = new Promise(accept => server.once('close', accept))
      const killer = spawn('taskkill.exe', ['/PID', String(server.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
      await new Promise(accept => killer.once('close', accept))
      await stopped
    }
  }
}
