import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'
import { type CreateEvent, createProject } from '../src/create.ts'
import { planProject } from '../src/generate.ts'
import {
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

describe('versions', () => {
  it('match the demo app, so new projects use versions this repo runs on', () => {
    const demo = JSON.parse(fs.readFileSync(new URL('../../../apps/demo/package.json', import.meta.url), 'utf8'))
    const demoVersions = { ...demo.dependencies, ...demo.devDependencies }
    for (const [name, range] of Object.entries(VERSIONS)) {
      if (name in demoVersions) assert.equal(range, demoVersions[name], name)
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
    assert.deepEqual(normalizeOptions({ name: 'a', addOns: ['husky', 'tailwind'] }, tmp).options.addOns, ['tailwind', 'husky'])
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
