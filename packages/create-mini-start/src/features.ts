/**
 * The optional features of a starter: routing, state, data fetching, tests,
 * a theme toggle, and env + error handling. Each one contributes pieces
 * (which the design pattern then places), CSS, and a few fixed files.
 *
 * Dependencies, scripts and config for these add-ons are in templates.ts,
 * next to the other add-ons'.
 */
import { importLines, type Importer, type ModuleSpec, type PatternFile, type Piece } from './pieces.ts'
import type { TemplateContext } from './templates.ts'

export interface FeatureOptions {
  /** The card the visual pieces sit in: the React component, or the custom element. */
  card: 'Card' | 'app-card'
  /** Domain-Driven keeps the counter's rules in its model; the store builds on them. */
  counterModel: boolean
  /** The Web Components counter reports its new count, so its store needs a setter. */
  counterSetter: boolean
  /** Web Components draws the theme toggle as an element; the React hook and component aren't needed. */
  reactThemeToggle: boolean
}

export interface Features {
  pieces: Piece[]
  /** Global rules, used when the project doesn't use CSS Modules. */
  css: string[]
  /** Files with a fixed place in every pattern. */
  files: PatternFile[]
  /** CSS Module specs for the visual pieces, keyed by piece name. */
  moduleSpecs: Record<string, ModuleSpec>
  /** Component-Driven stories, keyed by piece name. */
  stories: Record<string, string>
}

const TIPS_CSS = `.tips {
  display: grid;
  gap: 0.6rem;
  margin: 0.75rem 0 0;
  padding: 0;
  list-style: none;
}

.tips li {
  padding-left: 0.8rem;
  border-left: 3px solid var(--accent-soft);
}`

const THEME_TOGGLE_CSS = `.theme-toggle {
  padding: 0.3rem 0.7rem;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: transparent;
  color: var(--muted);
  font-size: 0.875rem;
  cursor: pointer;
}

.theme-toggle:hover {
  color: var(--text);
}`

const ERROR_SCREEN_CSS = `.error-screen {
  max-width: 40rem;
  margin: 4rem auto;
  padding: 0 1.5rem;
}

.error-screen button {
  margin-top: 0.75rem;
  padding: 0.55rem 1rem;
  border: 0;
  border-radius: 8px;
  background: var(--accent);
  color: var(--on-accent);
  cursor: pointer;
}`

/** Opening tag, closing tag and import line for the card a visual piece sits in. */
function card(options: FeatureOptions, i: Importer) {
  return options.card === 'Card'
    ? { open: '<Card>', close: '</Card>', imports: `${importLines(i, ['Card'])}\n` }
    : { open: '<app-card>', close: '</app-card>', imports: '' }
}

