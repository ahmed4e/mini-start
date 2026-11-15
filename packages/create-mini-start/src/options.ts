/**
 * What a user can choose when creating a project, and the validation shared
 * by the terminal prompts and the browser UI.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const PACKAGE_MANAGERS = ['pnpm', 'npm', 'yarn', 'bun'] as const
export type PackageManager = (typeof PACKAGE_MANAGERS)[number]

/** UI frameworks a project can be built with. Only React for now; more will follow. */
export const FRAMEWORK_IDS = ['react'] as const
export type FrameworkId = (typeof FRAMEWORK_IDS)[number]

export interface Framework {
  id: FrameworkId
  name: string
  description: string
}

export const FRAMEWORKS: Framework[] = [
  {
    id: 'react',
    name: 'React',
    description: 'React 19 with TypeScript, built and served by Vite.',
  },
]

export const DEFAULT_FRAMEWORK: FrameworkId = 'react'

/**
 * How the starter's components are organized. Every pattern renders the same
 * pages; what changes is the folder structure and how the pieces depend on
 * each other.
 */
export const PATTERN_IDS = ['atomic', 'component-driven', 'smart-dumb', 'domain-driven', 'web-components'] as const
export type PatternId = (typeof PATTERN_IDS)[number]

export interface Pattern {
  id: PatternId
  name: string
  bestFor: string
  learningCurve: string
  description: string
}

export const PATTERNS: Pattern[] = [
  {
    id: 'atomic',
    name: 'Atomic Design',
    bestFor: 'Design systems, component libraries',
    learningCurve: 'Medium',
    description: 'Components in atoms, molecules, organisms, templates and pages.',
  },
  {
    id: 'component-driven',
    name: 'Component-Driven (CDD)',
    bestFor: 'Component isolation and previews',
    learningCurve: 'Low',
    description: 'One folder per component with its stories, and a gallery page that previews them.',
  },
  {
    id: 'smart-dumb',
    name: 'Smart-Dumb Components',
    bestFor: 'Separation of logic and presentation',
    learningCurve: 'Medium',
    description: 'Presentational components that only take props, and containers that own data and state.',
  },
  {
    id: 'domain-driven',
    name: 'Domain-Driven Frontend (DDD)',
    bestFor: 'Aligning frontend with business logic',
    learningCurve: 'High',
    description: 'Code grouped by business domain, each with a public index, plus a shared UI folder.',
  },
  {
    id: 'web-components',
    name: 'Web Components (Lit)',
    bestFor: 'Cross-framework component reuse',
    learningCurve: 'Medium-High',
    description: 'UI built as Lit custom elements that any framework can use, composed by React.',
  },
]

export const DEFAULT_PATTERN: PatternId = 'atomic'

/** Optional extras on top of the starter. More will follow. */
export const ADD_ON_IDS = [
  'tailwind',
  'css-modules',
  'router',
  'state',
  'query',
  'theme',
  'env-errors',
  'testing',
  'husky',
  'docker',
] as const
export type AddOnId = (typeof ADD_ON_IDS)[number]

export const ADD_ON_GROUPS = ['Styling', 'App', 'Quality', 'Deploy'] as const
export type AddOnGroup = (typeof ADD_ON_GROUPS)[number]

export interface AddOn {
  id: AddOnId
  group: AddOnGroup
  name: string
  description: string
}

export const ADD_ONS: AddOn[] = [
  {
    id: 'tailwind',
    group: 'Styling',
    name: 'Tailwind CSS',
    description: 'Tailwind v4 via its Vite plugin. Starter styles live in CSS layers, so utility classes override them.',
  },
  {
    id: 'css-modules',
    group: 'Styling',
    name: 'CSS Modules',
    description: 'Each component gets its own .module.css file. Class names and animations are local to that file.',
  },
  {
    id: 'router',
    group: 'App',
    name: 'Routing',
    description: 'React Router with Home, About and "not found" pages, and header links that show the current page.',
  },
  {
    id: 'state',
    group: 'App',
    name: 'State management',
    description: 'Zustand: a small typed store, with the starter counter moved into it as the example.',
  },
  {
    id: 'query',
    group: 'App',
    name: 'Data fetching',
    description: 'TanStack Query: a typed fetch helper and an example query with loading and error states.',
  },
  {
    id: 'theme',
    group: 'App',
    name: 'Theme toggle',
    description: 'A light / dark / system switch in the header that remembers the choice.',
  },
  {
    id: 'env-errors',
    group: 'App',
    name: 'Env + error handling',
    description: 'Typed environment variables with a .env.example, and an error boundary with a fallback screen.',
  },
  {
    id: 'testing',
    group: 'Quality',
    name: 'Testing',
    description: 'Vitest and React Testing Library, with test scripts and one example test.',
  },
  {
    id: 'husky',
    group: 'Quality',
    name: 'Husky + lint-staged',
    description: 'A pre-commit hook that lints (Oxlint) and formats (Prettier) the files you are committing.',
  },
  {
    id: 'docker',
    group: 'Deploy',
    name: 'Docker + nginx',
    description: 'A Dockerfile that builds the app and serves it with nginx, an nginx config, and a Compose file.',
  },
]

