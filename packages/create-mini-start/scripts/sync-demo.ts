/**
 * Regenerates apps/demo from the generator: a project with the default
 * design pattern and every add-on. Run it with `pnpm demo:sync` after
 * changing what the builder generates; a test fails while the two differ.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { planProject } from '../src/generate.ts'
import { ADD_ON_IDS, type AddOnId, DEFAULT_FRAMEWORK, DEFAULT_PATTERN } from '../src/options.ts'

export const DEMO_DIR = fileURLToPath(new URL('../../../apps/demo/', import.meta.url))

/**
 * Every add-on except the two that only work at the top of their own
 * repository: Husky (its git hook) and Docker (its build needs the project's
 * own lockfile, and the demo shares this repo's).
 */
export const DEMO_ADD_ONS: AddOnId[] = ADD_ON_IDS.filter((id) => id !== 'husky' && id !== 'docker')

export function planDemo() {
  return planProject({
    name: 'demo',
    framework: DEFAULT_FRAMEWORK,
    pattern: DEFAULT_PATTERN,
    addOns: DEMO_ADD_ONS,
    packageManager: 'pnpm',
  })
}

/** Files in apps/demo that the generator owns: everything except installs and build output. */
export function demoFiles(dir = DEMO_DIR): string[] {
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'))
    .filter((file) => !/^(node_modules|dist)\//.test(file))
    .sort()
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const planned = planDemo()
  const keep = new Set(planned.map((file) => file.path))
  for (const file of demoFiles()) if (!keep.has(file)) fs.rmSync(path.join(DEMO_DIR, file))
  for (const file of planned) {
    const target = path.join(DEMO_DIR, file.path)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, file.content)
  }
  console.log(`apps/demo: wrote ${planned.length} files (add-ons: ${DEMO_ADD_ONS.join(', ')})`)
}
