/**
 * The starter's components, organized by the design pattern the user picked.
 * Every pattern renders the same page (a welcome, a counter and next steps);
 * what differs is where each piece lives and what it may import.
 *
 * The four React patterns share one set of component sources. A pattern is
 * mostly a layout: a map from component name to file path. The Web
 * Components pattern has its own sources, because its UI is Lit elements.
 */
import path from 'node:path'
import type { PatternId } from './options.ts'
import { runCommand, type TemplateContext } from './templates.ts'

export interface PatternFile {
  /** Path relative to the project folder. */
  path: string
  content: string
}

export interface PatternOutput {
  /** Must include src/App.tsx. */
  files: PatternFile[]
  /** Extra rules for src/styles.css. */
  css?: string
  /** Extra runtime dependencies (keys of VERSIONS). */
  dependencies?: string[]
  /** Extra import lines for src/main.tsx. */
  mainImports?: string[]
  /** Markdown for the project README: how the code is organized. */
  guide: string
}

export function planPattern(ctx: TemplateContext): PatternOutput {
  const builders: Record<PatternId, (ctx: TemplateContext) => PatternOutput> = {
    atomic,
    'component-driven': componentDriven,
    'smart-dumb': smartDumb,
    'domain-driven': domainDriven,
    'web-components': webComponents,
  }
  return builders[ctx.pattern](ctx)
}

// ---------------------------------------------------------------------------
// Shared React component sources

type ComponentName = 'Button' | 'Card' | 'Counter' | 'CounterCard' | 'Hero' | 'NextSteps' | 'SiteHeader' | 'PageLayout'

/** Where a component's file is (relative to src/, no extension) and, if different, where others import it from. */
type Layout = Record<ComponentName, { file: string; from?: string }>

/** Returns the import specifier for `name`, as written in `fromFile`. */
type Importer = (name: ComponentName) => string

function importerFor(layout: Layout, fromFile: string): Importer {
  return (name) => relativeImport(fromFile, layout[name].from ?? layout[name].file)
}

function relativeImport(fromFile: string, target: string): string {
  const rel = path.posix.relative(path.posix.dirname(fromFile), target)
  return rel.startsWith('.') ? rel : `./${rel}`
}

/** One import line per module, merging names that come from the same place. */
function importLines(i: Importer, names: ComponentName[]): string {
  const byModule = new Map<string, ComponentName[]>()
  for (const name of names) byModule.set(i(name), [...(byModule.get(i(name)) ?? []), name])
  return [...byModule].map(([from, list]) => `import { ${list.join(', ')} } from '${from}'`).join('\n')
}

/** What the "Next steps" card says about this project. */
interface Hints {
  /** The file to edit to change the page. */
  homeFile: string
  /** Where a new component goes in this pattern (JSX). */
  addComponent: string
}

type Source = (ctx: TemplateContext, i: Importer, hints: Hints) => string

const SOURCES: Record<ComponentName, Source> = {
  Button: () => `import type { ReactNode } from 'react'

export function Button({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return (
    <button type="button" className="button" onClick={onClick}>
      {children}
    </button>
  )
}
`,

  Card: () => `import type { ReactNode } from 'react'

/** A bordered surface that groups related content. */
export function Card({ children }: { children: ReactNode }) {
  return <section className="card">{children}</section>
}
`,

  Counter: (_ctx, i) => `${importLines(i, ['Button'])}

/** Shows a count and asks for one more. It holds no state: the parent owns the number. */
export function Counter({ count, onIncrement }: { count: number; onIncrement: () => void }) {
  return (
    <div className="counter">
      <Button onClick={onIncrement}>Add one</Button>
      <span>
        Clicked {count} {count === 1 ? 'time' : 'times'}
      </span>
    </div>
  )
}
`,

  CounterCard: (_ctx, i) => `import { useState } from 'react'
${importLines(i, ['Card', 'Counter'])}

/** Owns the count and hands it to <Counter>, which only displays it. */
export function CounterCard() {
  const [count, setCount] = useState(0)
  return (
    <Card>
      <h2>Try it</h2>
      <p className="muted">State lives here; the button and the label below are plain components.</p>
      <Counter count={count} onIncrement={() => setCount(count + 1)} />
    </Card>
  )
}
`,

  Hero: (_ctx, _i, hints) => `export function Hero({ name }: { name: string }) {
  return (
    <section className="hero">
      <h1>Welcome to {name}</h1>
      <p>
        Your app is running. Edit <code>${hints.homeFile}</code> and save to see this page
        update.
      </p>
    </section>
  )
}
`,

  NextSteps: (ctx, i, hints) => `${importLines(i, ['Card'])}

export function NextSteps() {
  return (
    <Card>
${nextStepsBody(ctx, hints, '      ')}
    </Card>
  )
}
`,

  SiteHeader: () => `import type { ReactNode } from 'react'

/** The bar at the top of every page. Pass links as children. */
export function SiteHeader({ name, children }: { name: string; children?: ReactNode }) {
  return (
    <header className="site-header">
      <a href="/" className="brand">
        {name}
      </a>
      {children && <nav>{children}</nav>}
    </header>
  )
}
`,

  PageLayout: (_ctx, i) => `import type { ReactNode } from 'react'
${importLines(i, ['SiteHeader'])}

/** The frame every page shares: the site header and the content column. */
export function PageLayout({ name, nav, children }: { name: string; nav?: ReactNode; children: ReactNode }) {
  return (
    <>
      <SiteHeader name={name}>{nav}</SiteHeader>
      <main className="container">{children}</main>
    </>
  )
}
`,
}

