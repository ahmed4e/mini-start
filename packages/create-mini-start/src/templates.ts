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

/** Runtime dependencies each choice brings (keys of VERSIONS). */
function runtimeDependencies(ctx: TemplateContext): Array<keyof typeof VERSIONS> {
  return [
    ...(ctx.pattern === 'web-components' ? (['lit'] as const) : []),
    ...(ctx.addOns.has('router') ? (['react-router'] as const) : []),
    ...(ctx.addOns.has('state') ? (['zustand'] as const) : []),
    ...(ctx.addOns.has('query') ? (['@tanstack/react-query'] as const) : []),
  ]
}

const TESTING_DEPENDENCIES = [
  '@testing-library/jest-dom',
  '@testing-library/react',
  '@testing-library/user-event',
  'jsdom',
  'vitest',
] as const

export function packageJson(ctx: TemplateContext): string {
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
  const testing = ctx.addOns.has('testing')
  if (testing) for (const name of TESTING_DEPENDENCIES) devDependencies[name] = VERSIONS[name]
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
      ...(testing ? { test: 'vitest run', 'test:watch': 'vitest' } : {}),
      // "prepare" runs after every install and points git at the hooks in .husky/.
      ...(quality ? { lint: 'oxlint', format: 'prettier --write .', prepare: 'husky' } : {}),
    },
    dependencies: sortKeys({
      react: VERSIONS.react,
      'react-dom': VERSIONS['react-dom'],
      ...Object.fromEntries(runtimeDependencies(ctx).map((name) => [name, VERSIONS[name]])),
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
  const testing = ctx.addOns.has('testing')
  return `${testing ? '/// <reference types="vitest/config" />\n' : ''}${
    tailwind ? "import tailwindcss from '@tailwindcss/vite'\n" : ''
  }import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()${tailwind ? ', tailwindcss()' : ''}],${
    testing
      ? `
  test: {
    // A browser-like DOM, so components can render in tests.
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
  },`
      : ''
  }
})
`
}

// ---------------------------------------------------------------------------
// Add-on: Docker + nginx

/** The port nginx listens on inside the container (an unprivileged one, so it needn't run as root). */
const CONTAINER_PORT = 8080

export function dockerfile(ctx: TemplateContext): string {
  const pm = ctx.packageManager
  // How each package manager installs exactly what its lockfile says.
  const build = {
    pnpm: {
      image: 'node:22-alpine',
      setup: 'RUN npm install --global pnpm@11\n',
      lockfile: 'pnpm-lock.yaml',
      install: 'pnpm install --frozen-lockfile',
    },
    npm: { image: 'node:22-alpine', setup: '', lockfile: 'package-lock.json', install: 'npm ci' },
    yarn: { image: 'node:22-alpine', setup: '', lockfile: 'yarn.lock', install: 'yarn install --frozen-lockfile' },
    bun: { image: 'oven/bun:1-alpine', setup: '', lockfile: 'bun.lock', install: 'bun install --frozen-lockfile' },
  }[pm]
  const env = ctx.addOns.has('env-errors')
    ? `
# VITE_ variables are read when the app is built, not when the container starts.
# Pass them with: docker build --build-arg VITE_API_URL=https://api.example.com .
ARG VITE_APP_NAME
ARG VITE_API_URL
`
    : ''
  return `# Stage 1: build the app. Nothing from this stage ends up in the final image
# except the files copied out of it below.
FROM ${build.image} AS build
WORKDIR /app
${build.setup}
# Install dependencies first: this layer is reused until the lockfile changes.
COPY package.json ${build.lockfile} ./
RUN ${build.install}

COPY . .
${env}RUN ${runCommand(pm, 'build')}

# Stage 2: serve the built files with nginx, running as a non-root user.
FROM nginxinc/nginx-unprivileged:stable-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE ${CONTAINER_PORT}
HEALTHCHECK --interval=30s --timeout=3s CMD wget -q --spider http://127.0.0.1:${CONTAINER_PORT}/healthz || exit 1
`
}

export function dockerignore(): string {
  return `# Keep the build context small, and keep local secrets out of the image.
node_modules
dist
.git
.husky
*.log
.DS_Store
.env
.env.*
!.env.example
Dockerfile
compose.yaml
`
}

export function nginxConf(ctx: TemplateContext): string {
  const headers = `add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;`
  return `# nginx serves the built app (the contents of dist/). The Dockerfile copies this
# file to /etc/nginx/conf.d/default.conf.
server {
  listen ${CONTAINER_PORT};
  server_name _;
  root /usr/share/nginx/html;
  index index.html;

  # Compress text responses.
  gzip on;
  gzip_comp_level 5;
  gzip_min_length 1024;
  gzip_types text/plain text/css application/javascript application/json image/svg+xml;

  # nginx only inherits add_header lines into a location that has none of its
  # own, so every location below repeats these three.
  ${headers.replace(/\n    /g, '\n  ')}

  # Files in /assets have a hash in their name (Vite adds it), so a new build
  # means new names. Browsers may keep them for a year.
  location /assets/ {
    expires 1y;
    add_header Cache-Control "public, immutable" always;
    ${headers}
    try_files $uri =404;
  }

  # For container health checks and load balancers.
  location = /healthz {
    access_log off;
    default_type text/plain;
    return 200 "ok\\n";
  }
${
  ctx.addOns.has('query')
    ? `
  # The starter's API is the JSON in public/api, served from dist/api. With a
  # real backend, forward /api to it instead:
  #
  # location /api/ {
  #   proxy_pass http://backend:3000/;
  #   proxy_set_header Host $host;
  #   proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  #   proxy_set_header X-Forwarded-Proto $scheme;
  # }
`
    : ''
}
  # Everything else: serve the file if it exists, otherwise index.html${
    ctx.addOns.has('router')
      ? `, so
  # the app's router handles the address (reloading /about must not be a 404).`
      : '.'
  }
  # index.html is never cached, so a new release shows up at once.
  location / {
    add_header Cache-Control "no-cache" always;
    ${headers}
    try_files $uri $uri/ /index.html;
  }
}
`
}

export function composeYaml(ctx: TemplateContext): string {
  return `# docker compose up --build   → http://localhost:${CONTAINER_PORT}