export function planFeatures(ctx: TemplateContext, options: FeatureOptions): Features {
  const features: Features = { pieces: [], css: [], files: [], moduleSpecs: {}, stories: {} }
  const has = (id: Parameters<typeof ctx.addOns.has>[0]) => ctx.addOns.has(id)

  // -------------------------------------------------------------------------
  // Routing (React Router). The pattern writes App.tsx and HomePage; these
  // two pages are the same everywhere.
  if (has('router')) {
    features.pieces.push(
      {
        name: 'AboutPage',
        kind: 'page',
        addOn: 'router',
        source: (i) => {
          const c = card(options, i)
          return `${c.imports}
export function AboutPage() {
  return (
    ${c.open}
      <h1>About</h1>
      <p className="muted">
        A second page, so there is somewhere to go. Routes are listed in <code>src/App.tsx</code>.
      </p>
    ${c.close}
  )
}
`.trimStart()
        },
      },
      {
        name: 'NotFoundPage',
        kind: 'page',
        addOn: 'router',
        source: (i) => {
          const c = card(options, i)
          return `import { Link } from 'react-router'
${c.imports}
export function NotFoundPage() {
  return (
    ${c.open}
      <h1>Page not found</h1>
      <p className="muted">There is no page at this address.</p>
      <Link to="/">Back home</Link>
    ${c.close}
  )
}
`
        },
      },
    )
  }

  // -------------------------------------------------------------------------
  // State management (Zustand)
  if (has('state')) {
    features.pieces.push({
      name: 'counterStore',
      exportName: 'useCounterStore',
      kind: 'store',
      domain: 'counter',
      public: true,
      addOn: 'state',
      source: () =>
        options.counterModel
          ? `import { create } from 'zustand'
import { type CounterState, increment, initialCounter } from './model'

interface CounterStore extends CounterState {
  increment: () => void
}

/** The counter's state, shared by every component that asks for it. The rules stay in model.ts. */
export const useCounterStore = create<CounterStore>()((set) => ({
  ...initialCounter,
  increment: () => set((state) => increment(state)),
}))
`
          : `import { create } from 'zustand'

interface CounterStore {
  count: number
  increment: () => void${options.counterSetter ? '\n  setCount: (count: number) => void' : ''}
}

/** The counter's state, shared by every component that asks for it. */
export const useCounterStore = create<CounterStore>()((set) => ({
  count: 0,
  increment: () => set((state) => ({ count: state.count + 1 })),${
    options.counterSetter ? '\n  setCount: (count) => set({ count }),' : ''
  }
}))
`,
    })
  }

  // -------------------------------------------------------------------------
  // Data fetching (TanStack Query)
  if (has('query')) {
    const withEnv = has('env-errors')
    features.pieces.push(
      {
        name: 'api',
        kind: 'lib',
        addOn: 'query',
        source: (i) => `${
          withEnv
            ? `import { env } from '${i('env')}'

const API_URL = env.apiUrl`
            : `/** Where the API lives. The starter's "API" is the JSON in public/api. */
const API_URL = \`\${import.meta.env.BASE_URL}api\``
        }

/** GET a JSON document, typed by the caller. Fails on any non-2xx answer. */
export async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(\`\${API_URL}\${path}\`)
  if (!response.ok) throw new Error(\`Request failed: \${response.status} \${response.statusText}\`)
  return (await response.json()) as T
}
`,
      },
      {
        name: 'useTips',
        kind: 'hook',
        domain: 'tips',
        addOn: 'query',
        source: (i) => `import { useQuery } from '@tanstack/react-query'
import { getJson } from '${i('api')}'

export interface Tip {
  id: number
  text: string
}

/** Loads the tips once and caches them. Components get data, loading and error state. */
export function useTips() {
  return useQuery({
    queryKey: ['tips'],
    queryFn: () => getJson<Tip[]>('/tips.json'),
  })
}
`,
      },
      {
        name: 'TipList',
        kind: 'molecule',
        domain: 'tips',
        addOn: 'query',
        source: (i) => `import type { Tip } from '${i('useTips')}'

export function TipList({ tips }: { tips: Tip[] }) {
  return (
    <ul className="tips">
      {tips.map((tip) => (
        <li key={tip.id}>{tip.text}</li>
      ))}
    </ul>
  )
}
`,
      },
      {
        name: 'TipsCard',
        kind: 'organism',
        smart: true,
        domain: 'tips',
        public: true,
        addOn: 'query',
        source: (i) => {
          const c = card(options, i)
          return `${c.imports}${importLines(i, ['TipList'])}
import { useTips } from '${i('useTips')}'

/** Asks for the tips and shows whichever state the request is in. */
export function TipsCard() {
  const { data, error, isPending } = useTips()
  return (
    ${c.open}
      <h2>Loaded with a query</h2>
      {isPending && <p className="muted">Loading…</p>}
      {error && <p className="muted">Could not load the tips: {error.message}</p>}
      {data && <TipList tips={data} />}
    ${c.close}
  )
}
`
        },
      },
    )
    features.files.push({
      path: 'public/api/tips.json',
      addOn: 'query',
      content: `${JSON.stringify(
        [
          { id: 1, text: 'This list was fetched from public/api/tips.json and cached by TanStack Query.' },
          { id: 2, text: 'Point the API URL at your backend, and keep hooks like useTips as the only place that knows the address.' },
          { id: 3, text: 'A query gives you loading and error state, so components only decide what to show.' },
        ],
        null,
        2,
      )}\n`,
    })
    features.css.push(TIPS_CSS)
    features.moduleSpecs.TipList = { css: TIPS_CSS, classes: { tips: 'tips' } }
    features.stories.TipList = `export const Default = () => (
  <TipList
    tips={[
      { id: 1, text: 'First tip' },
      { id: 2, text: 'Second tip' },
    ]}
  />
)`
    features.stories.TipsCard = `export const Default = () => <TipsCard />`
  }

  // -------------------------------------------------------------------------
  // Theme toggle
  if (has('theme') && options.reactThemeToggle) {
    features.pieces.push({
      name: 'useTheme',
      kind: 'hook',
      addOn: 'theme',
      source: () => `import { useEffect, useState } from 'react'

export type Theme = 'system' | 'light' | 'dark'

const STORAGE_KEY = 'theme'

function storedTheme(): Theme {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return value === 'light' || value === 'dark' ? value : 'system'
  } catch {
    return 'system'
  }
}

/**
 * The chosen theme, remembered across visits. "system" follows the device.
 * The choice is written to <html data-theme>, which src/styles.css reads.
 */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(storedTheme)

  useEffect(() => {
    const root = document.documentElement
    try {
      if (theme === 'system') {
        delete root.dataset.theme
        localStorage.removeItem(STORAGE_KEY)
      } else {
        root.dataset.theme = theme
        localStorage.setItem(STORAGE_KEY, theme)
      }
    } catch {
      // Storage can be blocked; the theme still applies for this visit.
    }
  }, [theme])

  return [theme, setTheme] as const
}
`,
    })
    {
      features.pieces.push({
        name: 'ThemeToggle',
        kind: 'molecule',
        smart: true,
        addOn: 'theme',
        source: (i) => `import { type Theme, useTheme } from '${i('useTheme')}'

const NEXT: Record<Theme, Theme> = { system: 'light', light: 'dark', dark: 'system' }
const LABEL: Record<Theme, string> = { system: 'System', light: 'Light', dark: 'Dark' }

/** Cycles system → light → dark. */
export function ThemeToggle() {
  const [theme, setTheme] = useTheme()
  return (
    <button type="button" className="theme-toggle" onClick={() => setTheme(NEXT[theme])}>
      Theme: {LABEL[theme]}
    </button>
  )
}
`,
      })
      features.css.push(THEME_TOGGLE_CSS)
      features.moduleSpecs.ThemeToggle = { css: THEME_TOGGLE_CSS, classes: { 'theme-toggle': 'toggle' } }
      features.stories.ThemeToggle = `export const Default = () => <ThemeToggle />`
    }
  }

  // -------------------------------------------------------------------------
  // Env + error handling
  if (has('env-errors')) {
    features.pieces.push(
      {
        name: 'env',
        kind: 'lib',
        addOn: 'env-errors',
        source: () => `/**
 * Every environment variable the app reads, in one typed place. Components
 * import \`env\`, never \`import.meta.env\`, so a missing or misspelled variable
 * shows up here.
 *
 * Variables come from .env files (see .env.example) and must start with
 * VITE_ to reach the browser. Never put secrets in them: they end up in the
 * built JavaScript.
 */
export const env = {
  appName: import.meta.env.VITE_APP_NAME ?? '${ctx.name}',
  /** Base URL of the API, without a trailing slash. */
  apiUrl: (import.meta.env.VITE_API_URL ?? \`\${import.meta.env.BASE_URL}api\`).replace(/\\/$/, ''),
}
`,
      },
      {
        name: 'ErrorFallback',
        kind: 'organism',
        addOn: 'env-errors',
        source: () => `/** What people see when the app crashes, instead of a blank page. */
export function ErrorFallback({ error, onRetry }: { error: Error; onRetry: () => void }) {
  return (
    <main className="error-screen" role="alert">
      <h1>Something went wrong</h1>
      <p className="muted">{error.message}</p>
      <button type="button" onClick={onRetry}>
        Try again
      </button>
    </main>
  )
}
`,
      },
      {
        name: 'ErrorBoundary',
        kind: 'provider',
        smart: true,
        addOn: 'env-errors',
        source: (i) => `import { Component, type ErrorInfo, type ReactNode } from 'react'
${importLines(i, ['ErrorFallback'])}

interface State {
  error: Error | null
}

/**
 * Catches errors thrown while rendering anything inside it, and shows the
 * fallback. src/main.tsx wraps the whole app in one; wrap smaller parts in
 * their own to keep the rest of the page alive.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    // Send this to your error tracker.
    console.error(error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (error) return <ErrorFallback error={error} onRetry={() => this.setState({ error: null })} />
    return this.props.children
  }
}
`,
      },
    )
    features.files.push(
      {
        path: '.env.example',
        addOn: 'env-errors',
        content: `# Copy this file to .env.local and change the values. .env.local is not committed.
# Only variables that start with VITE_ reach the browser, and they are public:
# never put a secret here.

VITE_APP_NAME=${ctx.name}

# Base URL of your API. Without it, the app uses /api on its own address.
# VITE_API_URL=https://api.example.com
`,
      },
      {
        path: 'src/vite-env.d.ts',
        addOn: 'env-errors',
        content: `/// <reference types="vite/client" />

// The environment variables this app knows about. Read them through src/**/env.ts.
interface ImportMetaEnv {
  readonly VITE_APP_NAME?: string
  readonly VITE_API_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
`,
      },
    )
    features.css.push(ERROR_SCREEN_CSS)
    features.moduleSpecs.ErrorFallback = { css: ERROR_SCREEN_CSS, classes: { 'error-screen': 'screen' } }
    features.stories.ErrorFallback = `export const Default = () => <ErrorFallback error={new Error('The example error message')} onRetry={() => {}} />`
  }

  return features
}
