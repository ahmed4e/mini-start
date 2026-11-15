/** The state of one "Create project" run, built from the server's progress events. */
import type { CreateEvent, StepId } from '../../create.ts'

export type StepStatus = 'pending' | 'running' | 'done' | 'skipped' | 'failed'

export interface StepState {
  status: StepStatus
  detail: string
  /** Command output (the install log). Cleared when the step succeeds, kept when it fails. */
  log: string[]
}

export type Outcome = Extract<CreateEvent, { type: 'done' }> | { type: 'error'; message: string }

export interface Run {
  name: string
  target: string
  steps: Record<StepId, StepState>
  /** Null while the run is going. */
  outcome: Outcome | null
}

/** Same order and labels as STEP_LABELS in create.ts, which can't be imported into the page. */
export const STEPS: [StepId, string][] = [
  ['files', 'Write project files'],
  ['install', 'Install dependencies'],
  ['git', 'Initialize git repository'],
]

export function startRun(name: string, target: string): Run {
  const pending = (): StepState => ({ status: 'pending', detail: '', log: [] })
  return { name, target, steps: { files: pending(), install: pending(), git: pending() }, outcome: null }
}

export function applyEvent(run: Run, event: CreateEvent): Run {
  switch (event.type) {
    case 'step': {
      const step = run.steps[event.step]
      const log = event.status === 'done' ? [] : step.log
      return { ...run, steps: { ...run.steps, [event.step]: { status: event.status, detail: event.detail ?? '', log } } }
    }
    case 'log': {
      const step = run.steps[event.step]
      return { ...run, steps: { ...run.steps, [event.step]: { ...step, log: [...step.log, event.line] } } }
    }
    case 'done':
      return { ...run, outcome: event }
    case 'error':
      return { ...run, outcome: { type: 'error', message: event.message } }
  }
}

export const CONNECTION_LOST = 'The connection closed before the project was finished.'
