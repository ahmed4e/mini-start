#!/usr/bin/env node
/**
 * create-mini-start: make a new mini-start app.
 *
 *   create-mini-start --ui            choose everything in a browser UI
 *   create-mini-start my-app          choose in the terminal (arrow keys, space, enter)
 *   create-mini-start my-app -y       accept the defaults
 */
import { parseArgs, styleText } from 'node:util'
import * as p from '@clack/prompts'
import { createProject, type CreateEvent, STEP_LABELS } from './create.ts'
import { detectEnvironment, invokingPackageManager } from './env.ts'
import { toolVersion } from './generate.ts'
import {
  ADD_ON_IDS,
  ADD_ONS,
  type AddOnId,
  checkTarget,
  DEFAULT_ADD_ONS,
  DEFAULT_FRAMEWORK,
  DEFAULT_PATTERN,
  FRAMEWORK_IDS,
  type FrameworkId,
  FRAMEWORKS,
  PACKAGE_MANAGERS,
  type PackageManager,
  PATTERN_IDS,
  type PatternId,
  PATTERNS,
  type ProjectOptions,
  resolveParentDir,
  suggestName,
  targetDir,
  validateName,
} from './options.ts'
import { startUi } from './ui-server.ts'

const HELP = `
Usage: create-mini-start [name] [options]

Without flags, you pick each option from a list in the terminal.

Options:
  --ui                Pick everything in a project builder in your browser
  --framework <name>  Framework: ${FRAMEWORK_IDS.join(', ')} (default ${DEFAULT_FRAMEWORK})
  --pattern <name>    Design pattern: ${PATTERN_IDS.join(', ')}
                      (default ${DEFAULT_PATTERN})
  --add-ons <list>    Comma-separated: ${ADD_ON_IDS.join(', ')} (or "none")
  --pm <name>         Package manager: ${PACKAGE_MANAGERS.join(', ')}
  --dir <path>        Folder to create the project in (default: current folder)
  --no-install        Don't install dependencies
  --no-git            Don't initialize a git repository
  -y, --yes           Use defaults instead of asking
  --port <n>          Port for --ui (default 4600)
  --no-open           With --ui, don't open the browser
  -h, --help          Show this help
`

type Style = Parameters<typeof styleText>[0]
const style = (format: Style) => (text: string) => styleText(format, text, { stream: process.stdout })
const bold = style('bold')
const dim = style('dim')
const red = style('red')
const cyan = style('cyan')
const badge = style(['bgCyan', 'black'])

/** Set once the clack frame (┌ ... └) is open, so errors close it instead of printing loose lines. */
let framed = false

function fail(message: string): never {
  if (framed) p.cancel(message)
  else console.error(`\n  ${red('✖')} ${message}\n`)
  process.exit(1)
}

/** Unwraps a prompt's answer; Ctrl+C or Escape ends the program. */
async function answer<T>(prompt: Promise<T>): Promise<Exclude<T, symbol>> {
  const value = await prompt
  if (p.isCancel(value)) {
    p.cancel('Cancelled.')
    process.exit(130)
  }
  return value as Exclude<T, symbol>
}

