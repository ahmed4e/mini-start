/**
 * The project builder page. Left: the form, or the progress of a run.
 * Right: a live preview of the files the current options produce.
 */
import { useEffect, useState } from 'react'
import type { ProjectOptions } from '../options.ts'
import type { BuilderInfo, FieldErrors } from '../ui-server.ts'
import { BuilderForm } from './components/BuilderForm.tsx'
import { Logo } from './components/icons.tsx'
import { Preview } from './components/Preview.tsx'
import { Progress } from './components/Progress.tsx'
import { api, apiJson, OfflineError, readEvents, reportError } from './lib/api.ts'
import { applyEvent, CONNECTION_LOST, type Run, startRun } from './lib/run.ts'
import { useToast } from './lib/toast.ts'
import { usePreview } from './lib/usePreview.ts'

export function App() {
  const [info, setInfo] = useState<BuilderInfo | null>(null)
  const [bootError, setBootError] = useState<string | null>(null)
  const [options, setOptions] = useState<ProjectOptions | null>(null)
  // Bumped to re-check the same options, e.g. after a failed run left files behind.
  const [refreshKey, setRefreshKey] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  // Field errors from a refused create; they win over the preview's until the next change.
  const [submitErrors, setSubmitErrors] = useState<FieldErrors | null>(null)
  const [run, setRun] = useState<Run | null>(null)
  const [closed, setClosed] = useState(false)
  const preview = usePreview(options, refreshKey)

  useEffect(() => {
    let cancelled = false
    apiJson<BuilderInfo>('/api/info')
      .then((data) => {
        if (cancelled) return
        setInfo(data)
        setOptions(data.defaults)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setBootError(error instanceof OfflineError ? 'Could not reach create-mini-start.' : (error as Error).message)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const change = (patch: Partial<ProjectOptions>) => {
    setOptions((current) => current && { ...current, ...patch })
    setFormError(null)
    setSubmitErrors(null)
  }

  async function create() {
    if (!options) return
    setSubmitting(true)
    let res: Response
    try {
      res = await api('/api/create', options)
    } catch {
      setSubmitting(false)
      return
    }
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string; errors?: FieldErrors }
      if (data.errors) setSubmitErrors(data.errors)
      setFormError(data.error ?? `Could not create the project (${res.status}).`)
      setSubmitting(false)
      return
    }
    setRun(startRun(options.name.trim(), preview.target))
    setSubmitting(false)
    try {
      await readEvents(res, (event) => setRun((current) => current && applyEvent(current, event)))
    } catch {
      // Handled below: the run has no outcome.
    }
    setRun((current) => (current && !current.outcome ? { ...current, outcome: { type: 'error', message: CONNECTION_LOST } } : current))
  }

  function backToForm() {
    setRun(null)
    setRefreshKey((key) => key + 1)
  }

  async function createAnother() {
    try {
      // The server suggests a name that's free now that the last project exists.
      const fresh = await apiJson<BuilderInfo>('/api/info')
      preview.forget()
      change({ name: fresh.defaults.name })
      setRun(null)
    } catch (error) {
      reportError(error)
    }
  }

  async function shutdown() {
    await api('/api/shutdown', {}).catch(() => {})
    setClosed(true)
  }

  if (closed) {
    return (
      <div className="closed">
        <h2>The project builder has stopped</h2>
        <p>You can close this tab. Run create-mini-start --ui again to start another project.</p>
      </div>
    )
  }

  return (
    <>
      <header className="topbar">
        <Logo />
        <h1>
          mini-start <span>· Create a new project</span>
        </h1>
        {info && <span className="pill">v{info.version}</span>}
      </header>

      <main className="layout">
        <section className="panel">
          {run && info ? (
            <Progress run={run} vscode={info.vscode} onBack={backToForm} onAnother={createAnother} onClose={shutdown} />
          ) : info && options ? (
            <BuilderForm
              info={info}
              options={options}
              onChange={change}
              errors={submitErrors ?? preview.errors}
              target={preview.target}
              formError={formError}
              submitting={submitting}
              onSubmit={create}
            />
          ) : (
            <div className="loading">{bootError ?? 'Loading…'}</div>
          )}
        </section>
        <Preview files={preview.files} fresh={preview.fresh} generation={preview.generation} />
      </main>

      <ToastView />
    </>
  )
}

function ToastView() {
  const toast = useToast()
  if (!toast) return null
  return (
    <div key={toast.id} className="toast" role="status">
      {toast.message}
    </div>
  )
}
