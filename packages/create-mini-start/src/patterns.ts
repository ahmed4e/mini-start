/**
 * The starter's components, organized by the design pattern the user picked.
 * Every pattern renders the same app; what differs is where each piece
 * lives and what it may import.
 *
 * The four React patterns share one set of pieces (here and in features.ts).
 * A pattern is a placement rule: given a piece's kind, domain and whether it
 * holds state, where does its file go? The Web Components pattern draws its
 * UI with Lit elements instead, and shares only the non-visual pieces.
 */
import path from 'node:path'
import { type Features, planFeatures } from './features.ts'
import type { AddOnId, PatternId } from './options.ts'
import {
  extensionOf,
  type Importer,
  importLines,
  isComponent,
  type ModuleSpec,
  type PatternFile,
  type Piece,
  type Placement,
  relativeImport,
} from './pieces.ts'
import { layoutRules, type MainSpec, runCommand, type TemplateContext } from './templates.ts'

export type { PatternFile }

export interface PatternOutput {
  /** Must include src/App.tsx. */
  files: PatternFile[]
  /** Extra class rules for src/styles.css. With CSS Modules these move into the components' modules. */
  css?: string
  /** Extra rules that select tags (custom elements). They always stay in src/styles.css. */
  tagCss?: string
  /** If set, only these starter layout rules go into src/styles.css; the rest live elsewhere. */
  globalSelectors?: string[]
  /** What src/main.tsx imports and wraps around <App />. */
  main: MainSpec
  /** CSS Module specs contributed by add-ons, keyed by component file name. */
  moduleSpecs?: Record<string, ModuleSpec>
  /** Markdown for the project README: how the code is organized. */
  guide: string
}

export function planPattern(ctx: TemplateContext): PatternOutput {
  const output = ctx.pattern === 'web-components' ? webComponents(ctx) : reactPattern(ctx, ctx.pattern)
  return ctx.addOns.has('css-modules') ? withCssModules(ctx, output) : output
}

// ---------------------------------------------------------------------------
// Placement: where each React pattern puts a piece

type ReactPatternId = Exclude<PatternId, 'web-components'>

/** Hooks, stores, helpers, providers and pages go in a folder named after what they are. */
function byKind(piece: Piece, pagesDir = 'pages'): Placement {
  const folder = { hook: 'hooks', store: 'stores', lib: 'lib', provider: 'providers', page: pagesDir }[piece.kind as string]
  return { file: `${folder}/${piece.name}` }
}

const PLACE: Record<ReactPatternId | 'web-components', (piece: Piece) => Placement> = {
  // By how much a component is made of.
  atomic: (piece) =>
    isComponent(piece) ? { file: `components/${piece.kind}s/${piece.name}` } : byKind(piece, 'components/pages'),

  // A folder per component; the folder's index.ts is what others import.
  'component-driven': (piece) =>
    isComponent(piece)
      ? { file: `components/${piece.name}/${piece.name}`, from: `components/${piece.name}` }
      : byKind(piece),

  // By whether a component holds state.
  'smart-dumb': (piece) =>
    isComponent(piece) ? { file: `${piece.smart ? 'containers' : 'components'}/${piece.name}` } : byKind(piece),

  // By business domain; code outside a domain imports its index.ts.
  'domain-driven': (piece) => {
    if (piece.kind === 'page') return { file: `pages/${piece.name}` }
    if (!piece.domain) {
      const folder = isComponent(piece) ? 'ui' : `${byKind(piece).file.split('/')[0]}`
      return { file: `shared/${folder}/${piece.name}` }
    }
    const root = `domains/${piece.domain}`
    const file = isComponent(piece)
      ? `${root}/components/${piece.name}`
      : piece.kind === 'store'
        ? `${root}/store`
        : `${root}/${piece.name}`
    return piece.public ? { file, from: root } : { file }
  },

  // The UI is custom elements; the few React pieces sit in plain folders.
  'web-components': (piece) => (isComponent(piece) ? { file: `components/${piece.name}` } : byKind(piece)),
}

/** Places pieces and answers "how does file A import piece B?". */
function arrange(pieces: Piece[], place: (piece: Piece) => Placement) {
  const byName = new Map(pieces.map((piece) => [piece.name, piece]))
  const placements = new Map(pieces.map((piece) => [piece.name, place(piece)]))
  const exportNames = Object.fromEntries(pieces.flatMap((p) => (p.exportName ? [[p.name, p.exportName]] : [])))
  const fileOf = (name: string) => {
    const placement = placements.get(name)
    if (!placement) throw new Error(`No piece named ${name}`)
    return placement.file
  }
  const importer =
    (fromFile: string): Importer =>
    (name) => {
      const piece = byName.get(name)
      const placement = placements.get(name)
      if (!piece || !placement) throw new Error(`${fromFile} imports ${name}, which is not part of this project`)
      // Inside its own domain a piece is imported directly; outside, through the public index.
      const inside = piece.domain !== undefined && fromFile.startsWith(`domains/${piece.domain}/`)
      return relativeImport(fromFile, inside ? placement.file : (placement.from ?? placement.file))
    }
  const files: PatternFile[] = pieces.map((piece) => ({
    path: `src/${fileOf(piece.name)}.${extensionOf(piece)}`,
    content: piece.source(importer(fileOf(piece.name))),
    ...(piece.addOn ? { addOn: piece.addOn } : {}),
  }))
  /** Project-relative path of a piece's file, for READMEs and hints. */
  const pathOf = (name: string) => `src/${fileOf(name)}.${extensionOf(byName.get(name)!)}`
  return { files, importer, fileOf, pathOf, exportNames, has: (name: string) => byName.has(name) }
}