async function main() {
  let parsed
  try {
    parsed = parseArgs({
      allowPositionals: true,
      allowNegative: true,
      options: {
        ui: { type: 'boolean', default: false },
        framework: { type: 'string' },
        pattern: { type: 'string' },
        'add-ons': { type: 'string' },
        pm: { type: 'string' },
        dir: { type: 'string' },
        install: { type: 'boolean' },
        git: { type: 'boolean' },
        open: { type: 'boolean', default: true },
        port: { type: 'string', default: '4600' },
        yes: { type: 'boolean', short: 'y', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
    })
  } catch (error) {
    console.error(HELP)
    fail((error as Error).message)
  }
  const { values: flags, positionals } = parsed
  if (flags.help) {
    console.log(HELP)
    return
  }

  // INIT_CWD is where the user ran `pnpm create-app` (pnpm runs scripts from the workspace root).
  const cwd = process.env.INIT_CWD ?? process.cwd()
  const parentDir = resolveParentDir(flags.dir ?? '', cwd)
  if (flags.framework !== undefined && !FRAMEWORK_IDS.includes(flags.framework as FrameworkId)) {
    fail(`Unknown framework "${flags.framework}". Available: ${FRAMEWORK_IDS.join(', ')}.`)
  }
  const framework = flags.framework as FrameworkId | undefined
  if (flags.pattern !== undefined && !PATTERN_IDS.includes(flags.pattern as PatternId)) {
    fail(`Unknown design pattern "${flags.pattern}". Available: ${PATTERN_IDS.join(', ')}.`)
  }
  const pattern = flags.pattern as PatternId | undefined
  const addOns = flags['add-ons'] === undefined ? undefined : parseAddOns(flags['add-ons'])
  if (flags.pm !== undefined && !PACKAGE_MANAGERS.includes(flags.pm as PackageManager)) {
    fail(`Unknown package manager "${flags.pm}". Use one of: ${PACKAGE_MANAGERS.join(', ')}.`)
  }
  const pm = flags.pm as PackageManager | undefined

  if (flags.ui) {
    const port = Number(flags.port)
    if (!Number.isInteger(port) || port < 1 || port > 65535) fail(`--port must be a port number, got "${flags.port}".`)
    await startUi({
      port,
      open: flags.open,
      cwd,
      defaultParentDir: parentDir,
      command: launchCommand(),
      initial: { name: positionals[0], framework, pattern, packageManager: pm, addOns, install: flags.install, git: flags.git },
    })
    return
  }

  // Arrow-key prompts need a terminal on both ends; otherwise (CI, pipes) use flags and defaults.
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY) && !flags.yes
  // Probing for package managers takes a moment; do it while the user answers.
  const environment = detectEnvironment()

  p.intro(`${badge(' create-mini-start ')} ${dim(`v${toolVersion()}`)}`)
  framed = true

  // Choices that came from flags (or defaults, without a terminal) aren't asked for.
  // When prompting, they're shown in place, in order; otherwise collected into one summary.
  const summary: [string, string][] = []
  const given = (label: string, value: string) => {
    if (interactive) p.log.step(`${label}\n${dim(value)}`)
    else summary.push([label, value])
  }

  // Name
  const nameProblem = (value: string) => validateName(value) ?? checkTarget({ name: value, parentDir }).message ?? undefined
  let name = positionals[0]
  if (name !== undefined) {
    const problem = nameProblem(name)
    if (problem && !interactive) fail(problem)
    if (problem) {
      p.log.warn(`Can't use "${name}". ${problem}`)
      name = undefined
    } else given('Project name', name)
  }
  if (name === undefined) {
    const suggested = suggestName(parentDir)
    if (interactive) {
      const typed = await answer(
        p.text({
          message: 'Project name',
          placeholder: suggested,
          defaultValue: suggested,
          validate: (value) => nameProblem(value?.trim() || suggested),
        }),
      )
      name = typed.trim() || suggested
    } else {
      name = suggested
      given('Project name', name)
    }
  }

  // Framework: only asked once there is more than one to choose from.
  let chosenFramework = framework ?? DEFAULT_FRAMEWORK
  if (!framework && interactive && FRAMEWORKS.length > 1) {
    chosenFramework = await answer(
      p.select({
        message: 'Framework',
        initialValue: chosenFramework,
        options: FRAMEWORKS.map((f) => ({ value: f.id, label: f.name, hint: f.description })),
      }),
    )
  } else {
    given('Framework', FRAMEWORKS.find((f) => f.id === chosenFramework)?.name ?? chosenFramework)
  }

  // Design pattern
  let chosenPattern = pattern ?? DEFAULT_PATTERN
  if (!pattern && interactive) {
    chosenPattern = await answer(
      p.select({
        message: 'Design pattern',
        initialValue: chosenPattern,
        options: PATTERNS.map((pt) => ({ value: pt.id, label: pt.name, hint: pt.bestFor })),
      }),
    )
  } else {
    given('Design pattern', PATTERNS.find((pt) => pt.id === chosenPattern)?.name ?? chosenPattern)
  }

  // Add-ons, grouped like in the browser UI (Styling, App, Quality, Deploy).
  let chosenAddOns = addOns ?? DEFAULT_ADD_ONS
  if (!addOns && interactive) {
    const groups: Record<string, p.Option<AddOnId>[]> = {}
    for (const addOn of ADD_ONS) {
      ;(groups[addOn.group] ??= []).push({ value: addOn.id, label: addOn.name, hint: addOn.hint })
    }
    const picked = await answer(
      p.groupMultiselect({
        message: 'Add-ons',
        options: groups,
        initialValues: DEFAULT_ADD_ONS,
        required: false,
        selectableGroups: false,
      }),
    )
    chosenAddOns = ADD_ON_IDS.filter((id) => picked.includes(id))
  } else {
    const names = chosenAddOns.map((id) => ADD_ONS.find((a) => a.id === id)?.name ?? id)
    given('Add-ons', names.length ? names.join(', ') : 'none')
  }

  // Package manager: installed ones can be picked; the others are listed but disabled.
  const env = await environment
  const versions = new Map(env.packageManagers.map((tool) => [tool.id as PackageManager, tool.version]))
  const preferred = [pm, invokingPackageManager(), 'pnpm', 'npm'].find((id) => id && versions.has(id as PackageManager))
  let packageManager = (pm ?? preferred ?? 'npm') as PackageManager
  if (!pm && interactive && versions.size > 1) {
    packageManager = await answer(
      p.select({
        message: 'Package manager',
        initialValue: packageManager,
        options: PACKAGE_MANAGERS.map((id) => ({
          value: id,
          label: id,
          hint: versions.get(id) ?? 'not installed',
          disabled: !versions.has(id),
        })),
      }),
    )
  } else {
    given('Package manager', versions.has(packageManager) ? `${packageManager} ${versions.get(packageManager)}` : packageManager)
  }

  // Install
  let install = flags.install
  if (install === undefined && interactive) {
    install = await answer(p.confirm({ message: `Install dependencies with ${packageManager}?`, initialValue: true }))
  } else {
    install ??= true
    given('Install dependencies', install ? `Yes, with ${packageManager}` : 'No')
  }
  if (install && !versions.has(packageManager)) fail(`${packageManager} is not installed. Pick another with --pm or pass --no-install.`)

  // Git
  let git = false
  if (!env.git) {
    if (flags.git) p.log.warn('git is not installed, so no repository will be created.')
  } else if (flags.git === undefined && interactive) {
    git = await answer(p.confirm({ message: 'Initialize a git repository?', initialValue: true }))
  } else {
    git = flags.git ?? true
    given('Git repository', git ? 'Yes' : 'No')
  }

  const options: ProjectOptions = {
    name,
    parentDir,
    framework: chosenFramework,
    pattern: chosenPattern,
    addOns: chosenAddOns,
    packageManager,
    install,
    git,
  }
  if (summary.length) {
    const rows: [string, string][] = [['Folder', targetDir(options)], ...summary.filter(([label]) => label !== 'Project name')]
    const width = Math.max(...rows.map(([label]) => label.length))
    p.note(rows.map(([label, value]) => `${dim(label.padEnd(width))}  ${value}`).join('\n'), `Creating ${bold(name)}`)
  }

  const ok = await createProject(options, createPrinter(), cwd)
  process.exitCode = ok ? 0 : 1
}

function parseAddOns(value: string): AddOnId[] {
  if (value.trim() === 'none' || value.trim() === '') return []
  const ids = value.split(',').map((id) => id.trim()).filter(Boolean)
  const unknown = ids.filter((id) => !ADD_ON_IDS.includes(id as AddOnId))
  if (unknown.length) fail(`Unknown add-on "${unknown.join('", "')}". Available: ${ADD_ON_IDS.join(', ')}.`)
  return ADD_ON_IDS.filter((id) => ids.includes(id))
}

/** How the user started us, so the UI can show an equivalent command. */
function launchCommand(): string {
  // The repo's `dev` script is `create-app --ui`; the terminal equivalent is create-app.
  const script = process.env.npm_lifecycle_event === 'dev' ? 'create-app' : process.env.npm_lifecycle_event
  const pm = invokingPackageManager()
  if (script && pm) return pm === 'npm' ? `npm run ${script} --` : `${pm} ${script}`
  return 'create-mini-start'
}

/**
 * Prints createProject's progress inside the clack frame. The install output
 * scrolls in a small window that disappears when it succeeds and stays when
 * it fails.
 */
function createPrinter(): (event: CreateEvent) => void {
  let installLog: ReturnType<typeof p.taskLog> | null = null
  return (event) => {
    switch (event.type) {
      case 'step': {
        const label = STEP_LABELS[event.step]
        const line = event.detail ? `${label} ${dim(event.detail)}` : label
        if (event.status === 'running') {
          if (event.step === 'install') installLog = p.taskLog({ title: `${label}…`, limit: 10 })
        } else if (event.step === 'install' && installLog) {
          if (event.status === 'done') installLog.success(line)
          else installLog.error(line)
          installLog = null
        } else if (event.status === 'done') p.log.success(line)
        else if (event.status === 'skipped') p.log.message(dim(`${label} · ${event.detail ?? 'skipped'}`), { symbol: dim('–') })
        else p.log.error(line)
        break
      }
      case 'log':
        if (installLog) installLog.message(event.line)
        else p.log.message(dim(event.line))
        break
      case 'error':
        p.cancel(event.message)
        break
      case 'done':
        for (const warning of event.warnings) p.log.warn(warning)
        p.outro(`${bold('Done.')} Next steps:`)
        // Outside the frame, so the commands copy cleanly even when a long path wraps.
        console.log(`${event.nextSteps.map((step) => `  ${cyan(step)}`).join('\n')}\n`)
        break
    }
  }
}

main().catch((error: unknown) => fail((error as Error).stack ?? String(error)))
