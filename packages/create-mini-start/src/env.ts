/** What's installed on this machine, and how to talk to it. */
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import { PACKAGE_MANAGERS, type PackageManager } from './options.ts'

const isWindows = process.platform === 'win32'

export interface Tool {
  id: string
  version: string
}

/** Runs `<command> --version`; resolves to null when the command isn't installed. */
export function probe(command: string): Promise<string | null> {
  return new Promise((resolve) => {
    let output = ''
    // Run outside any project: a "packageManager" field in the user's current
    // folder makes pnpm/yarn refuse to run there, even for --version.
    const child = spawn(command, ['--version'], {
      cwd: os.tmpdir(),
      shell: isWindows,
      stdio: ['ignore', 'pipe', 'ignore'],
      env: cleanEnv(),
    })
    const timer = setTimeout(() => child.kill(), 5000)
    child.stdout.on('data', (chunk: Buffer) => (output += chunk))
    child.on('error', () => {
      clearTimeout(timer)
      resolve(null)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      const version = output.trim().split('\n')[0]?.replace(/^git version /, '')
      resolve(code === 0 && version ? version : null)
    })
  })
}

export interface Environment {
  packageManagers: Tool[]
  git: string | null
  vscode: boolean
}

export async function detectEnvironment(): Promise<Environment> {
  const [pms, git, code] = await Promise.all([
    Promise.all(PACKAGE_MANAGERS.map(async (id) => ({ id, version: await probe(id) }))),
    probe('git'),
    probe('code'),
  ])
  return {
    packageManagers: pms.flatMap((pm) => (pm.version ? [{ id: pm.id, version: pm.version }] : [])),
    git,
    vscode: code !== null,
  }
}

/** The package manager that launched us (`pnpm create ...`), from npm_config_user_agent. */
export function invokingPackageManager(): PackageManager | undefined {
  const agent = process.env.npm_config_user_agent ?? ''
  return PACKAGE_MANAGERS.find((pm) => agent.startsWith(`${pm}/`))
}

/**
 * The environment for child processes, without the npm_* variables a parent
 * `pnpm run` injects. They describe the workspace we were launched from and
 * would leak into an install in the new project.
 */
export function cleanEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (/^npm_/i.test(key) || key === 'INIT_CWD') continue
    env[key] = value
  }
  return env
}

export function isInsideGitRepo(dir: string): boolean {
  const result = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: dir, stdio: 'pipe' })
  return result.status === 0 && result.stdout.toString().trim() === 'true'
}

function isWsl(): boolean {
  try {
    return process.platform === 'linux' && /microsoft/i.test(fs.readFileSync('/proc/version', 'utf8'))
  } catch {
    return false
  }
}

/** Best effort; the URL is always printed too. */
export function openBrowser(url: string): void {
  const run = (command: string, args: string[], cwd?: string) => {
    const child = spawn(command, args, { stdio: 'ignore', detached: true, cwd })
    child.on('error', () => {})
    child.unref()
  }
  if (process.platform === 'darwin') run('open', [url])
  else if (isWindows) run('cmd', ['/c', 'start', '""', url])
  // Under WSL, hand the URL to Windows. cmd.exe needs a Windows working
  // directory or it prints a UNC path warning.
  else if (isWsl()) run('cmd.exe', ['/c', 'start', '""', url], fs.existsSync('/mnt/c') ? '/mnt/c' : undefined)
  else run('xdg-open', [url])
}

export function openInEditor(dir: string): void {
  const child = spawn('code', [dir], { stdio: 'ignore', detached: true, shell: isWindows, env: cleanEnv() })
  child.on('error', () => {})
  child.unref()
}