services:
  web:
    build:
      context: .${
        ctx.addOns.has('env-errors')
          ? `
      # VITE_ variables are baked in at build time. Uncomment to set them.
      # args:
      #   VITE_API_URL: https://api.example.com`
          : ''
      }
    image: ${ctx.name}
    ports:
      - '${CONTAINER_PORT}:${CONTAINER_PORT}'
    restart: unless-stopped
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

export function gitignore(ctx: TemplateContext): string {
  return `node_modules
dist
*.log
.DS_Store
${ctx.addOns.has('env-errors') ? '.env\n.env.*\n!.env.example\n' : ''}`
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
    <title>${ctx.name}</title>${
      ctx.addOns.has('theme')
        ? `
    <script>
      // Apply the remembered theme before the page paints, so it doesn't flash.
      try {
        const theme = localStorage.getItem('theme')
        if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme
      } catch {}
    </script>`
        : ''
    }
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`
}

/** What src/main.tsx needs beyond rendering <App />. */
export interface MainSpec {
  /** Import lines from packages, placed first. */
  packageImports: string[]
  /** Import lines from the project, placed after './App'. */
  localImports: string[]
  /** Statements that run once, before rendering. */
  setup: string[]
  /** [opening tag, closing tag] pairs wrapped around <App />, outermost first. */
  wrappers: Array<[open: string, close: string]>
}

export function mainTsx(spec: MainSpec): string {
  const lines = (list: string[]) => list.map((line) => `${line}\n`).join('')
  let tree = ['<App />']
  for (const [open, close] of [...spec.wrappers].reverse()) tree = [open, ...tree.map((line) => `  ${line}`), close]
  return `${lines(spec.packageImports)}import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
${lines(spec.localImports)}import './styles.css'

${spec.setup.length ? `${lines(spec.setup)}\n` : ''}createRoot(document.getElementById('root')!).render(
  <StrictMode>
${tree.map((line) => `    ${line}`).join('\n')}
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

/** The starter's layout rules whose selector starts with one of the given class selectors (".card", ...). */
export function layoutRules(selectors: string[]): string[] {
  return LAYOUT.split('\n\n').filter((rule) =>
    selectors.some((selector) => rule.startsWith(selector) && !/[\w-]/.test(rule.charAt(selector.length))),
  )
}

/**
 * src/styles.css. `globalSelectors` limits the layout rules to the ones that
 * stay global, for projects that style their components somewhere else
 * (CSS Modules, or inside custom elements).
 */
/**
 * The color tokens. With the theme toggle, <html data-theme="light|dark">
 * overrides what the device asks for.
 */
function tokensCss(ctx: TemplateContext): string {
  if (!ctx.addOns.has('theme')) return TOKENS
  const dark = /@media \(prefers-color-scheme: dark\) \{\n  :root \{\n([\s\S]*?)  \}\n\}/.exec(TOKENS)
  if (!dark) throw new Error('The dark color block is missing from TOKENS')
  const darkVars = dark[1]!.replace(/^    /gm, '  ')
  return TOKENS.replace(
    dark[0],
    `/* The device prefers dark, and the visitor hasn't chosen light. */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) {
${dark[1]}  }
}

/* The visitor's own choice, set by the theme toggle. */
:root[data-theme='light'] {
  color-scheme: light;
}

:root[data-theme='dark'] {
  color-scheme: dark;
${darkVars}}`,
  )
}

export function stylesCss(ctx: TemplateContext, patternCss?: string, globalSelectors?: string[]): string {
  const TOKENS = tokensCss(ctx)
  const layout = globalSelectors ? layoutRules(globalSelectors).join('\n\n') : LAYOUT
  const components = [layout, patternCss].filter(Boolean).join('\n\n')
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
  const testing = ctx.addOns.has('testing')
  const styles = [
    ...(ctx.addOns.has('tailwind') ? ['Tailwind CSS'] : []),
    ...(ctx.addOns.has('css-modules') ? ['CSS Modules'] : []),
  ]
  const styling = styles.length ? `, styled with ${styles.join(' and ')}` : ''

  return `# ${ctx.name}

A ${framework} app on Vite${styling}.

## Commands

\`\`\`bash
${run('dev')}          # dev server on http://localhost:5173
${run('build')}        # type-check, then build to dist/
${run('preview')}      # serve the built app locally
${run('typecheck')}    # type-check only${testing ? `\n${run('test')}         # run the tests once` : ''}
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
${
  ctx.addOns.has('docker')
    ? `## Docker

The \`Dockerfile\` builds the app with ${ctx.packageManager}, then copies the result into a small nginx
image. Only the built files and nginx end up in it, and nginx runs as a non-root user.

\`\`\`bash
docker compose up --build          # build and run: http://localhost:${CONTAINER_PORT}

docker build -t ${ctx.name} .       # or without Compose
docker run --rm -p ${CONTAINER_PORT}:${CONTAINER_PORT} ${ctx.name}
\`\`\`

\`nginx.conf\` is the server configuration: it compresses responses, lets browsers keep the hashed
files in \`/assets\` for a year, never caches \`index.html\`, answers \`/healthz\` for health checks, and
sends every other address to \`index.html\` so reloading a page works.

The build installs from \`${{ pnpm: 'pnpm-lock.yaml', npm: 'package-lock.json', yarn: 'yarn.lock', bun: 'bun.lock' }[ctx.packageManager]}\`, so install dependencies once and commit that file before
building the image.${
        ctx.addOns.has('env-errors')
          ? ` \`VITE_\` variables are fixed when the image is built; pass them with
\`--build-arg\`.`
          : ''
      }

`
    : ''
}## Other files

- \`index.html\`: the page Vite serves
- \`src/main.tsx\`: mounts the app
- \`src/App.tsx\`: the top of the component tree
- \`src/styles.css\`: colors and the starter styles
`
}