/** The "Next steps" heading and list, shared by the React and Web Components starters. */
function nextStepsBody(ctx: TemplateContext, hints: Hints, indent: string): string {
  const styling = ctx.addOns.has('tailwind')
    ? `Style it: add Tailwind classes such as <code>className="p-8 text-lg"</code>. Colors are in{' '}
    <code>src/styles.css</code>.`
    : `Style it: colors and the starter styles are in <code>src/styles.css</code>.`
  return `<h2>Next steps</h2>
<ul className="steps">
  <li>
    Change this page: edit <code>${hints.homeFile}</code>.
  </li>
  <li>
    ${hints.addComponent}
  </li>
  <li>
    ${styling}
  </li>
  <li>
    Ship it: <code>${runCommand(ctx.packageManager, 'build')}</code> writes the site to{' '}
    <code>dist</code>.
  </li>
</ul>`
    .split('\n')
    .map((line) => indent + line)
    .join('\n')
}

function componentFiles(ctx: TemplateContext, layout: Layout, hints: Hints): PatternFile[] {
  return (Object.keys(layout) as ComponentName[]).map((name) => ({
    path: `src/${layout[name].file}.tsx`,
    content: SOURCES[name](ctx, importerFor(layout, layout[name].file), hints),
  }))
}

/** src/App.tsx for the patterns whose App is just the page. */
function appTsx(ctx: TemplateContext, layout: Layout): string {
  return `${importLines(importerFor(layout, 'App'), ['CounterCard', 'Hero', 'NextSteps', 'PageLayout'])}

export function App() {
  return (
    <PageLayout name="${ctx.name}">
      <Hero name="${ctx.name}" />
      <CounterCard />
      <NextSteps />
    </PageLayout>
  )
}
`
}

// ---------------------------------------------------------------------------
// 1. Atomic Design

function atomic(ctx: TemplateContext): PatternOutput {
  const layout: Layout = {
    Button: { file: 'components/atoms/Button' },
    Card: { file: 'components/atoms/Card' },
    Counter: { file: 'components/molecules/Counter' },
    CounterCard: { file: 'components/organisms/CounterCard' },
    Hero: { file: 'components/organisms/Hero' },
    NextSteps: { file: 'components/organisms/NextSteps' },
    SiteHeader: { file: 'components/organisms/SiteHeader' },
    PageLayout: { file: 'components/templates/PageLayout' },
  }
  const hints: Hints = {
    homeFile: 'src/components/pages/HomePage.tsx',
    addComponent:
      'Add a component: put it in <code>atoms</code>, <code>molecules</code> or <code>organisms</code>, by how much it is made of.',
  }
  const page = 'components/pages/HomePage'
  return {
    files: [
      ...componentFiles(ctx, layout, hints),
      {
        path: `src/${page}.tsx`,
        content: `${importLines(importerFor(layout, page), ['CounterCard', 'Hero', 'NextSteps', 'PageLayout'])}

/** A page: a template filled with real content. */
export function HomePage() {
  return (
    <PageLayout name="${ctx.name}">
      <Hero name="${ctx.name}" />
      <CounterCard />
      <NextSteps />
    </PageLayout>
  )
}
`,
      },
      {
        path: 'src/App.tsx',
        content: `import { HomePage } from './components/pages/HomePage'

export function App() {
  return <HomePage />
}
`,
      },
    ],
    guide: `## Structure: Atomic Design

Components are sorted by how much they are made of. Each level only imports
from the levels above it in this list.

- \`src/components/atoms\`: the smallest pieces, with no other components inside (\`Button\`, \`Card\`)
- \`src/components/molecules\`: a few atoms working together (\`Counter\`)
- \`src/components/organisms\`: complete sections of a page (\`SiteHeader\`, \`Hero\`, \`CounterCard\`, \`NextSteps\`)
- \`src/components/templates\`: page frames without real content (\`PageLayout\`)
- \`src/components/pages\`: templates filled with real content (\`HomePage\`)`,
  }
}

