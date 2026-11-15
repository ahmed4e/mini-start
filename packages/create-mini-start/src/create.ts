/**
 * Creates a project on disk: write files, install dependencies, initialize
 * git. Progress is reported as events, which the terminal prints and the
 * browser UI streams.
 */
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { cleanEnv, isInsideGitRepo } from './env.ts'
import { planProject } from './generate.ts'
import { checkTarget, type ProjectOptions, targetDir } from './options.ts'
import { runCommand } from './templates.ts'

export type StepId = 'files' | 'install' | 'git'

export const STEP_LABELS: Record<StepId, string> = {
  files: 'Write project files',
  install: 'Install dependencies',
  git: 'Initialize git repository',
}

export type CreateEvent =
  | { type: 'step'; step: StepId; status: 'running' | 'done' | 'skipped' | 'failed'; detail?: string }
  | { type: 'log'; step: StepId; line: string }
  | { type: 'done'; dir: string; nextSteps: string[]; warnings: string[] }
  | { type: 'error'; message: string }

export async function createProject(
  options: ProjectOptions,
  emit: (event: CreateEvent) => void,
  /** Base for the `cd` in the next steps (where the user's terminal is). */
  cwd: string = process.cwd(),
): Promise<boolean> {
  const dir = targetDir(options)
  const warnings: string[] = []

  // 1. Files
  const target = checkTarget(options)
  if (target.message) {
    emit({ type: 'error', message: target.message })
    return false
  }
  emit({ type: 'step', step: 'files', status: 'running' })
  let fileCount = 0
  try {
    const files = planProject(options)
    for (const file of files) {
      const full = path.join(dir, file.path)
      fs.mkdirSync(path.dirname(full), { recursive: true })
      fs.writeFileSync(full, file.content)
    }
    fileCount = files.length
  } catch (error) {
    emit({ type: 'step', step: 'files', status: 'failed', detail: (error as Error).message })
    emit({ type: 'error', message: `Could not write the project: ${(error as Error).message}` })
    return false
  }
  emit({ type: 'step', step: 'files', status: 'done', detail: `${fileCount} files` })

  // 2. Install
  const pm = options.packageManager
  let installed = false
  if (!options.install) {
    emit({ type: 'step', step: 'install', status: 'skipped', detail: 'Skipped by choice' })
  } else {
    emit({ type: 'step', step: 'install', status: 'running', detail: `${pm} install` })
    // pnpm: install this project on its own, even when its folder sits inside another workspace.
    const args = pm === 'pnpm' ? ['install', '--ignore-workspace'] : ['install']
    const code = await runStreaming(pm, args, dir, (line) => emit({ type: 'log', step: 'install', line }))
    installed = code === 0
    // Format once with the project's own Prettier, so the first lint-staged run changes nothing.
    const prettier = path.join(dir, 'node_modules/.bin/prettier')
    if (installed && options.addOns.includes('husky') && fs.existsSync(prettier)) {
      await runStreaming(prettier, ['--write', '--log-level', 'warn', '.'], dir, (line) =>
        emit({ type: 'log', step: 'install', line }),
      )
    }
    if (installed) {
      emit({ type: 'step', step: 'install', status: 'done', detail: `${pm} install` })
    } else {
      const detail = code === null ? `${pm} could not be started` : `${pm} install exited with code ${code}`
      emit({ type: 'step', step: 'install', status: 'failed', detail })
      warnings.push(`Installing dependencies failed (${detail}). Run "${pm} install" in the project folder to retry.`)
    }
  }

  // 3. Git (after install, so the lockfile is in the first commit)
  if (!options.git) {
    emit({ type: 'step', step: 'git', status: 'skipped', detail: 'Skipped by choice' })
  } else if (isInsideGitRepo(dir)) {
    emit({ type: 'step', step: 'git', status: 'skipped', detail: 'Already inside a git repository' })
  } else {
    emit({ type: 'step', step: 'git', status: 'running' })
    const result = initGit(dir)
    if (result.ok) emit({ type: 'step', step: 'git', status: 'done', detail: result.detail })
    else {
      emit({ type: 'step', step: 'git', status: 'failed', detail: result.detail })
      warnings.push(result.detail)
    }
  }

  const relative = path.relative(cwd, dir)
  const cdPath = relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? relative : dir
  const nextSteps = [`cd ${quoteIfNeeded(cdPath)}`]
  if (!installed) nextSteps.push(`${pm} install`)
  nextSteps.push(runCommand(pm, 'dev'))
  emit({ type: 'done', dir, nextSteps, warnings })
  return true
}

function quoteIfNeeded(value: string): string {
  return /[\s"'$`\\]/.test(value) ? `"${value.replace(/(["$`\\])/g, '\\$1')}"` : value
}

/** Runs a command and reports each output line; resolves with the exit code (null if it never started). */
function runStreaming(command: string, args: string[], cwd: string, onLine: (line: string) => void): Promise<number | null> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...cleanEnv(), FORCE_COLOR: '0', NO_COLOR: '1' },
    })
    const forward = (stream: NodeJS.ReadableStream) => {
      let buffer = ''
      stream.on('data', (chunk: Buffer) => {
        buffer += chunk.toString()
        const lines = buffer.split(/\r?\n/)
        buffer = lines.pop() ?? ''
        for (const line of lines) if (line.trim()) onLine(stripAnsi(line))
      })
      stream.on('end', () => buffer.trim() && onLine(stripAnsi(buffer)))
    }
    forward(child.stdout)
    forward(child.stderr)
    child.on('error', () => resolve(null))
    child.on('close', (code) => resolve(code))
  })
}

function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '')
}

function initGit(dir: string): { ok: boolean; detail: string } {
  const git = (...args: string[]) => spawnSync('git', args, { cwd: dir, stdio: 'pipe', env: cleanEnv() })
  const init = git('init', '-q')
  if (init.error || init.status !== 0) {
    return { ok: false, detail: `git init failed: ${init.error?.message ?? init.stderr.toString().trim()}` }
  }
  // Husky add-on: "prepare" ran during install, before there was a repository. Run it again
  // now, so git uses the hooks in .husky/.
  const husky = path.join(dir, 'node_modules/.bin/husky')
  if (fs.existsSync(husky)) spawnSync(husky, [], { cwd: dir, stdio: 'pipe', env: cleanEnv(), shell: process.platform === 'win32' })
  git('add', '-A')
  // --no-verify: the files were just generated and formatted; no need to run the hook on all of them.
  const commit = git('commit', '-q', '--no-verify', '-m', 'Initial commit')
  if (commit.status === 0) return { ok: true, detail: 'Created a first commit' }
  // Most often: no user.name / user.email configured.
  return { ok: true, detail: 'Repository created; files are staged but not committed (git user.name/email is not set)' }
}