export const DEFAULT_ADD_ONS: AddOnId[] = ['tailwind']

export interface ProjectOptions {
  /** npm package name, also used as the folder name. */
  name: string
  /** Absolute path of the folder the project folder is created in. */
  parentDir: string
  framework: FrameworkId
  pattern: PatternId
  addOns: AddOnId[]
  packageManager: PackageManager
  install: boolean
  git: boolean
}

export const DEFAULT_NAME = 'my-app'

/** Returns an error message, or null when the name is usable as a package and folder name. */
export function validateName(name: string): string | null {
  if (!name) return 'Give your project a name.'
  if (name.length > 214) return 'Keep the name under 214 characters.'
  if (/[A-Z]/.test(name)) return 'Use lowercase letters only.'
  if (!/^[a-z0-9]/.test(name)) return 'Start with a letter or a digit.'
  if (!/^[a-z0-9][a-z0-9._~-]*$/.test(name)) return 'Use only letters, digits, "-", "_", "." and "~".'
  if (name === 'node_modules' || name === 'favicon.ico') return `"${name}" is a reserved name.`
  return null
}

export type TargetStatus = 'ok' | 'not-empty' | 'is-file' | 'bad-parent'

export interface TargetCheck {
  dir: string
  status: TargetStatus
  message: string | null
}

export function resolveParentDir(input: string, base: string): string {
  const expanded = input === '~' || input.startsWith('~/') ? path.join(os.homedir(), input.slice(1)) : input
  return path.resolve(base, expanded || '.')
}

export function targetDir(options: Pick<ProjectOptions, 'name' | 'parentDir'>): string {
  return path.join(options.parentDir, options.name)
}

/** The project folder may not exist yet, or may exist and be empty. */
export function checkTarget(options: Pick<ProjectOptions, 'name' | 'parentDir'>): TargetCheck {
  const dir = targetDir(options)
  const parent = statOrNull(options.parentDir)
  if (parent && !parent.isDirectory()) {
    return { dir, status: 'bad-parent', message: `${options.parentDir} is a file, not a folder.` }
  }
  const stat = statOrNull(dir)
  if (!stat) return { dir, status: 'ok', message: null }
  if (!stat.isDirectory()) return { dir, status: 'is-file', message: `${dir} is a file.` }
  if (fs.readdirSync(dir).length > 0) {
    return { dir, status: 'not-empty', message: `${dir} already exists and is not empty.` }
  }
  return { dir, status: 'ok', message: null }
}

/** First of my-app, my-app-2, ... that doesn't clash in `parentDir`. */
export function suggestName(parentDir: string, base = DEFAULT_NAME): string {
  for (let i = 1; i < 100; i++) {
    const name = i === 1 ? base : `${base}-${i}`
    if (checkTarget({ name, parentDir }).status === 'ok') return name
  }
  return base
}

/** Turns untrusted input (a request body, CLI flags) into valid options, or a list of problems. */
export function normalizeOptions(
  input: unknown,
  base: string,
): { options: ProjectOptions; errors: Partial<Record<'name' | 'parentDir', string>> } {
  const raw = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>
  const name = typeof raw.name === 'string' ? raw.name.trim() : ''
  const parentDir = resolveParentDir(typeof raw.parentDir === 'string' ? raw.parentDir.trim() : '', base)
  const framework = FRAMEWORK_IDS.find((id) => id === raw.framework) ?? DEFAULT_FRAMEWORK
  const pattern = PATTERN_IDS.find((id) => id === raw.pattern) ?? DEFAULT_PATTERN
  const requested = Array.isArray(raw.addOns) ? raw.addOns : []
  const addOns = ADD_ON_IDS.filter((id) => requested.includes(id))
  const packageManager = PACKAGE_MANAGERS.find((pm) => pm === raw.packageManager) ?? 'npm'
  const options: ProjectOptions = {
    name,
    parentDir,
    framework,
    pattern,
    addOns,
    packageManager,
    install: raw.install !== false,
    git: raw.git !== false,
  }

  const errors: Partial<Record<'name' | 'parentDir', string>> = {}
  const nameError = validateName(name)
  if (nameError) errors.name = nameError
  else {
    const target = checkTarget(options)
    if (target.status === 'bad-parent') errors.parentDir = target.message ?? undefined
    else if (target.message) errors.name = target.message
  }
  return { options, errors }
}

function statOrNull(file: string): fs.Stats | null {
  try {
    return fs.statSync(file)
  } catch {
    return null
  }
}