// ---------------------------------------------------------------------------
// 2. Component-Driven Development

const STORIES: Partial<Record<ComponentName, string>> = {
  Button: `export const Default = () => <Button>Click me</Button>`,
  Card: `export const Default = () => (
  <Card>
    <h2>A card</h2>
    <p className="muted">Cards group related content.</p>
  </Card>
)`,
  Counter: `export const Zero = () => <Counter count={0} onIncrement={() => {}} />

export const One = () => <Counter count={1} onIncrement={() => {}} />

export const Many = () => <Counter count={42} onIncrement={() => {}} />`,
  CounterCard: `export const Default = () => <CounterCard />`,
  Hero: `export const Default = () => <Hero name="my-app" />`,
  NextSteps: `export const Default = () => <NextSteps />`,
  SiteHeader: `export const Default = () => <SiteHeader name="my-app" />

export const WithLinks = () => (
  <SiteHeader name="my-app">
    <a href="#" className="active">
      Home
    </a>
    <a href="#">About</a>
  </SiteHeader>
)`,
}

const STORIES_CSS = `.story-group {
  display: grid;
  gap: 0.75rem;
}

.story {
  display: grid;
  gap: 0.5rem;
  padding: 1rem;
  border: 1px dashed var(--border);
  border-radius: 12px;
}

.story-name {
  color: var(--muted);
  font-size: 0.8rem;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}`

function componentDriven(ctx: TemplateContext): PatternOutput {
  const names = Object.keys(SOURCES) as ComponentName[]
  const layout = Object.fromEntries(
    names.map((name) => [name, { file: `components/${name}/${name}`, from: `components/${name}` }]),
  ) as Layout
  const hints: Hints = {
    homeFile: 'src/App.tsx',
    addComponent:
      'Add a component: give it a folder in <code>src/components</code> with a <code>.stories.tsx</code> file, and it shows up on the Components page.',
  }

  const files = componentFiles(ctx, layout, hints)
  for (const name of names) {
    files.push({ path: `src/components/${name}/index.ts`, content: `export { ${name} } from './${name}'\n` })
    const story = STORIES[name]
    if (story) {
      files.push({
        path: `src/components/${name}/${name}.stories.tsx`,
        content: `import { ${name} } from './${name}'

export default { title: '${name}' }

${story}
`,
      })
    }
  }
  files.push(
    {
      path: 'src/App.tsx',
      content: `import { useSyncExternalStore } from 'react'
${importLines(importerFor(layout, 'App'), ['CounterCard', 'Hero', 'NextSteps', 'PageLayout'])}
import { ComponentGallery } from './preview/ComponentGallery'

// The address after the # picks the page: "#/components" is the gallery.
function subscribe(onChange: () => void) {
  window.addEventListener('hashchange', onChange)
  return () => window.removeEventListener('hashchange', onChange)
}

export function App() {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash)
  const showGallery = hash === '#/components'
  return (
    <PageLayout
      name="${ctx.name}"
      nav={
        <>
          <a href="#/" className={showGallery ? undefined : 'active'}>
            Home
          </a>
          <a href="#/components" className={showGallery ? 'active' : undefined}>
            Components
          </a>
        </>
      }
    >
      {showGallery ? (
        <ComponentGallery />
      ) : (
        <>
          <Hero name="${ctx.name}" />
          <CounterCard />
          <NextSteps />
        </>
      )}
    </PageLayout>
  )
}
`,
    },
    {
      path: 'src/preview/ComponentGallery.tsx',
      content: `import type { ComponentType } from 'react'

interface StoryModule {
  default: { title: string }
  [story: string]: ComponentType | { title: string }
}

// Every *.stories.tsx file next to a component shows up here automatically.
const modules = import.meta.glob<StoryModule>('../components/**/*.stories.tsx', { eager: true })

const groups = Object.values(modules)
  .map((mod) => ({
    title: mod.default.title,
    stories: Object.entries(mod).filter(([name]) => name !== 'default') as Array<[string, ComponentType]>,
  }))
  .sort((a, b) => a.title.localeCompare(b.title))

/** Renders every story on its own, outside the page that normally uses the component. */
export function ComponentGallery() {
  return (
    <>
      <section>
        <h1>Components</h1>
        <p className="muted">
          Each component is built and previewed in isolation. Add a story by exporting a
          component from a <code>*.stories.tsx</code> file.
        </p>
      </section>
      {groups.map((group) => (
        <section key={group.title} className="story-group">
          <h2>{group.title}</h2>
          {group.stories.map(([name, Story]) => (
            <div key={name} className="story">
              <span className="story-name">{name}</span>
              <Story />
            </div>
          ))}
        </section>
      ))}
    </>
  )
}
`,
    },
  )
  return {
    files,
    css: STORIES_CSS,
    guide: `## Structure: Component-Driven Development

The UI is built from the bottom up, one component at a time, and each
component can be seen on its own before a page uses it.

- \`src/components/<Name>/<Name>.tsx\`: the component
- \`src/components/<Name>/<Name>.stories.tsx\`: its stories, one export per state worth looking at
- \`src/components/<Name>/index.ts\`: what the rest of the app imports
- \`src/preview/ComponentGallery.tsx\`: the Components page (\`#/components\`), which finds every story file and previews it

The stories use the same format as Storybook (a default export with a
\`title\`, then one named export per story), so you can add Storybook later
without rewriting them.`,
  }
}

