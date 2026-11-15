// End-to-end check of the demo in a real browser, using only the Chrome DevTools
// Protocol (no Playwright/Puppeteer). Requires Node 22+ (global WebSocket) and Chrome.
//
//   pnpm demo   (or: pnpm demo:build && pnpm demo:start, then pass http://localhost:3000)
//   CHROME_PATH=/path/to/chrome node apps/demo/e2e/browser-test.mjs http://localhost:5180
//
// On WSL without Linux Chrome libraries, run it with Windows Node so it launches
// Windows Chrome (WSL forwards localhost):
//   "/mnt/c/Program Files/nodejs/node.exe" apps/demo/e2e/browser-test.mjs http://localhost:5180
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'


const BASE = process.argv[2] ?? 'http://localhost:5180'
const CHROME =
  process.env.CHROME_PATH ??
  [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].find((p) => existsSync(p))
if (!CHROME) {
  console.error('Chrome not found. Set CHROME_PATH.')
  process.exit(2)
}
const PORT = Number(process.env.CDP_PORT ?? 9333)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const profile = mkdtempSync(join(tmpdir(), 'mini-start-cdp-'))
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions', 'about:blank',
], { stdio: 'ignore' })

let targets
for (let i = 0; i < 50; i++) {
  try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); if (targets.some((t) => t.type === 'page')) break } catch {}
  await sleep(200)
}
const page = targets.find((t) => t.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r, { once: true }))

let nextId = 0
const pending = new Map()
const consoleMessages = []
const requests = []
const listeners = new Set()
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data)
  if (msg.id !== undefined) { pending.get(msg.id)?.(msg); pending.delete(msg.id); return }
  for (const l of listeners) l(msg)
  if (msg.method === 'Runtime.consoleAPICalled') {
    const text = msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ')
    consoleMessages.push({ type: msg.params.type, text })
  } else if (msg.method === 'Runtime.exceptionThrown') {
    const d = msg.params.exceptionDetails
    consoleMessages.push({ type: 'exception', text: d.exception?.description ?? d.text })
  } else if (msg.method === 'Log.entryAdded' && ['error', 'warning'].includes(msg.params.entry.level)) {
    consoleMessages.push({ type: `log-${msg.params.entry.level}`, text: `${msg.params.entry.text} ${msg.params.entry.url ?? ''}` })
  } else if (msg.method === 'Network.requestWillBeSent') {
    requests.push({ url: msg.params.request.url, method: msg.params.request.method, type: msg.params.type, t: Date.now() })
  }
})
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId
  pending.set(id, (msg) => (msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result)))
  ws.send(JSON.stringify({ id, method, params }))
})
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error(`evaluate failed: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`)
  return r.result.value
}
const waitFor = async (expression, timeout = 6000) => {
  const end = Date.now() + timeout
  while (Date.now() < end) { try { if (await evaluate(expression)) return true } catch {} await sleep(100) }
  return false
}
const navigate = async (url) => {
  const loaded = new Promise((resolve) => { const l = (m) => { if (m.method === 'Page.loadEventFired') { listeners.delete(l); resolve() } }; listeners.add(l) })
  await send('Page.navigate', { url })
  await loaded
}
const HYDRATED = `(() => { const h = document.querySelector('header'); return !!h && Object.keys(h).some((k) => k.startsWith('__reactFiber')) })()`

