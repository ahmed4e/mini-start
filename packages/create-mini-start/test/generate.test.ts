import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'
import { type CreateEvent, createProject } from '../src/create.ts'
import { DEMO_DIR, demoFiles, planDemo } from '../scripts/sync-demo.ts'
import { planProject } from '../src/generate.ts'
import {
  ADD_ON_GROUPS,
  ADD_ON_IDS,
  ADD_ONS,
  type AddOnId,
  checkTarget,
  normalizeOptions,
  type PackageManager,
  type PatternId,
  PATTERNS,
  suggestName,
  validateName,
} from '../src/options.ts'
import { VERSIONS } from '../src/versions.ts'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'create-mini-start-test-'))
after(() => fs.rmSync(tmp, { recursive: true, force: true }))

const plan = (pattern: PatternId = 'atomic', addOns: AddOnId[] = [], packageManager: PackageManager = 'pnpm') =>
  planProject({ name: 'x', framework: 'react', pattern, addOns, packageManager })
const byPath = (files: ReturnType<typeof planProject>) => new Map(files.map((f) => [f.path, f]))
const content = (files: ReturnType<typeof planProject>, file: string) => {
  const found = byPath(files).get(file)
  assert.ok(found, `expected ${file} to be generated`)
  return found.content
}

describe('demo app', () => {
  it('apps/demo is exactly what the generator produces (run `pnpm demo:sync` to update it)', () => {
    const planned = planDemo()
    assert.deepEqual(demoFiles(), planned.map((file) => file.path).sort())
    for (const file of planned) {
      assert.equal(fs.readFileSync(path.join(DEMO_DIR, file.path), 'utf8'), file.content, file.path)
    }
  })
})