// ---------------------------------------------------------------------------
// The base pieces: what every React starter has

/** What the "Next steps" card says about this project. */
interface Hints {
  /** The file to edit to change the page. */
  homeFile: string
  /** Where a new component goes in this pattern (JSX). */
  addComponent: string
}

function basePieces(ctx: TemplateContext, hints: Hints): Piece[] {
  const router = ctx.addOns.has('router')
  const theme = ctx.addOns.has('theme')
  const state = ctx.addOns.has('state')
  const ddd = ctx.pattern === 'domain-driven'

  const counterCard = (i: Importer): string => {
    if (state) {
      return `${importLines(i, ['Card', 'Counter'])}
import { useCounterStore } from '${i('counterStore')}'

/** Reads the count from the store and hands it to <Counter>, which only displays it. */
export function CounterCard() {
  const count = useCounterStore((state) => state.count)
  const increment = useCounterStore((state) => state.increment)
  return (
    <Card>
      <h2>Try it</h2>
      <p className="muted">The count lives in a store, so every component that asks for it sees the same number.</p>
      <Counter count={count} onIncrement={increment} />
    </Card>
  )
}
`
    }
    if (ddd) {
      return `import { useState } from 'react'
${importLines(i, ['Card', 'Counter'])}
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
`
    }
    return `import { useState } from 'react'
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
`
  }

  const brand = router
    ? `<Link to="/" className="brand">
        {name}
      </Link>`
    : `<a href="/" className="brand">
        {name}
      </a>`
  const siteHeader = theme
    ? `import type { ReactNode } from 'react'
${router ? "import { Link } from 'react-router'\n" : ''}
interface Props {
  name: string
  /** Links, shown next to the name. */
  children?: ReactNode
  /** Controls, pushed to the far side. */
  actions?: ReactNode
}

/** The bar at the top of every page. */
export function SiteHeader({ name, children, actions }: Props) {
  return (
    <header className="site-header">
      ${brand}
      {children && <nav>{children}</nav>}
      {actions && <div className="header-actions">{actions}</div>}
    </header>
  )
}
`
    : `import type { ReactNode } from 'react'
${router ? "import { Link } from 'react-router'\n" : ''}
/** The bar at the top of every page. Pass links as children. */
export function SiteHeader({ name, children }: { name: string; children?: ReactNode }) {
  return (
    <header className="site-header">
      ${brand}
      {children && <nav>{children}</nav>}
    </header>
  )
}
`

  return [
    {
      name: 'Button',
      kind: 'atom',
      source: () => `import type { ReactNode } from 'react'

export function Button({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return (
    <button type="button" className="button" onClick={onClick}>
      {children}
    </button>
  )
}
`,
    },
    {
      name: 'Card',
      kind: 'atom',
      source: () => `import type { ReactNode } from 'react'

/** A bordered surface that groups related content. */
export function Card({ children }: { children: ReactNode }) {
  return <section className="card">{children}</section>
}
`,
    },
    {
      name: 'Counter',
      kind: 'molecule',
      domain: 'counter',
      source: (i) => `${importLines(i, ['Button'])}

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
    },
    { name: 'CounterCard', kind: 'organism', smart: true, domain: 'counter', public: true, source: counterCard },
    {
      name: 'Hero',
      kind: 'organism',
      domain: 'onboarding',
      public: true,
      source: () => `export function Hero({ name }: { name: string }) {
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
    },
    {
      name: 'NextSteps',
      kind: 'organism',
      domain: 'onboarding',
      public: true,
      source: (i) => `${importLines(i, ['Card'])}

export function NextSteps() {
  return (
    <Card>
${nextStepsBody(ctx, hints, '      ')}
    </Card>
  )
}
`,
    },
    { name: 'SiteHeader', kind: 'organism', source: () => siteHeader },
    {
      name: 'PageLayout',
      kind: 'template',
      source: (i) =>
        theme
          ? `import type { ReactNode } from 'react'
${importLines(i, ['SiteHeader'])}

interface Props {
  name: string
  nav?: ReactNode
  actions?: ReactNode
  children: ReactNode
}

/** The frame every page shares: the site header and the content column. */
export function PageLayout({ name, nav, actions, children }: Props) {
  return (
    <>
      <SiteHeader name={name} actions={actions}>
        {nav}
      </SiteHeader>
      <main className="container">{children}</main>
    </>
  )
}
`
          : `import type { ReactNode } from 'react'
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
    },
  ]
}

/** The "Next steps" heading and list, shared by the React and Web Components starters. */
function nextStepsBody(ctx: TemplateContext, hints: Hints, indent: string): string {
  const styling = ctx.addOns.has('css-modules')
    ? ctx.pattern === 'web-components'
      ? `Style it: an element's styles are in its own file; the page's are in{' '}
    <code>src/App.module.css</code>.`
      : `Style it: each component's styles are in the <code>.module.css</code> file next to it. Colors
    are in <code>src/styles.css</code>.`
    : ctx.addOns.has('tailwind')
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

// ---------------------------------------------------------------------------
// Per-pattern text and extras

const ADD_COMPONENT: Record<ReactPatternId, string> = {
  atomic:
    'Add a component: put it in <code>atoms</code>, <code>molecules</code> or <code>organisms</code>, by how much it is made of.',
  'component-driven':
    'Add a component: give it a folder in <code>src/components</code> with a <code>.stories.tsx</code> file, and it shows up on the Components page.',
  'smart-dumb':
    'Add a component: if it only takes props, it goes in <code>src/components</code>; if it owns state or loads data, in <code>src/containers</code>.',
  'domain-driven':
    'Add a feature: give it a folder in <code>src/domains</code> with its own model, components and <code>index.ts</code>.',
}

const GUIDES: Record<ReactPatternId, string> = {
  atomic: `## Structure: Atomic Design

Components are sorted by how much they are made of. Each level only imports
from the levels above it in this list.

- \`src/components/atoms\`: the smallest pieces, with no other components inside (\`Button\`, \`Card\`)
- \`src/components/molecules\`: a few atoms working together (\`Counter\`)
- \`src/components/organisms\`: complete sections of a page (\`SiteHeader\`, \`Hero\`, \`CounterCard\`, \`NextSteps\`)
- \`src/components/templates\`: page frames without real content (\`PageLayout\`)
- \`src/components/pages\`: templates filled with real content (\`HomePage\`)`,

  'component-driven': `## Structure: Component-Driven Development

The UI is built from the bottom up, one component at a time, and each
component can be seen on its own before a page uses it.

- \`src/components/<Name>/<Name>.tsx\`: the component
- \`src/components/<Name>/<Name>.stories.tsx\`: its stories, one export per state worth looking at
- \`src/components/<Name>/index.ts\`: what the rest of the app imports
- \`src/preview/ComponentGallery.tsx\`: the Components page (\`__GALLERY__\`), which finds every story file and previews it

The stories use the same format as Storybook (a default export with a
\`title\`, then one named export per story), so you can add Storybook later
without rewriting them.`,

  'smart-dumb': `## Structure: Smart-Dumb Components

Logic and presentation live in different folders.

- \`src/components\`: dumb (presentational) components. They get everything through props, hold no
  state, and never import from \`containers\` (\`Counter\`, \`Button\`, \`Card\`, ...).
- \`src/containers\`: smart components. They own state, data loading and other logic, and render
  dumb components with the result (\`CounterCard\`).`,

  'domain-driven': `## Structure: Domain-Driven Frontend

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

/** Component-Driven stories for the base pieces, keyed by piece name. */
const STORIES: Record<string, string> = {
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

const HEADER_ACTIONS_CSS = `.header-actions {
  margin-left: auto;
}`

const GALLERY_TSX = `import type { ComponentType } from 'react'

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
`

/** index.ts of each domain: a header, its public components, then anything else it exports. */
const DOMAIN_INDEX: Record<string, { header: string; extra: string[] }> = {
  counter: {
    header: `// The public face of the "counter" domain. Other code imports from here,
// never from the files inside.`,
    extra: [`export { increment, initialCounter } from './model'`, `export type { CounterState } from './model'`],
  },
  onboarding: {
    header: `// The public face of the "onboarding" domain: what a new developer sees first.`,
    extra: [],
  },
  tips: {
    header: `// The public face of the "tips" domain: an example of data loaded from an API.`,
    extra: [`export type { Tip } from './useTips'`],
  },
}

const COUNTER_MODEL = `/** The counter's state and rules, with no UI in sight. */
export interface CounterState {
  count: number
}

export const initialCounter: CounterState = { count: 0 }

export function increment(state: CounterState): CounterState {
  return { count: state.count + 1 }
}
`

const COUNTER_TEST = `import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { Counter } from './Counter'

test('shows the count and reports a click', async () => {
  const onIncrement = vi.fn()
  render(<Counter count={1} onIncrement={onIncrement} />)

  expect(screen.getByText('Clicked 1 time')).toBeInTheDocument()

  await userEvent.click(screen.getByRole('button', { name: 'Add one' }))
  expect(onIncrement).toHaveBeenCalledOnce()
})
`

const TEST_SETUP = `// Runs before every test file (see "test" in vite.config.ts).
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Remove what the previous test rendered.
afterEach(cleanup)
`

// ---------------------------------------------------------------------------
// Assembling a React starter

function indentLines(lines: string[], indent: string): string {
  return lines.map((line) => (line ? indent + line : line)).join('\n')
}

/** <PageLayout ...> opening tag: one line when it only has a name, one prop per line otherwise. */
function pageLayoutOpen(name: string, nav: string[] | null, actions: boolean): string[] {
  if (!nav && !actions) return [`<PageLayout name="${name}">`]
  return [
    '<PageLayout',
    `  name="${name}"`,
    ...(nav ? ['  nav={', '    <>', ...nav.map((line) => `      ${line}`), '    </>', '  }'] : []),
    ...(actions ? ['  actions={<ThemeToggle />}'] : []),
    '>',
  ]
}

function reactPattern(ctx: TemplateContext, id: ReactPatternId): PatternOutput {
  const has = (addOn: AddOnId) => ctx.addOns.has(addOn)
  const router = has('router')
  const theme = has('theme')
  const place = PLACE[id]
  const stub = (name: string): Piece => ({ name, kind: 'page', source: () => '' })

  // Atomic always has a HomePage (pages are one of its levels); the others get one with routing.
  const hasHomePage = router || id === 'atomic'
  const hints: Hints = {
    homeFile: hasHomePage ? `src/${place(stub('HomePage')).file}.tsx` : 'src/App.tsx',
    addComponent: ADD_COMPONENT[id],
  }
  const features = planFeatures(ctx, {
    card: 'Card',
    counterModel: id === 'domain-driven',
    counterSetter: false,
    reactThemeToggle: true,
  })

  const content = ['Hero', 'CounterCard', ...(has('query') ? ['TipsCard'] : []), 'NextSteps']
  const contentJsx = content.map((name) => (name === 'Hero' ? `<Hero name="${ctx.name}" />` : `<${name} />`))
  const sorted = (names: string[]) => [...names].sort()

  const homePage: Piece = {
    name: 'HomePage',
    kind: 'page',
    source: (i) =>
      router
        ? `${importLines(i, sorted(content))}

export function HomePage() {
  return (
    <>
${indentLines(contentJsx, '      ')}
    </>
  )
}
`
        : `${importLines(i, sorted([...content, 'PageLayout', ...(theme ? ['ThemeToggle'] : [])]))}

/** A page: a template filled with real content. */
export function HomePage() {
  return (
${indentLines(pageLayoutOpen(ctx.name, null, theme), '    ')}
${indentLines(contentJsx, '      ')}
    </PageLayout>
  )
}
`,
  }

  const arranged = arrange([...basePieces(ctx, hints), ...(hasHomePage ? [homePage] : []), ...features.pieces], place)
  const { importer, fileOf } = arranged
  const files: PatternFile[] = [...arranged.files, ...features.files]
  const fromApp = importer('App')
  const cdd = id === 'component-driven'

  // --- src/App.tsx
  let app: string
  if (router) {
    const pages = ['AboutPage', 'HomePage', 'NotFoundPage']
    app = `import { BrowserRouter, NavLink, Route, Routes } from 'react-router'
${importLines(fromApp, sorted([...pages, 'PageLayout', ...(theme ? ['ThemeToggle'] : [])]))}
${cdd ? "import { ComponentGallery } from './preview/ComponentGallery'\n" : ''}
export function App() {
  return (
    <BrowserRouter>
${indentLines(
  pageLayoutOpen(
    ctx.name,
    [
      '<NavLink to="/" end>',
      '  Home',
      '</NavLink>',
      '<NavLink to="/about">About</NavLink>',
      ...(cdd ? ['<NavLink to="/components">Components</NavLink>'] : []),
    ],
    theme,
  ),
  '      ',
)}
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/about" element={<AboutPage />} />
${cdd ? '          <Route path="/components" element={<ComponentGallery />} />\n' : ''}          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </PageLayout>
    </BrowserRouter>
  )
}
`
  } else if (id === 'atomic') {
    app = `import { HomePage } from './components/pages/HomePage'

export function App() {
  return <HomePage />
}
`
  } else if (cdd) {
    app = `import { useSyncExternalStore } from 'react'
${importLines(fromApp, sorted([...content, 'PageLayout', ...(theme ? ['ThemeToggle'] : [])]))}
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
${indentLines(
  pageLayoutOpen(
    ctx.name,
    [
      `<a href="#/" className={showGallery ? undefined : 'active'}>`,
      '  Home',
      '</a>',
      `<a href="#/components" className={showGallery ? 'active' : undefined}>`,
      '  Components',
      '</a>',
    ],
    theme,
  ),
  '    ',
)}
      {showGallery ? (
        <ComponentGallery />
      ) : (
        <>
${indentLines(contentJsx, '          ')}
        </>
      )}
    </PageLayout>
  )
}
`
  } else {
    app = `${importLines(fromApp, sorted([...content, 'PageLayout', ...(theme ? ['ThemeToggle'] : [])]))}

export function App() {
  return (
${indentLines(pageLayoutOpen(ctx.name, null, theme), '    ')}
${indentLines(contentJsx, '      ')}
    </PageLayout>
  )
}
`
  }
  files.push({ path: 'src/App.tsx', content: app })

  // --- Pattern extras
  const stories = { ...STORIES, ...features.stories }
  if (cdd) {
    for (const file of arranged.files) {
      const name = path.posix.basename(file.path, '.tsx')
      if (!file.path.startsWith(`src/components/${name}/`)) continue
      files.push({
        path: `src/components/${name}/index.ts`,
        content: `export { ${name} } from './${name}'\n`,
        ...(file.addOn ? { addOn: file.addOn } : {}),
      })
      if (!stories[name]) continue
      files.push({
        path: `src/components/${name}/${name}.stories.tsx`,
        content: `import { ${name} } from './${name}'

export default { title: '${name}' }

${stories[name]}
`,
        ...(file.addOn ? { addOn: file.addOn } : {}),
      })
    }
    files.push({ path: 'src/preview/ComponentGallery.tsx', content: GALLERY_TSX })
  }
  if (id === 'domain-driven') {
    files.push({ path: 'src/domains/counter/model.ts', content: COUNTER_MODEL })
    const pieces = [...basePieces(ctx, hints), ...features.pieces].filter((piece) => piece.domain && piece.public)
    for (const domain of new Set(pieces.map((piece) => piece.domain!))) {
      const mine = pieces.filter((piece) => piece.domain === domain)
      const lines = [
        ...mine.filter(isComponent).map((piece) => `export { ${piece.name} } from './components/${piece.name}'`),
        ...(DOMAIN_INDEX[domain]?.extra ?? []),
        ...mine
          .filter((piece) => piece.kind === 'store')
          .map((piece) => `export { ${piece.exportName ?? piece.name} } from './store'`),
      ]
      files.push({
        path: `src/domains/${domain}/index.ts`,
        content: `${DOMAIN_INDEX[domain]?.header ?? `// The public face of the "${domain}" domain.`}\n${lines.join('\n')}\n`,
        ...(mine.every((piece) => piece.addOn) ? { addOn: mine[0]!.addOn } : {}),
      })
    }
  }
  if (has('testing')) {
    files.push(
      { path: `src/${fileOf('Counter')}.test.tsx`, content: COUNTER_TEST, addOn: 'testing' },
      { path: 'src/test/setup.ts', content: TEST_SETUP, addOn: 'testing' },
    )
  }

  const css = [...(cdd ? [STORIES_CSS] : []), ...(theme ? [HEADER_ACTIONS_CSS] : []), ...features.css]
  const gallery = router ? '/components' : '#/components'
  return {
    files,
    ...(css.length ? { css: css.join('\n\n') } : {}),
    main: mainSpec(ctx, importer('main')),
    moduleSpecs: features.moduleSpecs,
    guide: [GUIDES[id].replace('__GALLERY__', gallery), featureGuide(ctx, arranged.pathOf)].filter(Boolean).join('\n\n'),
  }
}

/** Providers that wrap <App /> in src/main.tsx. */
function mainSpec(ctx: TemplateContext, i: Importer, localImports: string[] = []): MainSpec {
  const spec: MainSpec = { packageImports: [], localImports: [...localImports], setup: [], wrappers: [] }
  if (ctx.addOns.has('env-errors')) {
    spec.localImports.push(importLines(i, ['ErrorBoundary']))
    spec.wrappers.push(['<ErrorBoundary>', '</ErrorBoundary>'])
  }
  if (ctx.addOns.has('query')) {
    spec.packageImports.push("import { QueryClient, QueryClientProvider } from '@tanstack/react-query'")
    spec.setup.push('// One cache for the whole app. Hooks such as useTips read and fill it.', 'const queryClient = new QueryClient()')
    spec.wrappers.push(['<QueryClientProvider client={queryClient}>', '</QueryClientProvider>'])
  }
  return spec
}

/** README section listing what each selected add-on put where. */
function featureGuide(ctx: TemplateContext, pathOf: (name: string) => string): string {
  const has = (addOn: AddOnId) => ctx.addOns.has(addOn)
  const run = (script: string) => runCommand(ctx.packageManager, script)
  const code = (name: string) => `\`${pathOf(name)}\``
  const lines: string[] = []
  if (has('router')) {
    lines.push(
      `- **Routing** (React Router): the routes are listed in \`src/App.tsx\`. Pages are next to ${code('AboutPage')}. To add one, create the page and add a \`<Route>\` and a \`<NavLink>\`.`,
    )
  }
  if (has('state')) {
    lines.push(
      `- **State** (Zustand): ${code('counterStore')} holds the counter. Any component can read it with \`useCounterStore\`, and it keeps its value while you move between pages.`,
    )
  }
  if (has('query')) {
    lines.push(
      `- **Data fetching** (TanStack Query): ${code('useTips')} loads \`public/api/tips.json\` through ${code('api')}. The query client is created in \`src/main.tsx\`. Replace the JSON file with your API.`,
    )
  }
  if (has('theme')) {
    lines.push(
      ctx.pattern === 'web-components'
        ? `- **Theme toggle**: \`src/elements/app-theme-toggle.ts\` switches between system, light and dark, and remembers the choice. The colors for each theme are in \`src/styles.css\`.`
        : `- **Theme toggle**: ${code('ThemeToggle')} switches between system, light and dark; ${code('useTheme')} remembers the choice. The colors for each theme are in \`src/styles.css\`.`,
    )
  }
  if (has('env-errors')) {
    lines.push(
      `- **Environment variables**: read them through ${code('env')}. Copy \`.env.example\` to \`.env.local\` to set them.`,
      `- **Error handling**: ${code('ErrorBoundary')} wraps the app in \`src/main.tsx\` and shows ${code('ErrorFallback')} if rendering fails.`,
    )
  }
  if (has('testing')) {
    lines.push(
      `- **Tests** (Vitest + Testing Library): \`${run('test')}\` runs them once, \`${run('test:watch')}\` reruns on save. Test files sit next to the code they test and end in \`.test.ts\` or \`.test.tsx\`.`,
    )
  }
  return lines.length ? `## What the add-ons added\n\n${lines.join('\n')}` : ''
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
  ]

  const has = (addOn: AddOnId) => ctx.addOns.has(addOn)
  const router = has('router')
  const theme = has('theme')
  const state = has('state')
  hints.homeFile = router ? 'src/pages/HomePage.tsx' : 'src/App.tsx'

  if (theme) {
    files.push({
      path: 'src/elements/app-theme-toggle.ts',
      addOn: 'theme',
      content: lit(`import { css, html, LitElement } from 'lit'

type Theme = 'system' | 'light' | 'dark'

const STORAGE_KEY = 'theme'
const NEXT: Record<Theme, Theme> = { system: 'light', light: 'dark', dark: 'system' }
const LABEL: Record<Theme, string> = { system: 'System', light: 'Light', dark: 'Dark' }

function storedTheme(): Theme {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return value === 'light' || value === 'dark' ? value : 'system'
  } catch {
    return 'system'
  }
}

/**
 * <app-theme-toggle>: cycles system → light → dark and remembers the choice.
 * The choice is written to <html data-theme>, which src/styles.css reads.
 */
export class AppThemeToggle extends LitElement {
  static properties = { theme: { state: true } }
  declare theme: Theme

  static styles = css~
    :host {
      display: block;
    }

    button {
      padding: 0.3rem 0.7rem;
      font: inherit;
      font-size: 0.875rem;
      color: var(--muted);
      background: transparent;
      border: 1px solid var(--border);
      border-radius: 999px;
      cursor: pointer;
    }

    button:hover {
      color: var(--text);
    }
  ~

  constructor() {
    super()
    this.theme = storedTheme()
  }

  private get label() {
    return LABEL[this.theme]
  }

  private toggle() {
    this.theme = NEXT[this.theme]
    const root = document.documentElement
    try {
      if (this.theme === 'system') {
        delete root.dataset.theme
        localStorage.removeItem(STORAGE_KEY)
      } else {
        root.dataset.theme = this.theme
        localStorage.setItem(STORAGE_KEY, this.theme)
      }
    } catch {
      // Storage can be blocked; the theme still applies for this visit.
    }
  }

  render() {
    return html~<button type="button" @click=$[this.toggle]>Theme: $[this.label]</button>~
  }
}
`),
    })
  }

  // --- The element registry and its JSX types
  const tags = ['app-card', 'app-counter', 'app-hero', 'app-site-header', ...(theme ? ['app-theme-toggle'] : [])]
  const className = (tag: string) =>
    tag
      .split('-')
      .map((word) => word[0]!.toUpperCase() + word.slice(1))
      .join('')
  const props: Record<string, string> = {
    'app-counter': state
      ? "<{ count?: number; 'oncount-changed'?: (event: CustomEvent<number>) => void }>"
      : '<{ count?: number }>',
  }
  files.push(
    {
      path: 'src/elements/index.ts',
      content: `/**
 * Registers every custom element. main.tsx imports this file once, and the
 * tags then work anywhere: in React, or in plain HTML.
 */
${tags.map((tag) => `import { ${className(tag)} } from './${tag}'`).join('\n')}

const elements = {
${tags.map((tag) => `  '${tag}': ${className(tag)},`).join('\n')}
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
${tags.map((tag) => `      '${tag}': CustomElement${props[tag] ?? ''}`).join('\n')}
    }
  }
}
`,
    },
  )

  // --- The React side: pages, hooks, stores and the few React components the add-ons bring
  const features = planFeatures(ctx, {
    card: 'app-card',
    counterModel: false,
    counterSetter: true,
    reactThemeToggle: false,
  })
  const hooks = state
    ? [
        'const count = useCounterStore((state) => state.count)',
        'const setCount = useCounterStore((state) => state.setCount)',
      ]
    : []
  /** The page content, as JSX blocks separated by blank lines. */
  const content = (indent: string) =>
    [
      `<app-hero>
  <h1 slot="title">Welcome to ${ctx.name}</h1>
  <p>
    Your app is running. Edit <code>${hints.homeFile}</code> and save to see this page
    update.
  </p>
</app-hero>`,
      state
        ? `<app-card>
  <h2>Try it</h2>
  <p className="muted">The counter is a custom element. The count it reports is kept in a store.</p>
  <app-counter count={count} oncount-changed={(event) => setCount(event.detail)} />
</app-card>`
        : `<app-card>
  <h2>Try it</h2>
  <p className="muted">The counter is a custom element. It keeps its own state.</p>
  <app-counter />
</app-card>`,
      ...(has('query') ? ['<TipsCard />'] : []),
      `<app-card>
${nextStepsBody(ctx, hints, '  ')}
</app-card>`,
    ]
      .map((block) => indentLines(block.split('\n'), indent))
      .join('\n\n')
  const contentImports = (i: Importer) =>
    [
      ...(has('query') ? [importLines(i, ['TipsCard'])] : []),
      ...(state ? [`import { useCounterStore } from '${i('counterStore')}'`] : []),
    ].join('\n')
  const hookLines = (indent: string) => (hooks.length ? `${indentLines(hooks, indent)}\n` : '')

  const homePage: Piece = {
    name: 'HomePage',
    kind: 'page',
    source: (i) => `${contentImports(i) ? `${contentImports(i)}\n\n` : ''}export function HomePage() {
${hookLines('  ')}  return (
    <>
${content('      ')}
    </>
  )
}
`,
  }
  const arranged = arrange([...(router ? [homePage] : []), ...features.pieces], PLACE['web-components'])
  const fromApp = arranged.importer('App')
  files.push(...arranged.files, ...features.files)

  const toggle = theme ? '\n        <app-theme-toggle />' : ''
  const comment = '// React composes the page; the custom elements own how things look and behave.'
  if (router) {
    files.push({
      path: 'src/App.tsx',
      content: `import { BrowserRouter, Link, NavLink, Route, Routes } from 'react-router'
${importLines(fromApp, ['AboutPage', 'HomePage', 'NotFoundPage'])}

${comment}
export function App() {
  return (
    <BrowserRouter>
      <app-site-header>
        <Link to="/" className="brand">
          ${ctx.name}
        </Link>
        <nav className="nav">
          <NavLink to="/" end>
            Home
          </NavLink>
          <NavLink to="/about">About</NavLink>
        </nav>${toggle}
      </app-site-header>
      <main className="container">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </main>
    </BrowserRouter>
  )
}
`,
    })
  } else {
    files.push({
      path: 'src/App.tsx',
      content: `${contentImports(fromApp) ? `${contentImports(fromApp)}\n\n` : ''}${comment}
export function App() {
${hookLines('  ')}  return (
    <>
      <app-site-header>
        <a href="/" className="brand">
          ${ctx.name}
        </a>${toggle}
      </app-site-header>
      <main className="container">
${content('        ')}
      </main>
    </>
  )
}
`,
    })
  }
  if (has('testing')) {
    files.push(
      {
        path: 'src/elements/app-counter.test.ts',
        addOn: 'testing',
        content: `import { expect, test } from 'vitest'
import type { AppCounter } from './app-counter'
import './index'

test('counts its clicks and reports the new count', async () => {
  const counter = document.createElement('app-counter') as AppCounter
  const reported: number[] = []
  counter.addEventListener('count-changed', (event) => reported.push((event as CustomEvent<number>).detail))
  document.body.append(counter)
  await counter.updateComplete

  counter.shadowRoot!.querySelector('button')!.click()
  await counter.updateComplete

  expect(counter.shadowRoot!.textContent).toContain('Clicked 1 time')
  expect(reported).toEqual([1])
})
`,
      },
      { path: 'src/test/setup.ts', content: TEST_SETUP, addOn: 'testing' },
    )
  }

  // Content slotted into an element stays in the page, so the page styles it.
  const tagCss = [
    `app-hero h1 {
  font-size: clamp(1.8rem, 4vw, 2.6rem);
}`,
    ...(theme ? [`app-theme-toggle {\n  margin-left: auto;\n}`] : []),
  ]
  const css = [...(router ? [WEB_COMPONENTS_NAV_CSS] : []), ...features.css]
  return {
    files,
    tagCss: tagCss.join('\n\n'),
    ...(css.length ? { css: css.join('\n\n') } : {}),
    // The elements style the header, cards and counter themselves.
    globalSelectors: ['.brand', '.container', '.muted', '.steps'],
    main: mainSpec(ctx, arranged.importer('main'), ["import './elements'"]),
    moduleSpecs: features.moduleSpecs,
    guide: [
      `## Structure: Web Components

The UI is a set of custom elements built with [Lit](https://lit.dev). They
are standard HTML tags, so the same elements work in React, Angular, Vue,
Astro or a plain HTML page.

- \`src/elements/app-*.ts\`: one custom element per file, with its styles inside its shadow DOM, where page styles can't reach
- \`src/elements/index.ts\`: registers the elements; imported once by \`src/main.tsx\`
- \`src/elements/jsx.d.ts\`: the elements' props, so the tags type-check in JSX
- \`src/App.tsx\`: React composes the elements into the page

The elements read the colors in \`src/styles.css\` (\`--accent\`, \`--surface\`,
...), so one set of tokens themes both the page and the elements.`,
      featureGuide(ctx, arranged.pathOf),
    ]
      .filter(Boolean)
      .join('\n\n'),
  }
}

const WEB_COMPONENTS_NAV_CSS = `.nav {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
}

.nav a {
  color: var(--muted);
  text-decoration: none;
}

.nav a:hover,
.nav a.active {
  color: var(--text);
}`

// ---------------------------------------------------------------------------
// Add-on: CSS Modules
//
// Applied on top of any pattern: each component's rules move out of the
// global stylesheet into a .module.css file next to the component, and its
// className="x" becomes className={styles.x}.

/** Keyed by the component file's name without extension. */
const MODULE_SPECS: Record<string, ModuleSpec> = {
  Button: { select: ['.button'], classes: { button: 'button' } },
  Card: { select: ['.card'], classes: { card: 'card' } },
  Counter: { select: ['.counter'], classes: { counter: 'counter' } },
  Hero: { select: ['.hero'], classes: { hero: 'hero' }, animate: 'hero' },
  NextSteps: { select: ['.steps'], classes: { steps: 'steps' } },
  SiteHeader: { select: ['.site-header', '.brand'], classes: { 'site-header': 'header', brand: 'brand' } },
  PageLayout: { select: ['.container'], classes: { container: 'container' } },
  ComponentGallery: { css: STORIES_CSS, classes: { 'story-group': 'group', 'story-name': 'name', story: 'story' } },
}

/** The Web Components starter keeps its page-level classes in App.tsx (and HomePage, with routing). */
function webComponentsSpec(ctx: TemplateContext, filePath: string): ModuleSpec | undefined {
  const router = ctx.addOns.has('router')
  if (filePath === 'src/App.tsx') {
    return router
      ? {
          select: ['.brand', '.container'],
          css: WEB_COMPONENTS_NAV_CSS,
          classes: { brand: 'brand', container: 'container', nav: 'nav' },
          animate: 'container',
        }
      : {
          select: ['.brand', '.container', '.steps'],
          classes: { brand: 'brand', container: 'container', steps: 'steps' },
          animate: 'container',
        }
  }
  if (filePath === 'src/pages/HomePage.tsx') return { select: ['.steps'], classes: { steps: 'steps' } }
  return undefined
}

function moduleCss(spec: ModuleSpec): string {
  let css = [...(spec.select ? layoutRules(spec.select) : []), ...(spec.css ? [spec.css] : [])].join('\n\n')
  // Longest names first, so ".story-name" isn't caught by ".story".
  for (const [from, to] of Object.entries(spec.classes).sort((a, b) => b[0].length - a[0].length)) {
    css = css.replaceAll(new RegExp(`\\.${from}(?![\\w-])`, 'g'), `.${to}`)
  }
  // "active" is set by whoever renders the links, so it stays a global name.
  css = css.replaceAll('a.active', 'a:global(.active)')
  if (spec.animate) {
    css += `

/* Animation names are local to this file too: another file can have its own "rise". */
.${spec.animate} {
  animation: rise 0.4s ease-out;
}

@keyframes rise {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
}`
  }
  return `${css}\n`
}

function withCssModules(ctx: TemplateContext, output: PatternOutput): PatternOutput {
  const files: PatternFile[] = []
  for (const file of output.files) {
    const name = path.posix.basename(file.path, '.tsx')
    let spec =
      (ctx.pattern === 'web-components' ? webComponentsSpec(ctx, file.path) : undefined) ??
      MODULE_SPECS[name] ??
      output.moduleSpecs?.[name]
    if (name === 'SiteHeader' && spec && ctx.addOns.has('theme')) {
      spec = { ...spec, css: HEADER_ACTIONS_CSS, classes: { ...spec.classes, 'header-actions': 'actions' } }
    }
    if (!spec || !file.path.endsWith('.tsx') || file.path.endsWith('.stories.tsx')) {
      files.push(file)
      continue
    }
    let content = file.content
    for (const [from, to] of Object.entries(spec.classes)) {
      content = content.replaceAll(`className="${from}"`, `className={styles.${to}}`)
    }
    const importLine = `import styles from './${name}.module.css'`
    const lines = content.split('\n')
    const lastImport = lines.findLastIndex((line) => line.startsWith('import '))
    if (lastImport >= 0) lines.splice(lastImport + 1, 0, importLine)
    else lines.unshift(importLine, '')
    files.push({ ...file, content: lines.join('\n') })
    files.push({ path: file.path.replace(/\.tsx$/, '.module.css'), content: moduleCss(spec), addOn: 'css-modules' })
  }
  return {
    ...output,
    files,
    // Class rules moved into the modules; rules that select tags stay global.
    css: undefined,
    globalSelectors: ['.muted'],
    guide: `${output.guide}

## Styling: CSS Modules

A file named \`Something.module.css\` is a normal CSS file whose class names and
\`@keyframes\` names are local to it. Import it and use the names as properties:

\`\`\`tsx
import styles from './Card.module.css'

<section className={styles.card}>
\`\`\`

Two components can both have a \`.title\` class or a \`rise\` animation without
clashing, because the build gives each one a unique name. What stays in
\`src/styles.css\` is global on purpose: the colors, the base tag styles and the
\`.muted\` helper. To use a global class name inside a module, write
\`:global(.name)\`.`,
  }
}
