#!/usr/bin/env node
/**
 * create-mini-start: make a new mini-start app.
 *
 *   create-mini-start --ui            choose everything in a browser UI
 *   create-mini-start my-app          answer a few prompts in the terminal
 *   create-mini-start my-app -y       accept the defaults
 */
import readline from 'node:readline'
import { parseArgs } from 'node:util'
import { createProject, type CreateEvent, STEP_LABELS } from './create.ts'
import { detectEnvironment, invokingPackageManager } from './env.ts'
import {
  ADD_ON_IDS,
  ADD_ONS,
  type AddOnId,
  checkTarget,
  DEFAULT_ADD_ONS,
  DEFAULT_FRAMEWORK,
  DEFAULT_NAME,
  FRAMEWORK_IDS,
  type FrameworkId,
  FRAMEWORKS,
  DEFAULT_PATTERN,
  PACKAGE_MANAGERS,
  PATTERN_IDS,
  type PatternId,
  PATTERNS,
  type PackageManager,
  type ProjectOptions,
  resolveParentDir,
  suggestName,
  validateName,
} from './options.ts'
import { startUi } from './ui-server.ts'

const HELP = `
Usage: create-mini-start [name] [options]

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
  -y, --yes           Use defaults instead of prompting
  --port <n>          Port for --ui (default 4600)
  --no-open           With --ui, don't open the browser
  -h, --help          Show this help
`

const color = (code: number) => (text: string) => (process.stdout.isTTY ? `\x1b[${code}m${text}\x1b[0m` : text)
const bold = color(1)
const dim = color(2)
const red = color(31)
const green = color(32)
const yellow = color(33)
const cyan = color(36)

function fail(message: string): never {
  console.error(`\n  ${red('✖')} ${message}\n`)
  process.exit(1)
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

  const interactive = Boolean(process.stdin.isTTY) && !flags.yes
  // Probing for package managers takes a moment; do it while the user answers.
  const environment = detectEnvironment()
  const rl = interactive ? createPrompter() : null
  const ask = async (question: string, fallback: string) =>
    ((await rl?.question(`  ${question} ${dim(`(${fallback})`)} `)) ?? '').trim() || fallback
  const confirm = async (question: string, fallback: boolean) => {
    const answer = ((await rl?.question(`  ${question} ${dim(fallback ? '(Y/n)' : '(y/N)')} `)) ?? '').trim()
    return answer ? /^y/i.test(answer) : fallback
  }

  console.log(`\n  ${bold('create-mini-start')} ${dim('· new starter project')}\n`)

  // Name
  let name = positionals[0]
  for (;;) {
    if (name === undefined) name = rl ? await ask('Project name', suggestName(parentDir)) : suggestName(parentDir)
    const problem = validateName(name) ?? checkTarget({ name, parentDir }).message
    if (!problem) break
    if (!rl) fail(problem)
    console.log(`  ${red('✖')} ${problem}`)
    name = undefined
  }

  // Framework: only asked once there is more than one to choose from.
  let chosenFramework = framework ?? DEFAULT_FRAMEWORK
  if (!framework && rl && FRAMEWORKS.length > 1) {
    const ids = FRAMEWORKS.map((f) => f.id)
    for (;;) {
      const answer = await ask(`Framework [${ids.join('/')}]`, chosenFramework)
      if (ids.includes(answer as FrameworkId)) {
        chosenFramework = answer as FrameworkId
        break
      }
      console.log(`  ${red('✖')} Choose one of: ${ids.join(', ')}.`)
    }
  } else if (rl) {
    console.log(`  Framework ${dim(FRAMEWORKS.find((f) => f.id === chosenFramework)?.name ?? chosenFramework)}`)
  }

  // Design pattern
  let chosenPattern = pattern ?? DEFAULT_PATTERN
  if (!pattern && rl) {
    console.log(`\n  ${bold('Design pattern')}`)
    PATTERNS.forEach((p, i) => console.log(`    ${cyan(String(i + 1))}. ${p.name} ${dim(`- ${p.bestFor}`)}`))
    for (;;) {
      const answer = await ask('Number', String(PATTERN_IDS.indexOf(chosenPattern) + 1))
      const picked = PATTERNS[Number(answer) - 1] ?? PATTERNS.find((p) => p.id === answer)
      if (picked) {
        chosenPattern = picked.id
        break
      }
      console.log(`  ${red('✖')} Pick a number between 1 and ${PATTERNS.length}.`)
    }
    console.log()
  }

  // Add-ons: a yes/no question while there's only one, a numbered list after that.
  let chosenAddOns = addOns
  if (!chosenAddOns && rl && ADD_ONS.length === 1) {
    const only = ADD_ONS[0]!
    chosenAddOns = (await confirm(`Add ${only.name}?`, DEFAULT_ADD_ONS.includes(only.id))) ? [only.id] : []
  } else if (!chosenAddOns && rl) {
    console.log(`\n  ${bold('Add-ons')}`)
    ADD_ONS.forEach((addOn, i) => {
      if (addOn.group !== ADD_ONS[i - 1]?.group) console.log(`    ${dim(addOn.group)}`)
      console.log(`    ${cyan(String(i + 1))}. ${addOn.name} ${dim(`- ${addOn.description}`)}`)
    })
    const defaults = DEFAULT_ADD_ONS.map((id) => ADD_ON_IDS.indexOf(id) + 1).join(',')
    for (;;) {
      const answer = await ask('Numbers, comma-separated, or "none"', defaults)
      const picked = answer === 'none' ? [] : answer.split(/[\s,]+/).filter(Boolean).map((n) => ADD_ONS[Number(n) - 1]?.id)
      if (picked.every(Boolean)) {
        chosenAddOns = ADD_ON_IDS.filter((id) => picked.includes(id))
        break
      }
      console.log(`  ${red('✖')} Pick numbers between 1 and ${ADD_ONS.length}.`)
    }
    console.log()
  }

  // Package manager
  const env = await environment
  const available = env.packageManagers.map((tool) => tool.id as PackageManager)
  const preferred =[pm, invokingPackageManager(), 'pnpm', 'npm'].find((id) => id && available.includes(id as PackageManager))
  let packageManager = (pm ?? preferred ?? 'npm') as PackageManager
  if (!pm && rl && available.length > 1) {
    for (;;) {
      const answer = await ask(`Package manager [${available.join('/')}]`, packageManager)
      if (available.includes(answer as PackageManager)) {
        packageManager = answer as PackageManager
        break
      }
      console.log(`  ${red('✖')} Choose one of: ${available.join(', ')}.`)
    }
  }

  const install = flags.install ?? (rl ? await confirm(`Install dependencies with ${packageManager}?`, true) : true)
  if (install && !available.includes(packageManager)) fail(`${packageManager} is not installed. Pick another with --pm or pass --no-install.`)
  const git = env.git !== null && (flags.git ?? (rl ? await confirm('Initialize a git repository?', true) : true))
  rl?.close()

  const options: ProjectOptions = {
    name: name ?? DEFAULT_NAME,
    parentDir,
    framework: chosenFramework,
    pattern: chosenPattern,
    addOns: chosenAddOns ?? DEFAULT_ADD_ONS,
    packageManager,
    install,
    git,
  }
  console.log()
  const ok = await createProject(options, printEvent, cwd)
  process.exitCode = ok ? 0 : 1
}

