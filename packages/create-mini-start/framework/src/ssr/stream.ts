/**
 * Server half of the streaming hydration protocol.
 *
 *  - `bootstrapScript` is rendered by <Scripts /> inside the HTML shell. It
 *    holds the dehydrated router state; unresolved promises in loader data
 *    are replaced by numeric references.
 *  - When a referenced promise settles, a small self-removing <script> is
 *    queued. `createHtmlInjector` splices queued scripts into React's HTML
 *    stream right after a `</script>` (a position where inserting a script
 *    is always valid), and flushes the rest before `</body></html>`.
 *  - The browser side (`client/index.tsx`) turns references back into
 *    promises that resolve when those scripts run.
 *
 * TanStack Router implements the same idea in router-core/src/ssr
 * (see its STREAMING.md); this version keeps only the essentials.
 */
import { encode, toScriptSafeJson } from './serializer.ts'

const GLOBAL = 'self.__MINI__=self.__MINI__||{s:{},w:{}}'

export class SsrStream {
  readonly bootstrapScript: string
  private nextId = 0
  private pending = new Map<number, Promise<void>>()
  private settled = new Set<number>()
  private ready: string[] = []
  private readonly includeStack: boolean

  constructor(state: unknown, options: { includeStack?: boolean } = {}) {
    this.includeStack = !!options.includeStack
    const encoded = encode(state, this.encodeOptions())
    this.bootstrapScript = `${GLOBAL};self.__MINI__.state=${toScriptSafeJson(encoded)};`
  }

  private encodeOptions() {
    return {
      includeStack: this.includeStack,
      onPromise: (promise: Promise<unknown>) => this.track(promise),
    }
  }

  private track(promise: Promise<unknown>): number {
    const id = this.nextId++
    const task = promise
      .then(
        (value) => this.settle(id, true, value),
        (error) => this.settle(id, false, error),
      )
      .finally(() => this.pending.delete(id))
    this.pending.set(id, task)
    return id
  }

  private settle(id: number, ok: boolean, value: unknown) {
    if (this.settled.has(id)) return
    this.settled.add(id)
    let payload: string
    try {
      payload = toScriptSafeJson(encode(value, this.encodeOptions()))
    } catch (error) {
      ok = false
      payload = toScriptSafeJson(
        encode(error instanceof Error ? error : new Error(String(error)), {
          includeStack: this.includeStack,
        }),
      )
    }
    // Self-contained: works even if it runs before the bootstrap script.
    this.ready.push(
      `<script>(function(m,i,o,v){m.w[i]?m.w[i](o,v):(m.s[i]=[o,v])})(${GLOBAL},${id},${ok},${payload});document.currentScript.remove()</script>`,
    )
  }

  hasReady(): boolean {
    return this.ready.length > 0
  }

  takeReady(): string {
    const html = this.ready.join('')
    this.ready = []
    return html
  }

  /** Wait for every referenced promise (including nested ones), up to a deadline. */
  async waitForPending(timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (this.pending.size > 0) {
      const remaining = deadline - Date.now()
      if (remaining <= 0) break
      let timer: ReturnType<typeof setTimeout> | undefined
      await Promise.race([
        Promise.allSettled([...this.pending.values()]),
        new Promise((resolve) => {
          timer = setTimeout(resolve, remaining)
        }),
      ])
      clearTimeout(timer)
    }
    for (const id of [...this.pending.keys()]) {
      this.settle(id, false, new Error('Deferred data timed out on the server'))
    }
  }
}

const SCRIPT_END = '</script>'
const DOCUMENT_END = '</body></html>'

export function createHtmlInjector(
  ssr: SsrStream,
  timeoutMs = 30_000,
): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let tail = '' // a possible partial "</body></html>" at the end of a chunk
  let heldDocumentEnd = false

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      let text = tail + decoder.decode(chunk, { stream: true })
      tail = ''
      if (text.endsWith(DOCUMENT_END)) {
        text = text.slice(0, -DOCUMENT_END.length)
        heldDocumentEnd = true
      } else {
        for (let n = Math.min(DOCUMENT_END.length - 1, text.length); n > 0; n--) {
          if (DOCUMENT_END.startsWith(text.slice(-n))) {
            tail = text.slice(-n)
            text = text.slice(0, -n)
            break
          }
        }
      }
      if (ssr.hasReady()) {
        const at = text.lastIndexOf(SCRIPT_END)
        if (at !== -1) {
          const cut = at + SCRIPT_END.length
          text = text.slice(0, cut) + ssr.takeReady() + text.slice(cut)
        }
      }
      if (text) controller.enqueue(encoder.encode(text))
    },
    async flush(controller) {
      await ssr.waitForPending(timeoutMs)
      const rest =
        tail +
        decoder.decode() +
        ssr.takeReady() +
        (heldDocumentEnd ? DOCUMENT_END : '')
      if (rest) controller.enqueue(encoder.encode(rest))
    },
  })
}
