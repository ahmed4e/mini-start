/**
 * The contents of every file a new project can contain. Each function takes
 * the user's choices and returns source text; generate.ts decides which files
 * are written.
 *
 * Generated code that itself contains template literals escapes them as
 * \` and \${ so they survive this file's own template literals.
 */
import { type AddOnId, type FrameworkId, FRAMEWORKS, type PackageManager, type PatternId } from './options.ts'
import { VERSIONS } from './versions.ts'

export interface TemplateContext {
  name: string
  /** Every template here is for React, the only framework so far. */
  framework: FrameworkId
  /** How the starter's components are organized; see patterns.ts. */
  pattern: PatternId
  addOns: ReadonlySet<AddOnId>
  packageManager: PackageManager
}

/** `pnpm dev`, `npm run dev`, ... */
export function runCommand(pm: PackageManager, script: string): string {
  return pm === 'npm' || pm === 'bun' ? `${pm} run ${script}` : `${pm} ${script}`
}

function sortKeys(record: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)))
}

export function packageJson(ctx: TemplateContext, extraDependencies: string[] = []): string {
  const devDependencies: Record<string, string> = {
    '@types/react': VERSIONS['@types/react'],
    '@types/react-dom': VERSIONS['@types/react-dom'],
    '@vitejs/plugin-react': VERSIONS['@vitejs/plugin-react'],
    typescript: VERSIONS.typescript,
    vite: VERSIONS.vite,
  }
  if (ctx.addOns.has('tailwind')) {
    devDependencies.tailwindcss = VERSIONS.tailwindcss
    devDependencies['@tailwindcss/vite'] = VERSIONS['@tailwindcss/vite']
  }
  const quality = ctx.addOns.has('husky')
  if (quality) {
    for (const name of ['husky', 'lint-staged', 'oxlint', 'prettier'] as const) devDependencies[name] = VERSIONS[name]
  }
  const pkg = {
    name: ctx.name,
    private: true,
    type: 'module',
    scripts: {
      dev: 'vite',
      build: 'tsc --noEmit && vite build',
      preview: 'vite preview',
      typecheck: 'tsc --noEmit',
      // "prepare" runs after every install and points git at the hooks in .husky/.
      ...(quality ? { lint: 'oxlint', format: 'prettier --write .', prepare: 'husky' } : {}),
    },
    dependencies: sortKeys({
      react: VERSIONS.react,
      'react-dom': VERSIONS['react-dom'],
      ...Object.fromEntries(extraDependencies.map((name) => [name, VERSIONS[name as keyof typeof VERSIONS]])),
    }),
    devDependencies: sortKeys(devDependencies),
    // What the pre-commit hook runs, on staged files only.
    ...(quality
      ? {
          'lint-staged': {
            '*.{ts,tsx}': ['oxlint --fix', 'prettier --write'],
            '*.{css,html,json,md}': 'prettier --write',
          },
        }
      : {}),
  }
  return `${JSON.stringify(pkg, null, 2)}\n`
}

export function tsconfigJson(): string {
  return `${JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2022',
        lib: ['ES2023', 'DOM', 'DOM.Iterable'],
        module: 'ESNext',
        moduleResolution: 'bundler',
        jsx: 'react-jsx',
        strict: true,
        noUncheckedIndexedAccess: true,
        noEmit: true,
        allowImportingTsExtensions: true,
        verbatimModuleSyntax: true,
        skipLibCheck: true,
        types: ['vite/client'],
      },
      include: ['src', 'vite.config.ts'],
    },
    null,
    2,
  )}\n`
}

export function viteConfig(ctx: TemplateContext): string {
  const tailwind = ctx.addOns.has('tailwind')
  return `${tailwind ? "import tailwindcss from '@tailwindcss/vite'\n" : ''}import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()${tailwind ? ', tailwindcss()' : ''}],
})
`
}

// ---------------------------------------------------------------------------
// Add-on: Husky + lint-staged

/** .husky/pre-commit: git runs this before each commit; a failure stops the commit. */
export function huskyPreCommit(pm: PackageManager): string {
  const run = { pnpm: 'pnpm exec', npm: 'npx', yarn: 'yarn', bun: 'bunx' }[pm]
  return `${run} lint-staged\n`
}

/**
 * Oxlint instead of ESLint: ESLint's TypeScript plugin does not support the
 * TypeScript version new projects use.
 */
export function oxlintConfig(): string {
  return `${JSON.stringify(
    {
      $schema: './node_modules/oxlint/configuration_schema.json',
      plugins: ['typescript', 'react', 'oxc'],
      categories: { correctness: 'error', suspicious: 'warn' },
      rules: { 'react/react-in-jsx-scope': 'off' },
      ignorePatterns: ['dist'],
    },
    null,
    2,
  )}\n`
}

export function prettierConfig(): string {
  return `${JSON.stringify({ semi: false, singleQuote: true, printWidth: 110 }, null, 2)}\n`
}

export function prettierIgnore(): string {
  return `dist
pnpm-lock.yaml
package-lock.json
yarn.lock
bun.lock
`
}

export function gitignore(): string {
  return `node_modules
dist
*.log
.DS_Store
`
}

export function faviconSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#0f766e"/><path d="M8 22V10l8 7 8-7v12" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>
`
}

export function indexHtml(ctx: TemplateContext): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <title>${ctx.name}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`
}

export function mainTsx(extraImports: string[] = []): string {
  return `import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
${extraImports.map((line) => `${line}\n`).join('')}import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
`
}

// ---------------------------------------------------------------------------
// Styles. One set of rules; with Tailwind they are wrapped in CSS layers so
// utility classes (in the later "utilities" layer) can override them.