describe('planProject', () => {
  it('generates the default (Atomic Design) starter', () => {
    const files = planProject({ name: 'blank-app', framework: 'react', pattern: 'atomic', addOns: [], packageManager: 'pnpm' })
    assert.deepEqual(files.map((f) => f.path).sort(), [
      '.gitignore',
      'README.md',
      'index.html',
      'package.json',
      'public/favicon.svg',
      'src/App.tsx',
      'src/components/atoms/Button.tsx',
      'src/components/atoms/Card.tsx',
      'src/components/molecules/Counter.tsx',
      'src/components/organisms/CounterCard.tsx',
      'src/components/organisms/Hero.tsx',
      'src/components/organisms/NextSteps.tsx',
      'src/components/organisms/SiteHeader.tsx',
      'src/components/pages/HomePage.tsx',
      'src/components/templates/PageLayout.tsx',
      'src/main.tsx',
      'src/styles.css',
      'tsconfig.json',
      'vite.config.ts',
    ])
    assert.match(content(files, 'index.html'), /<title>blank-app<\/title>/)
    assert.match(content(files, 'src/components/pages/HomePage.tsx'), /<Hero name="blank-app" \/>/)
  })

  it('contains only what was chosen: no framework copy and nothing from this tool', () => {
    for (const pattern of PATTERNS) {
      for (const pm of ['pnpm', 'npm', 'yarn', 'bun'] as const) {
        const files = plan(pattern.id, ['tailwind'], pm)
        for (const file of files) {
          assert.ok(!file.path.startsWith('vendor/'), file.path)
          assert.doesNotMatch(file.content, /mini-start/, `${pattern.id}: ${file.path}`)
        }
        const pkg = JSON.parse(content(files, 'package.json'))
        const expected = pattern.id === 'web-components' ? ['lit', 'react', 'react-dom'] : ['react', 'react-dom']
        assert.deepEqual(Object.keys(pkg.dependencies), expected)
        assert.equal(pkg.workspaces, undefined)
        assert.equal(byPath(files).has('pnpm-workspace.yaml'), false)
      }
    }
  })

  it('names the framework, add-ons and package manager in the README', () => {
    assert.match(content(plan('atomic', ['tailwind']), 'README.md'), /A React app on Vite, styled with Tailwind CSS\./)
    assert.doesNotMatch(content(plan('atomic', []), 'README.md'), /Tailwind/)
    assert.match(content(plan('atomic', [], 'npm'), 'README.md'), /npm run dev/)
  })

  it('wires Tailwind into Vite, the dependencies and the stylesheet only when chosen', () => {
    const files = plan('atomic', ['tailwind'])
    assert.match(content(files, 'vite.config.ts'), /plugins: \[react\(\), tailwindcss\(\)\]/)
    const pkg = JSON.parse(content(files, 'package.json'))
    assert.equal(pkg.devDependencies.tailwindcss, VERSIONS.tailwindcss)
    const css = content(files, 'src/styles.css')
    assert.ok(css.startsWith("@import 'tailwindcss';"))
    assert.match(css, /@layer components \{/)
    assert.match(content(files, 'src/components/organisms/NextSteps.tsx'), /Tailwind classes/)

    for (const file of plan('atomic', [])) assert.doesNotMatch(file.content, /tailwind/i, file.path)
  })

  it('CSS Modules: component styles move into .module.css files next to the components', () => {
    for (const pattern of PATTERNS) {
      const files = plan(pattern.id, ['css-modules'])
      const paths = new Set(files.map((f) => f.path))
      const modules = files.filter((f) => f.path.endsWith('.module.css'))
      assert.ok(modules.length > 0, pattern.id)
      for (const mod of modules) {
        assert.equal(mod.addOn, 'css-modules')
        const component = mod.path.replace(/\.module\.css$/, '.tsx')
        assert.ok(paths.has(component), `${mod.path} has no component`)
        const source = content(files, component)
        assert.match(source, /^import styles from '\.\/\w+\.module\.css'$/m, component)
        // Every class the component uses exists in its module.
        for (const match of source.matchAll(/\{styles\.(\w+)\}/g)) {
          assert.match(mod.content, new RegExp(`\\.${match[1]}[ :{,]`), `${component}: .${match[1]}`)
        }
      }
      // Only global helpers are left as string class names.
      for (const file of files.filter((f) => f.path.endsWith('.tsx'))) {
        for (const match of file.content.matchAll(/className="([^"]+)"/g)) {
          assert.ok(['muted', 'active', 'p-8 text-lg'].includes(match[1]!), `${pattern.id}: ${file.path} uses "${match[1]}"`)
        }
      }
      const css = content(files, 'src/styles.css')
      assert.doesNotMatch(css, /\.card|\.button|\.site-header|\.container|\.story/, pattern.id)
      assert.match(css, /\.muted \{/)
      assert.match(content(files, 'README.md'), /^## Styling: CSS Modules$/m)
    }

    const files = plan('atomic', ['css-modules'])
    assert.match(content(files, 'src/components/atoms/Card.tsx'), /className=\{styles\.card\}/)
    const header = content(files, 'src/components/organisms/SiteHeader.module.css')
    assert.match(header, /^\.header \{/m)
    assert.match(header, /a:global\(\.active\)/)
    assert.match(content(files, 'src/components/organisms/Hero.module.css'), /@keyframes rise/)
    assert.match(content(plan('component-driven', ['css-modules']), 'src/preview/ComponentGallery.module.css'), /^\.name \{/m)

    for (const file of plan('atomic', ['tailwind'])) {
      assert.ok(!file.path.endsWith('.module.css'), file.path)
      assert.doesNotMatch(file.content, /module\.css|CSS Modules/, file.path)
    }
  })

  it('adds the Husky + lint-staged hook, linter and formatter only when chosen', () => {
    const files = plan('atomic', ['husky'])
    const pkg = JSON.parse(content(files, 'package.json'))
    assert.equal(pkg.scripts.prepare, 'husky')
    assert.deepEqual(pkg['lint-staged']['*.{ts,tsx}'], ['oxlint --fix', 'prettier --write'])
    for (const name of ['husky', 'lint-staged', 'oxlint', 'prettier'] as const) {
      assert.equal(pkg.devDependencies[name], VERSIONS[name], name)
    }
    for (const file of ['.husky/pre-commit', '.oxlintrc.json', '.prettierrc.json', '.prettierignore']) {
      assert.equal(byPath(files).get(file)?.addOn, 'husky', file)
    }
    assert.match(content(files, 'README.md'), /^## Code quality$/m)

    const hook = (pm: PackageManager) => content(plan('atomic', ['husky'], pm), '.husky/pre-commit')
    assert.equal(hook('pnpm'), 'pnpm exec lint-staged\n')
    assert.equal(hook('npm'), 'npx lint-staged\n')
    assert.equal(hook('yarn'), 'yarn lint-staged\n')
    assert.equal(hook('bun'), 'bunx lint-staged\n')

    const without = plan('atomic', ['tailwind'])
    assert.equal(JSON.parse(content(without, 'package.json'))['lint-staged'], undefined)
    for (const file of without) {
      assert.ok(!file.path.startsWith('.husky'), file.path)
      assert.doesNotMatch(file.content, /husky|lint-staged|oxlint|prettier/i, file.path)
    }
  })
})

describe('design patterns', () => {
  it('every pattern has an App, an entry point and a guide in the README', () => {
    for (const pattern of PATTERNS) {
      const files = plan(pattern.id)
      assert.match(content(files, 'src/App.tsx'), /export function App\(\)/, pattern.id)
      assert.match(content(files, 'src/main.tsx'), /import \{ App \} from '\.\/App'/, pattern.id)
      assert.match(content(files, 'README.md'), /^## Structure: /m, pattern.id)
    }
  })

  it('every relative import in a generated file points at a generated file', () => {
    for (const pattern of PATTERNS) {
      const files = plan(pattern.id)
      const paths = new Set(files.map((f) => f.path))
      for (const file of files) {
        if (!/\.tsx?$/.test(file.path)) continue
        for (const match of file.content.matchAll(/from '(\.[^']*)'|^import '(\.[^']*)'/gm)) {
          const target = path.posix.join(path.posix.dirname(file.path), (match[1] ?? match[2])!)
          const candidates = [target, `${target}.ts`, `${target}.tsx`, `${target}/index.ts`]
          assert.ok(candidates.some((c) => paths.has(c)), `${pattern.id}: ${file.path} imports ${target}`)
        }
      }
    }
  })

  it('atomic: each level only imports from the levels below it', () => {
    const levels = ['atoms', 'molecules', 'organisms', 'templates', 'pages']
    for (const file of plan('atomic').filter((f) => f.path.startsWith('src/components/'))) {
      const own = levels.indexOf(file.path.split('/')[2]!)
      for (const match of file.content.matchAll(/from '\.\.\/(\w+)\//g)) {
        assert.ok(levels.indexOf(match[1]!) < own, `${file.path} imports from ${match[1]}`)
      }
    }
  })

  it('component-driven: a folder, index and stories per component, plus the gallery', () => {
    const files = plan('component-driven')
    const paths = files.map((f) => f.path)
    for (const file of ['Card/Card.tsx', 'Card/index.ts', 'Card/Card.stories.tsx']) {
      assert.ok(paths.includes(`src/components/${file}`), file)
    }
    assert.match(content(files, 'src/preview/ComponentGallery.tsx'), /import\.meta\.glob/)
    assert.match(content(files, 'src/App.tsx'), /#\/components/)
    assert.match(content(files, 'src/styles.css'), /\.story \{/)
  })

  it('smart-dumb: presentational components hold no state and never import containers', () => {
    const files = plan('smart-dumb')
    for (const file of files.filter((f) => f.path.startsWith('src/components/'))) {
      assert.doesNotMatch(file.content, /from '[^']*containers|useState|useEffect/, file.path)
    }
    assert.match(content(files, 'src/containers/CounterCard.tsx'), /useState/)
  })

  it('domain-driven: domains are imported through their index, and shared never imports a domain', () => {
    const files = plan('domain-driven')
    const app = content(files, 'src/App.tsx')
    assert.match(app, /from '\.\/domains\/counter'/)
    assert.match(app, /from '\.\/domains\/onboarding'/)
    assert.match(content(files, 'src/domains/counter/components/CounterCard.tsx'), /from '\.\.\/model'/)
    for (const file of files.filter((f) => f.path.startsWith('src/shared/'))) {
      assert.doesNotMatch(file.content, /domains/, file.path)
    }
  })

  it('web-components: Lit elements, the lit dependency and JSX types', () => {
    const files = plan('web-components', ['tailwind'])
    const pkg = JSON.parse(content(files, 'package.json'))
    assert.equal(pkg.dependencies.lit, VERSIONS.lit)
    assert.match(content(files, 'src/main.tsx'), /import '\.\/elements'/)
    assert.match(content(files, 'src/elements/app-counter.ts'), /<span>Clicked \$\{this\.count\} /)
    assert.match(content(files, 'src/elements/jsx.d.ts'), /'app-card': CustomElement/)
    const css = content(files, 'src/styles.css')
    assert.doesNotMatch(css, /\.site-header|\.card \{/)
    assert.match(css, /\.container \{/)
  })
})

describe('Docker + nginx add-on', () => {
  it('adds the container files only when chosen', () => {
    const files = plan('atomic', ['docker'])
    for (const file of ['Dockerfile', '.dockerignore', 'nginx.conf', 'compose.yaml']) {
      assert.equal(byPath(files).get(file)?.addOn, 'docker', file)
    }
    assert.match(content(files, 'README.md'), /^## Docker$/m)
    for (const file of plan('atomic', ['tailwind'])) {
      assert.doesNotMatch(file.path, /docker|nginx|compose/i)
      assert.doesNotMatch(file.content, /docker|nginx/i, file.path)
    }
  })

  it('builds with the chosen package manager and its lockfile', () => {
    const dockerfile = (pm: PackageManager) => content(plan('atomic', ['docker'], pm), 'Dockerfile')
    assert.match(dockerfile('pnpm'), /COPY package\.json pnpm-lock\.yaml \.\/\nRUN pnpm install --frozen-lockfile\n[\s\S]*RUN pnpm build/)
    assert.match(dockerfile('npm'), /COPY package\.json package-lock\.json \.\/\nRUN npm ci\n[\s\S]*RUN npm run build/)
    assert.match(dockerfile('yarn'), /RUN yarn install --frozen-lockfile\n[\s\S]*RUN yarn build/)
    assert.match(dockerfile('bun'), /^FROM oven\/bun:1-alpine AS build$/m)
    // Two stages: the final image is nginx with only the built files.
    assert.match(dockerfile('npm'), /FROM nginxinc\/nginx-unprivileged:stable-alpine\nCOPY nginx\.conf \/etc\/nginx\/conf\.d\/default\.conf\nCOPY --from=build \/app\/dist \/usr\/share\/nginx\/html/)
    assert.doesNotMatch(dockerfile('npm'), /pnpm|VITE_/)
  })

  it('nginx serves a single-page app on the port the container exposes', () => {
    const files = plan('atomic', ['docker', 'router', 'query', 'env-errors'])
    const conf = content(files, 'nginx.conf')
    assert.match(conf, /listen 8080;/)
    assert.match(conf, /location \/ \{[^}]*try_files \$uri \$uri\/ \/index\.html;/)
    assert.match(conf, /location \/assets\/ \{[^}]*immutable/)
    assert.match(conf, /location = \/healthz/)
    assert.match(conf, /# location \/api\/ \{/)
    assert.equal(conf.split('{').length, conf.split('}').length, 'balanced braces')
    assert.match(content(files, 'Dockerfile'), /EXPOSE 8080/)
    assert.match(content(files, 'Dockerfile'), /ARG VITE_API_URL\nRUN pnpm build/)
    assert.match(content(files, 'compose.yaml'), /- '8080:8080'/)
    assert.doesNotMatch(content(plan('atomic', ['docker']), 'nginx.conf'), /api|router/)
  })
})

describe('app add-ons', () => {
  const NEW: AddOnId[] = ['router', 'state', 'query', 'theme', 'env-errors', 'testing']
  const deps = (files: ReturnType<typeof planProject>) => {
    const pkg = JSON.parse(content(files, 'package.json'))
    return { ...pkg.dependencies, ...pkg.devDependencies } as Record<string, string>
  }
  const find = (files: ReturnType<typeof planProject>, suffix: string) => {
    const file = files.find((f) => f.path.endsWith(suffix))
    assert.ok(file, `expected a file ending in ${suffix}`)
    return file
  }

  it('each add-on brings its own dependencies and files, and nothing leaks without it', () => {
    const expected: Record<string, { deps: string[]; files: string[] }> = {
      router: { deps: ['react-router'], files: ['/AboutPage.tsx', '/NotFoundPage.tsx', '/HomePage.tsx'] },
      state: { deps: ['zustand'], files: [] },
      query: { deps: ['@tanstack/react-query'], files: ['/api.ts', '/useTips.ts', '/TipsCard.tsx', 'public/api/tips.json'] },
      theme: { deps: [], files: [] },
      'env-errors': { deps: [], files: ['/env.ts', '/ErrorBoundary.tsx', '/ErrorFallback.tsx', '.env.example', 'src/vite-env.d.ts'] },
      testing: { deps: ['vitest', 'jsdom', '@testing-library/react'], files: ['src/test/setup.ts'] },
    }
    for (const pattern of PATTERNS) {
      const none = plan(pattern.id)
      for (const addOn of NEW) {
        const files = plan(pattern.id, [addOn])
        for (const name of expected[addOn]!.deps) {
          assert.equal(deps(files)[name], VERSIONS[name as keyof typeof VERSIONS], `${pattern.id} ${addOn}: ${name}`)
          assert.equal(deps(none)[name], undefined, `${name} without ${addOn}`)
        }
        for (const suffix of expected[addOn]!.files) find(files, suffix)
        assert.ok(files.length > none.length, `${pattern.id} ${addOn} adds files`)
        assert.match(content(files, 'README.md'), /^## What the add-ons added$/m)
      }
      assert.doesNotMatch(content(none, 'README.md'), /What the add-ons added/)
    }
  })

  it('every relative import resolves with all add-ons, in every pattern, with and without CSS Modules', () => {
    for (const pattern of PATTERNS) {
      for (const extra of [[], ['css-modules', 'tailwind']] as AddOnId[][]) {
        const files = plan(pattern.id, [...NEW, ...extra])
        const paths = new Set(files.map((f) => f.path))
        for (const file of files) {
          if (!/\.tsx?$/.test(file.path)) continue
          for (const match of file.content.matchAll(/from '(\.[^']*)'|^import '(\.[^']*)'/gm)) {
            const target = path.posix.join(path.posix.dirname(file.path), (match[1] ?? match[2])!)
            const candidates = [target, `${target}.ts`, `${target}.tsx`, `${target}/index.ts`]
            assert.ok(candidates.some((c) => paths.has(c)), `${pattern.id}: ${file.path} imports ${target}`)
          }
        }
        if (extra.length) {
          for (const file of files.filter((f) => f.path.endsWith('.tsx') && !f.path.includes('.stories.'))) {
            for (const match of file.content.matchAll(/className="([^"]+)"/g)) {
              assert.ok(['muted', 'active', 'p-8 text-lg'].includes(match[1]!), `${pattern.id}: ${file.path} uses "${match[1]}"`)
            }
          }
        }
      }
    }
  })

  it('the patterns keep their rules with every add-on selected', () => {
    // Atomic: a level never imports from a higher one.
    const levels = ['atoms', 'molecules', 'organisms', 'templates', 'pages']
    for (const file of plan('atomic', NEW).filter((f) => f.path.startsWith('src/components/'))) {
      const own = levels.indexOf(file.path.split('/')[2]!)
      for (const match of file.content.matchAll(/from '\.\.\/(\w+)\//g)) {
        assert.ok(levels.indexOf(match[1]!) < own, `${file.path} imports from ${match[1]}`)
      }
    }
    // Smart-Dumb: presentational components hold no state and never reach into containers.
    const smartDumb = plan('smart-dumb', NEW)
    for (const file of smartDumb.filter((f) => f.path.startsWith('src/components/') && !f.path.includes('.test.'))) {
      assert.doesNotMatch(file.content, /from '[^']*containers|useState|useEffect|useQuery|useCounterStore/, file.path)
    }
    for (const name of ['CounterCard', 'TipsCard', 'ThemeToggle']) find(smartDumb, `src/containers/${name}.tsx`)
    // Domain-Driven: outside code goes through a domain's index; shared never imports a domain.
    const ddd = plan('domain-driven', NEW)
    assert.match(content(ddd, 'src/pages/HomePage.tsx'), /from '\.\.\/domains\/tips'/)
    assert.match(content(ddd, 'src/domains/counter/index.ts'), /export \{ useCounterStore \} from '\.\/store'/)
    assert.match(content(ddd, 'src/domains/counter/store.ts'), /from '\.\/model'/)
    for (const file of ddd.filter((f) => f.path.startsWith('src/shared/'))) {
      assert.doesNotMatch(file.content, /domains/, file.path)
    }
    for (const file of ddd.filter((f) => /^src\/(pages|App)/.test(f.path))) {
      assert.doesNotMatch(file.content, /domains\/\w+\//, `${file.path} reaches inside a domain`)
    }
    // Component-Driven: every component folder has an index; the gallery is a route.
    const cdd = plan('component-driven', NEW)
    for (const name of ['ThemeToggle', 'TipList', 'TipsCard', 'ErrorFallback']) {
      find(cdd, `src/components/${name}/index.ts`)
      find(cdd, `src/components/${name}/${name}.stories.tsx`)
    }
    assert.match(content(cdd, 'src/App.tsx'), /<Route path="\/components" element=\{<ComponentGallery \/>\} \/>/)
    assert.doesNotMatch(content(cdd, 'src/App.tsx'), /hashchange/)
    // Web Components: the toggle and counter are elements, wired to the React side.
    const wc = plan('web-components', NEW)
    find(wc, 'src/elements/app-theme-toggle.ts')
    find(wc, 'src/elements/app-counter.test.ts')
    assert.match(content(wc, 'src/elements/index.ts'), /'app-theme-toggle': AppThemeToggle,/)
    assert.match(content(wc, 'src/pages/HomePage.tsx'), /oncount-changed=\{\(event\) => setCount\(event\.detail\)\}/)
    assert.ok(!wc.some((f) => f.path.endsWith('/useTheme.ts')))
  })

  it('wires the providers, config and theme colors', () => {
    const files = plan('atomic', NEW)
    const main = content(files, 'src/main.tsx')
    assert.match(main, /<ErrorBoundary>\n {6}<QueryClientProvider client=\{queryClient\}>\n {8}<App \/>/)
    assert.match(content(files, 'vite.config.ts'), /^\/\/\/ <reference types="vitest\/config" \/>/)
    assert.match(content(files, 'vite.config.ts'), /environment: 'jsdom'/)
    const pkg = JSON.parse(content(files, 'package.json'))
    assert.equal(pkg.scripts.test, 'vitest run')
    assert.match(content(files, 'index.html'), /localStorage\.getItem\('theme'\)/)
    const css = content(files, 'src/styles.css')
    assert.match(css, /:root:not\(\[data-theme='light'\]\) \{/)
    assert.match(css, /:root\[data-theme='dark'\] \{\n {2}color-scheme: dark;\n {2}--bg: #0b0b0d;/)
    assert.match(content(files, '.gitignore'), /^\.env$/m)
    assert.match(find(files, '/api.ts').content, /env\.apiUrl/)
    assert.doesNotMatch(find(plan('atomic', ['query']), '/api.ts').content, /from '[^']*env'/)
    // Without the add-ons, none of this appears.
    const none = plan('atomic')
    assert.doesNotMatch(content(none, 'src/styles.css'), /data-theme/)
    assert.doesNotMatch(content(none, 'index.html'), /<script>\n/)
    assert.equal(JSON.parse(content(none, 'package.json')).scripts.test, undefined)
  })

  it('every add-on id is in the catalog with a group', () => {
    assert.deepEqual(ADD_ONS.map((a) => a.id), [...ADD_ON_IDS])
    for (const addOn of ADD_ONS) assert.ok(ADD_ON_GROUPS.includes(addOn.group), addOn.id)
  })
})

describe('options', () => {
  it('validates project names', () => {
    assert.equal(validateName('my-app'), null)
    assert.equal(validateName('app.v2_beta~1'), null)
    assert.match(validateName('') ?? '', /name/)
    assert.match(validateName('My-App') ?? '', /lowercase/)
    assert.match(validateName('-app') ?? '', /Start with/)
    assert.match(validateName('my app') ?? '', /only/)
    assert.match(validateName('../escape') ?? '', /Start with/)
    assert.match(validateName('a/b') ?? '', /only/)
  })

  it('normalizes untrusted input', () => {
    const { options, errors } = normalizeOptions(
      {
        name: ' ok-name ',
        parentDir: 'projects',
        framework: 'solid',
        pattern: 'mvc',
        addOns: ['api-route', 'nope', 'tailwind'],
        packageManager: 'rm -rf',
        git: false,
      },
      tmp,
    )
    assert.deepEqual(errors, {})
    assert.equal(options.name, 'ok-name')
    assert.equal(options.parentDir, path.join(tmp, 'projects'))
    assert.equal(options.framework, 'react')
    assert.equal(options.pattern, 'atomic')
    assert.deepEqual(options.addOns, ['tailwind'])
    assert.deepEqual(normalizeOptions({ name: 'a', addOns: ['husky', 'css-modules', 'tailwind'] }, tmp).options.addOns, [
      'tailwind',
      'css-modules',
      'husky',
    ])
    assert.equal(options.packageManager, 'npm')
    assert.equal(options.install, true)
    assert.equal(options.git, false)
  })

  it('refuses a non-empty target folder and suggests a free name', () => {
    fs.mkdirSync(path.join(tmp, 'taken'))
    fs.writeFileSync(path.join(tmp, 'taken/file.txt'), 'x')
    fs.mkdirSync(path.join(tmp, 'empty'))
    assert.equal(checkTarget({ name: 'taken', parentDir: tmp }).status, 'not-empty')
    assert.equal(checkTarget({ name: 'empty', parentDir: tmp }).status, 'ok')
    assert.match(normalizeOptions({ name: 'taken', parentDir: tmp }, tmp).errors.name ?? '', /not empty/)
    assert.equal(suggestName(tmp, 'taken'), 'taken-2')
  })
})

describe('createProject', () => {
  it('writes exactly the planned files and reports each step', async () => {
    const events: CreateEvent[] = []
    const choices = { name: 'written', framework: 'react', pattern: 'atomic', packageManager: 'pnpm' } as const
    const addOns: AddOnId[] = ['tailwind']
    const ok = await createProject(
      { ...choices, addOns, parentDir: tmp, install: false, git: false },
      (event) => events.push(event),
      tmp,
    )
    assert.equal(ok, true)
    const dir = path.join(tmp, 'written')
    const planned = planProject({ ...choices, addOns })
    for (const file of planned) assert.equal(fs.readFileSync(path.join(dir, file.path), 'utf8'), file.content)
    const written = fs
      .readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile()).length
    assert.equal(written, planned.length)

    const steps = events.filter((e) => e.type === 'step').map((e) => `${e.step}:${e.status}`)
    assert.deepEqual(steps, ['files:running', 'files:done', 'install:skipped', 'git:skipped'])
    const done = events.at(-1)
    assert.equal(done?.type, 'done')
    assert.deepEqual(done?.type === 'done' && done.nextSteps, ['cd written', 'pnpm install', 'pnpm dev'])
  })

  it('stops before writing anything into a non-empty folder', async () => {
    const events: CreateEvent[] = []
    const ok = await createProject(
      { name: 'taken', parentDir: tmp, framework: 'react', pattern: 'atomic', addOns: [], packageManager: 'npm', install: false, git: false },
      (event) => events.push(event),
    )
    assert.equal(ok, false)
    assert.deepEqual(fs.readdirSync(path.join(tmp, 'taken')), ['file.txt'])
    assert.equal(events[0]?.type, 'error')
  })
})