// ---------------------------------------------------------------------------
// 3. Smart-Dumb Components

function smartDumb(ctx: TemplateContext): PatternOutput {
  const layout: Layout = {
    Button: { file: 'components/Button' },
    Card: { file: 'components/Card' },
    Counter: { file: 'components/Counter' },
    Hero: { file: 'components/Hero' },
    NextSteps: { file: 'components/NextSteps' },
    SiteHeader: { file: 'components/SiteHeader' },
    PageLayout: { file: 'components/PageLayout' },
    CounterCard: { file: 'containers/CounterCard' },
  }
  const hints: Hints = {
    homeFile: 'src/App.tsx',
    addComponent:
      'Add a component: if it only takes props, it goes in <code>src/components</code>; if it owns state or loads data, in <code>src/containers</code>.',
  }
  return {
    files: [...componentFiles(ctx, layout, hints), { path: 'src/App.tsx', content: appTsx(ctx, layout) }],
    guide: `## Structure: Smart-Dumb Components

Logic and presentation live in different folders.

- \`src/components\`: dumb (presentational) components. They get everything through props, hold no
  state, and never import from \`containers\` (\`Counter\`, \`Button\`, \`Card\`, ...).
- \`src/containers\`: smart components. They own state, data loading and other logic, and render
  dumb components with the result (\`CounterCard\`).`,
  }
}

// ---------------------------------------------------------------------------
// 4. Domain-Driven Frontend