/**
 * Line-at-a-time prompts. Unlike readline/promises' question(), lines typed
 * or pasted ahead of a prompt are queued instead of dropped, and Ctrl+C or
 * Ctrl+D cancel cleanly.
 */
function createPrompter() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const queue: string[] = []
  let waiting: ((line: string) => void) | null = null
  let closed = false
  const cancel = () => {
    console.log(`\n\n  ${dim('Cancelled.')}\n`)
    process.exit(130)
  }
  rl.on('line', (line) => {
    if (!waiting) return void queue.push(line)
    const resolve = waiting
    waiting = null
    resolve(line)
  })
  rl.on('SIGINT', cancel)
  rl.on('close', () => {
    closed = true
    if (waiting) cancel()
  })
  return {
    question(prompt: string): Promise<string> {
      const queued = queue.shift()
      if (queued !== undefined) {
        process.stdout.write(`${prompt}${queued}\n`)
        return Promise.resolve(queued)
      }
      if (closed) cancel()
      return new Promise((resolve) => {
        waiting = resolve
        rl.setPrompt(prompt)
        rl.prompt()
      })
    },
    close: () => rl.close(),
  }
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

function printEvent(event: CreateEvent) {
  switch (event.type) {
    case 'step': {
      const label = STEP_LABELS[event.step]
      const detail = event.detail ? dim(` ${event.detail}`) : ''
      if (event.status === 'running') console.log(`  ${cyan('◇')} ${label}…`)
      else if (event.status === 'done') console.log(`  ${green('✔')} ${label}${detail}`)
      else if (event.status === 'skipped') console.log(`  ${dim('–')} ${dim(label)}${detail}`)
      else console.log(`  ${red('✖')} ${label}${detail}`)
      break
    }
    case 'log':
      console.log(dim(`    │ ${event.line}`))
      break
    case 'error':
      console.error(`\n  ${red('✖')} ${event.message}\n`)
      break
    case 'done':
      for (const warning of event.warnings) console.log(`\n  ${yellow('!')} ${warning}`)
      console.log(`\n  ${green(bold('Done.'))} Your app is in ${event.dir}\n\n  Next steps:\n`)
      for (const step of event.nextSteps) console.log(`    ${cyan(step)}`)
      console.log()
      break
  }
}

main().catch((error: unknown) => fail((error as Error).stack ?? String(error)))
