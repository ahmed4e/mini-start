/** The left panel while and after creating: the steps, the install log, then next steps or the error. */
import { Fragment, useLayoutEffect, useRef } from 'react'
import { apiJson, reportError } from '../lib/api.ts'
import { type Outcome, type Run, type StepState, STEPS } from '../lib/run.ts'
import { copyText, showToast } from '../lib/toast.ts'
import { CheckIcon, CopyIcon, CrossIcon, EditorIcon } from './icons.tsx'

interface Props {
  run: Run
  /** VS Code's `code` command is installed. */
  vscode: boolean
  onBack: () => void
  onAnother: () => void
  onClose: () => void
}

export function Progress({ run, vscode, onBack, onAnother, onClose }: Props) {
  const { outcome } = run
  return (
    <div className="progress">
      {outcome?.type === 'done' ? (
        <div className="success">
          <span className="success-icon">
            <CheckIcon />
          </span>
          <div>
            <h2>{run.name} is ready</h2>
            <p>{outcome.dir}</p>
          </div>
        </div>
      ) : (
        <div>
          <h2>{outcome?.type === 'error' ? 'Could not create the project' : `Creating ${run.name}…`}</h2>
          <p>{run.target}</p>
        </div>
      )}

      <ol className="steps">
        {STEPS.map(([id, label]) => (
          <Step key={id} label={label} state={run.steps[id]} />
        ))}
      </ol>

      {outcome?.type === 'error' && (
        <div className="result">
          <div className="form-error">{outcome.message}</div>
          <div className="actions">
            <button className="btn" type="button" onClick={onBack}>
              Back to the form
            </button>
          </div>
        </div>
      )}
      {outcome?.type === 'done' && <Done outcome={outcome} vscode={vscode} onAnother={onAnother} onClose={onClose} />}
    </div>
  )
}

function Step({ label, state }: { label: string; state: StepState }) {
  return (
    <li className={`step ${state.status}`}>
      <span className="step-icon">
        {state.status === 'done' && <CheckIcon />}
        {state.status === 'failed' && <CrossIcon />}
      </span>
      <div>
        <div className="step-label">{label}</div>
        <div className="step-detail">{state.detail}</div>
        {state.log.length > 0 && <Log lines={state.log} />}
      </div>
    </li>
  )
}

/** Command output that follows new lines, unless the user scrolled up to read. */
function Log({ lines }: { lines: string[] }) {
  const ref = useRef<HTMLPreElement>(null)
  const atBottom = useRef(true)
  useLayoutEffect(() => {
    const log = ref.current
    if (log && atBottom.current) log.scrollTop = log.scrollHeight
  }, [lines])
  return (
    <pre
      ref={ref}
      className="log"
      onScroll={(e) => {
        const log = e.currentTarget
        atBottom.current = log.scrollHeight - log.scrollTop - log.clientHeight < 24
      }}
    >
      {lines.join('\n')}
    </pre>
  )
}

interface DoneProps {
  outcome: Extract<Outcome, { type: 'done' }>
  vscode: boolean
  onAnother: () => void
  onClose: () => void
}

function Done({ outcome, vscode, onAnother, onClose }: DoneProps) {
  const openEditor = async () => {
    try {
      await apiJson('/api/open-editor', { dir: outcome.dir })
      showToast('Opening VS Code…')
    } catch (error) {
      reportError(error)
    }
  }
  return (
    <div className="result">
      {outcome.warnings.length > 0 && (
        <div className="warnings">
          {outcome.warnings.map((warning) => (
            <div key={warning} className="warning">
              {warning}
            </div>
          ))}
        </div>
      )}
      <div className="field-label">Next steps</div>
      <pre className="next">
        {outcome.nextSteps.map((step) => (
          <Fragment key={step}>
            <span className="prompt">$ </span>
            {step}
            {'\n'}
          </Fragment>
        ))}
        <button
          className="icon-btn"
          type="button"
          title="Copy commands"
          aria-label="Copy commands"
          onClick={() => copyText(outcome.nextSteps.join(' && '), 'Commands copied')}
        >
          <CopyIcon />
        </button>
      </pre>
      <div className="actions">
        {vscode && (
          <button className="btn" type="button" onClick={openEditor}>
            <EditorIcon />
            Open in VS Code
          </button>
        )}
        <button className="btn" type="button" onClick={onAnother}>
          Create another project
        </button>
        <button className="btn" type="button" onClick={onClose}>
          Close the builder
        </button>
      </div>
    </div>
  )
}