function domainDriven(ctx: TemplateContext): PatternOutput {
  const layout: Layout = {
    Button: { file: 'shared/ui/Button' },
    Card: { file: 'shared/ui/Card' },
    SiteHeader: { file: 'shared/ui/SiteHeader' },
    PageLayout: { file: 'shared/ui/PageLayout' },
    Counter: { file: 'domains/counter/components/Counter' },
    CounterCard: { file: 'domains/counter/components/CounterCard', from: 'domains/counter' },
    Hero: { file: 'domains/onboarding/components/Hero', from: 'domains/onboarding' },
    NextSteps: { file: 'domains/onboarding/components/NextSteps', from: 'domains/onboarding' },
  }
  const hints: Hints = {
    homeFile: 'src/App.tsx',
    addComponent:
      'Add a feature: give it a folder in <code>src/domains</code> with its own model, components and <code>index.ts</code>.',
  }
  const counterCard = importerFor(layout, layout.CounterCard.file)
  const files = componentFiles(ctx, layout, hints).filter((file) => !file.path.endsWith('/CounterCard.tsx'))
  return {
    files: [
      ...files,
      {
        path: 'src/domains/counter/model.ts',
        content: `/** The counter's state and rules, with no UI in sight. */
export interface CounterState {
  count: number
}

export const initialCounter: CounterState = { count: 0 }

export function increment(state: CounterState): CounterState {
  return { count: state.count + 1 }
}
`,
      },
      {
        path: 'src/domains/counter/components/CounterCard.tsx',
        content: `import { useState } from 'react'
${importLines(counterCard, ['Card', 'Counter'])}
import { increment, initialCounter } from '../model'

/** Connects the counter's rules (model.ts) to its UI. */
export function CounterCard() {
  const [state, setState] = useState(initialCounter)
  return (
    <Card>
      <h2>Try it</h2>
      <p className="muted">The rules live in the domain's model; the components only display them.</p>
      <Counter count={state.count} onIncrement={() => setState(increment)} />
    </Card>
  )
}
`,
      },
      {
        path: 'src/domains/counter/index.ts',
        content: `// The public face of the "counter" domain. Other code imports from here,
// never from the files inside.
export { CounterCard } from './components/CounterCard'
export { increment, initialCounter } from './model'
export type { CounterState } from './model'
`,
      },
      {
        path: 'src/domains/onboarding/index.ts',
        content: `// The public face of the "onboarding" domain: what a new developer sees first.
export { Hero } from './components/Hero'
export { NextSteps } from './components/NextSteps'
`,
      },
      { path: 'src/App.tsx', content: appTsx(ctx, layout) },
    ],
    guide: `## Structure: Domain-Driven Frontend

Code is grouped by the part of the business it belongs to, not by what kind
of file it is.

- \`src/domains/<domain>\`: everything one domain needs
  - \`model.ts\`: its types and rules, with no UI
  - \`components/\`: its UI
  - \`index.ts\`: its public face. Other code imports from here, never from the files inside.
- \`src/shared/ui\`: UI with no business meaning, usable by every domain (\`Button\`, \`Card\`, \`PageLayout\`, ...)
- \`src/App.tsx\`: composes domains into the page

The starter has two domains: \`counter\` (a small example with a model) and
\`onboarding\` (the welcome content). Replace them with your own, such as
\`billing\` or \`claims\`. A domain may import another domain's \`index.ts\`, and
anything in \`shared\`; \`shared\` never imports a domain.`,
  }
}

// ---------------------------------------------------------------------------
// 5. Web Components (Lit)

/** Lit sources use backticks and \${x}; write them here as ~ and $[x] to keep this file readable. */
const lit = (source: string) => source.replaceAll('~', '`').replace(/\$\[([^\]]*)\]/g, '${$1}')