const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`) }

await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable'); await send('Network.enable')

try {
  // 1. Hydration of the home page
  await navigate(`${BASE}/`)
  check('home page hydrates', await waitFor(HYDRATED, 10000))
  check('server-function data rendered by SSR', await evaluate(`document.body.innerText.includes('Node.js')`))

  // 2. Client-side navigation (no full reload)
  await evaluate('window.__marker = "same-document"')
  await evaluate(`document.querySelector('header a[href="/posts"]').click()`)
  check('click /posts navigates client-side', await waitFor(`location.pathname === '/posts' && document.body.innerText.includes('Pick a post')`))
  check('no full page reload', (await evaluate('window.__marker')) === 'same-document')
  check('document.title updated by head()', (await evaluate('document.title')) === 'Posts · mini-start')
  check('active link styling', await evaluate(`document.querySelector('header a[href="/posts"]').classList.contains('active')`))

  // 3. Intent preloading: hovering fires the server-function request before the click
  const before = requests.length
  await evaluate(`document.querySelector('a[href="/posts/streaming"]').dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))`)
  await sleep(600)
  const preloadRequests = requests.slice(before).filter((r) => r.url.includes('/_serverFn/'))
  check('hover preloads post data via server function', preloadRequests.length > 0, `${preloadRequests.length} RPC request(s) on hover`)
  const beforeClick = requests.length
  await evaluate(`document.querySelector('a[href="/posts/streaming"]').click()`)
  check('preloaded post renders', await waitFor(`document.querySelector('article h1')?.textContent === 'Streaming SSR'`))
  check('click used preloaded data (no new RPC)', requests.slice(beforeClick).filter((r) => r.url.includes('/_serverFn/')).length === 0)
  check('Date and Set survive the RPC round trip', await evaluate(`document.body.innerText.includes('Published') && document.querySelectorAll('.tag').length === 2`))

  // 4. Not found + error boundaries during client navigation
  await evaluate(`document.querySelector('a[href="/posts/missing"]').click()`)
  check('client notFound() renders route notFoundComponent', await waitFor(`document.body.innerText.includes('Post not found')`))
  check('layout stays mounted on notFound', await evaluate(`document.body.innerText.includes('A broken post')`))
  await evaluate(`document.querySelector('a[href="/posts/broken"]').click()`)
  check('client loader error renders errorComponent', await waitFor(`document.body.innerText.includes('Could not load this post')`))

  // 5. Back/forward
  await evaluate('history.back()')
  check('history.back() restores previous route', await waitFor(`location.pathname === '/posts/missing' && document.body.innerText.includes('Post not found')`))
  await evaluate('history.back()')
  check('history.back() again', await waitFor(`location.pathname === '/posts/streaming' && document.querySelector('article h1')?.textContent === 'Streaming SSR'`))

  // 6. Mutations with POST server functions + validation + invalidate()
  await evaluate(`document.querySelector('header a[href="/todos"]').click()`)
  await waitFor(`location.pathname === '/todos' && document.querySelector('form')`)
  const setInput = (value) => `(() => { const i = document.querySelector('form input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, ${JSON.stringify(value)}); i.dispatchEvent(new Event('input', { bubbles: true })) })()`
  await evaluate(setInput('   '))
  await evaluate(`document.querySelector('form button').click()`)
  check('server-side validation error is shown', await waitFor(`document.querySelector('.error-text')?.textContent === 'A todo needs a title.'`))
  await evaluate(setInput('Written by the browser test'))
  await evaluate(`document.querySelector('form button').click()`)
  check('POST server function adds a todo and loader re-runs', await waitFor(`[...document.querySelectorAll('.todo-list li')].some((li) => li.innerText.includes('Written by the browser test'))`))
  await evaluate(`[...document.querySelectorAll('.todo-list li')].find((li) => li.innerText.includes('Written by the browser test')).querySelector('input[type=checkbox]').click()`)
  check('toggle via server function', await waitFor(`[...document.querySelectorAll('.todo-list li.done')].some((li) => li.innerText.includes('Written by the browser test'))`))

  // 7. Typed search params drive the URL
  await evaluate(`document.querySelector('header a[href^="/search"]').click()`)
  await waitFor(`location.pathname === '/search'`)
  await evaluate(`(() => { const i = document.querySelector('input[aria-label=Search]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, 'start'); i.dispatchEvent(new Event('input', { bubbles: true })) })()`)
  check('search input updates the query string', await waitFor(`location.search.includes('q=start') && document.body.innerText.includes('TanStack Start')`))

  // 8. Client-side redirect from beforeLoad
  await evaluate(`document.querySelector('a.brand').click()`)
  await waitFor(`location.pathname === '/' && document.querySelector('a[href="/old-posts"]')`)
  await evaluate(`document.querySelector('a[href="/old-posts"]').click()`)
  check('beforeLoad redirect on client navigation', await waitFor(`location.pathname === '/posts' && document.body.innerText.includes('Pick a post')`))

  // 9. Streaming SSR: hydrate while the response is still streaming
  await send('Page.navigate', { url: `${BASE}/deferred` })
  const hydratedEarly = await waitFor(HYDRATED, 2000)
  const stillPending = await evaluate(`document.querySelectorAll('.stream-box.pending').length`)
  check('page hydrates before deferred data finished streaming', hydratedEarly && stillPending > 0, `${stillPending} box(es) still pending at hydration`)
  check('both deferred values stream in', await waitFor(`document.querySelectorAll('.stream-box.done').length === 2`, 8000))
  check('streamed data scripts removed themselves', await evaluate(`![...document.scripts].some((s) => s.textContent.includes('m.w[i]'))`))

  // 10. Client navigation to a deferred route
  await evaluate(`document.querySelector('a.brand').click()`)
  await waitFor(`location.pathname === '/' && document.querySelector('a[href="/old-posts"]')`)
  await evaluate(`document.querySelector('header a[href="/deferred"]').click()`)
  check('client nav to deferred route shows fallbacks first', await waitFor(`location.pathname === '/deferred' && document.querySelectorAll('.stream-box.pending').length > 0`, 3000))
  check('client-side deferred values resolve', await waitFor(`document.querySelectorAll('.stream-box.done').length === 2`, 8000))
} catch (error) {
  check('test script error', false, error.message)
}

// The broken-post and empty-todo checks fail on purpose; the browser logs those responses.
const expected = (m) => m.type === 'log-error' && /Failed to load resource/.test(m.text) && /\/_serverFn\//.test(m.text)
const problems = consoleMessages.filter((m) => ['error', 'exception', 'log-error', 'warning', 'assert'].includes(m.type) && !expected(m))
const expectedFailures = consoleMessages.filter(expected).map((m) => m.text.match(/status of (\d+)/)?.[1]).join(', ')
console.log(`(expected failing RPC responses: ${expectedFailures})`)
check('no console errors or warnings', problems.length === 0, problems.map((p) => `${p.type}: ${p.text.slice(0, 200)}`).join(' | '))

ws.close()
chrome.kill()
await sleep(500)
try { rmSync(profile, { recursive: true, force: true }) } catch {}
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} checks passed`)
process.exit(failed ? 1 : 0)