const TOKENS = `:root {
  color-scheme: light dark;
  --bg: #f7f7f8;
  --surface: #ffffff;
  --text: #18181b;
  --muted: #6b7280;
  --border: #e4e4e7;
  --accent: #0f766e;
  --accent-soft: #ccfbf1;
  --on-accent: #ffffff;
  --danger: #be123c;
  font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;
  line-height: 1.55;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0b0b0d;
    --surface: #16161a;
    --text: #ececef;
    --muted: #9b9ba5;
    --border: #2a2a31;
    --accent: #2dd4bf;
    --accent-soft: #123b37;
    --on-accent: #042f2e;
    --danger: #fb7185;
  }
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
}

h1,
h2,
h3 {
  margin: 0 0 0.5rem;
  line-height: 1.2;
}

h1 {
  font-size: 2rem;
  font-weight: 700;
}

h2 {
  font-size: 1.3rem;
  font-weight: 650;
}

h3 {
  font-size: 1.05rem;
  font-weight: 600;
}

p {
  margin: 0.5rem 0;
}

a {
  color: var(--accent);
  text-decoration: underline;
  text-underline-offset: 0.15em;
}

button,
input {
  font: inherit;
}

code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.9em;
  background: var(--accent-soft);
  padding: 0.05em 0.35em;
  border-radius: 4px;
}`

const LAYOUT = `.site-header {
  display: flex;
  align-items: center;
  gap: 1.5rem;
  padding: 0.9rem 1.5rem;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
}

.brand {
  font-weight: 700;
  color: var(--text);
  text-decoration: none;
}

.site-header nav {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
}

.site-header nav a {
  color: var(--muted);
  text-decoration: none;
}

.site-header nav a:hover,
.site-header nav a.active {
  color: var(--text);
}

.container {
  display: grid;
  gap: 1.25rem;
  max-width: 960px;
  margin: 0 auto;
  padding: 2rem 1.5rem 4rem;
}

.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 1.25rem 1.5rem;
}

.hero h1 {
  font-size: clamp(1.8rem, 4vw, 2.6rem);
}

.hero p {
  max-width: 60ch;
}

.muted {
  color: var(--muted);
}

.steps {
  display: grid;
  gap: 0.4rem;
  margin: 0;
  padding-left: 1.2rem;
  list-style: disc;
}

.button {
  padding: 0.55rem 1rem;
  border: 0;
  border-radius: 8px;
  background: var(--accent);
  color: var(--on-accent);
  cursor: pointer;
}

.button:hover {
  filter: brightness(1.1);
}

.counter {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 1rem;
  margin-top: 0.75rem;
}`

function indent(css: string): string {
  return css
    .split('\n')
    .map((line) => (line ? `  ${line}` : line))
    .join('\n')
}

/** The layout rules that still apply when custom elements style the header, cards and hero themselves. */
const PAGE_ONLY = ['.brand', '.container', '.muted', '.steps']

export function stylesCss(ctx: TemplateContext, patternCss?: string): string {
  const layout =
    ctx.pattern === 'web-components'
      ? LAYOUT.split('\n\n')
          .filter((rule) => PAGE_ONLY.some((selector) => rule.startsWith(`${selector} {`)))
          .join('\n\n')
      : LAYOUT
  const components = patternCss ? `${layout}\n\n${patternCss}` : layout
  if (!ctx.addOns.has('tailwind')) return `${TOKENS}\n\n${components}\n`
  return `@import 'tailwindcss';

/*
 * The starter styles sit in Tailwind's base and components layers, so any
 * utility class you add (className="p-8 text-lg") wins over them.
 */
@layer base {
${indent(TOKENS)}
}

@layer components {
${indent(components)}
}
`
}

// ---------------------------------------------------------------------------
// Docs

export function readme(ctx: TemplateContext, patternGuide: string): string {
  const run = (script: string) => runCommand(ctx.packageManager, script)
  const framework = FRAMEWORKS.find((f) => f.id === ctx.framework)?.name ?? ctx.framework
  const styling = ctx.addOns.has('tailwind') ? ', styled with Tailwind CSS' : ''

  return `# ${ctx.name}

A ${framework} app on Vite${styling}.

## Commands

\`\`\`bash
${run('dev')}          # dev server on http://localhost:5173
${run('build')}        # type-check, then build to dist/
${run('preview')}      # serve the built app locally
${run('typecheck')}    # type-check only
\`\`\`

${patternGuide}
${
  ctx.addOns.has('husky')
    ? `
## Code quality

Every \`git commit\` first runs [lint-staged](https://github.com/lint-staged/lint-staged) through a
[Husky](https://typicode.github.io/husky/) pre-commit hook. It checks only the files you are
committing:

- \`.ts\` and \`.tsx\`: \`oxlint --fix\`, then \`prettier --write\`
- \`.css\`, \`.html\`, \`.json\`, \`.md\`: \`prettier --write\`

If the linter finds an error it can't fix, the commit stops. The file list is under
\`"lint-staged"\` in \`package.json\`, the hook is \`.husky/pre-commit\`, and the rules are in
\`.oxlintrc.json\` and \`.prettierrc.json\`. To check everything by hand, run \`${run('lint')}\`
or \`${run('format')}\`.

The hook is switched on by \`${ctx.packageManager} install\` inside a git repository. If you created the
project without git, run \`git init\` and install again.
`
    : ''
}
## Other files

- \`index.html\`: the page Vite serves
- \`src/main.tsx\`: mounts the app
- \`src/App.tsx\`: the top of the component tree
- \`src/styles.css\`: colors and the starter styles
`
}