function webComponents(ctx: TemplateContext): PatternOutput {
  const hints: Hints = {
    homeFile: 'src/App.tsx',
    addComponent:
      'Add an element: create <code>src/elements/app-name.ts</code>, then list it in <code>index.ts</code> and <code>jsx.d.ts</code>.',
  }
  const files: PatternFile[] = [
    {
      path: 'src/elements/app-card.ts',
      content: lit(`import { css, html, LitElement } from 'lit'

/** <app-card>: a bordered surface that groups whatever you put inside it. */
export class AppCard extends LitElement {
  static styles = css~
    :host {
      display: block;
    }

    /* Styled on an inner element: page-level resets can override :host, but not this. */
    .surface {
      padding: 1.25rem 1.5rem;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
    }
  ~

  render() {
    return html~<div class="surface"><slot></slot></div>~
  }
}
`),
    },
    {
      path: 'src/elements/app-counter.ts',
      content: lit(`import { css, html, LitElement } from 'lit'

/**
 * <app-counter count="0">: a button that counts its clicks.
 * Fires a "count-changed" event with the new count in event.detail.
 */
export class AppCounter extends LitElement {
  static properties = { count: { type: Number, reflect: true } }
  declare count: number

  static styles = css~
    :host {
      display: block;
    }

    .counter {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 1rem;
      margin-top: 0.75rem;
    }

    button {
      padding: 0.55rem 1rem;
      font: inherit;
      color: var(--on-accent);
      background: var(--accent);
      border: 0;
      border-radius: 8px;
      cursor: pointer;
    }

    button:hover {
      filter: brightness(1.1);
    }
  ~

  constructor() {
    super()
    this.count = 0
  }

  private increment() {
    this.count += 1
    this.dispatchEvent(new CustomEvent('count-changed', { detail: this.count, bubbles: true, composed: true }))
  }

  render() {
    return html~
      <div class="counter">
        <button type="button" @click=$[this.increment]>Add one</button>
        <span>Clicked $[this.count] $[this.count === 1 ? 'time' : 'times']</span>
      </div>
    ~
  }
}
`),
    },
    {
      path: 'src/elements/app-hero.ts',
      content: lit(`import { css, html, LitElement } from 'lit'

/** <app-hero>: the page intro. Put an <h1 slot="title"> and any other content inside. */
export class AppHero extends LitElement {
  static styles = css~
    :host {
      display: block;
    }

    .text {
      max-width: 60ch;
    }
  ~

  render() {
    return html~<slot name="title"></slot><div class="text"><slot></slot></div>~
  }
}
`),
    },
    {
      path: 'src/elements/app-site-header.ts',
      content: lit(`import { css, html, LitElement } from 'lit'

/** <app-site-header>: the bar at the top of every page. Put links inside. */
export class AppSiteHeader extends LitElement {
  static styles = css~
    :host {
      display: block;
    }

    header {
      display: flex;
      align-items: center;
      gap: 1.5rem;
      padding: 0.9rem 1.5rem;
      background: var(--surface);
      border-bottom: 1px solid var(--border);
    }
  ~

  render() {
    return html~<header><slot></slot></header>~
  }
}
`),
    },
    {
      path: 'src/elements/index.ts',
      content: `/**
 * Registers every custom element. main.tsx imports this file once, and the
 * tags then work anywhere: in React, or in plain HTML.
 */
import { AppCard } from './app-card'
import { AppCounter } from './app-counter'
import { AppHero } from './app-hero'
import { AppSiteHeader } from './app-site-header'

const elements = {
  'app-card': AppCard,
  'app-counter': AppCounter,
  'app-hero': AppHero,
  'app-site-header': AppSiteHeader,
}

for (const [tag, element] of Object.entries(elements)) {
  if (!customElements.get(tag)) customElements.define(tag, element)
}
`,
    },
    {
      path: 'src/elements/jsx.d.ts',
      content: `// Teaches TypeScript the custom elements, so <app-card> type-checks in JSX.
import type { DetailedHTMLProps, HTMLAttributes } from 'react'

type CustomElement<Props = object> = DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & Props

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'app-card': CustomElement
      'app-counter': CustomElement<{ count?: number }>
      'app-hero': CustomElement
      'app-site-header': CustomElement
    }
  }
}
`,
    },
    {
      path: 'src/App.tsx',
      content: `// React composes the page; the custom elements own how things look and behave.
export function App() {
  return (
    <>
      <app-site-header>
        <a href="/" className="brand">
          ${ctx.name}
        </a>
      </app-site-header>
      <main className="container">
        <app-hero>
          <h1 slot="title">Welcome to ${ctx.name}</h1>
          <p>
            Your app is running. Edit <code>${hints.homeFile}</code> and save to see this page
            update.
          </p>
        </app-hero>

        <app-card>
          <h2>Try it</h2>
          <p className="muted">The counter is a custom element. It keeps its own state.</p>
          <app-counter />
        </app-card>

        <app-card>
${nextStepsBody(ctx, hints, '          ')}
        </app-card>
      </main>
    </>
  )
}
`,
    },
  ]
  return {
    files,
    // Content slotted into an element stays in the page, so the page styles it.
    css: `app-hero h1 {
  font-size: clamp(1.8rem, 4vw, 2.6rem);
}`,
    dependencies: ['lit'],
    mainImports: ["import './elements'"],
    guide: `## Structure: Web Components

The UI is a set of custom elements built with [Lit](https://lit.dev). They
are standard HTML tags, so the same elements work in React, Angular, Vue,
Astro or a plain HTML page.

- \`src/elements/app-*.ts\`: one custom element per file, with its styles inside its shadow DOM, where page styles can't reach
- \`src/elements/index.ts\`: registers the elements; imported once by \`src/main.tsx\`
- \`src/elements/jsx.d.ts\`: the elements' props, so the tags type-check in JSX
- \`src/App.tsx\`: React composes the elements into the page

The elements read the colors in \`src/styles.css\` (\`--accent\`, \`--surface\`,
...), so one set of tokens themes both the page and the elements.`,
  }
}
