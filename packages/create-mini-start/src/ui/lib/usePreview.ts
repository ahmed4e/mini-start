/**
 * Asks the server what the current options would generate, shortly after
 * they stop changing. Files whose content changed since the last answer are
 * marked "fresh" for a moment, so the tree can flash them.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { PlannedFile } from '../../generate.ts'
import type { ProjectOptions } from '../../options.ts'
import type { FieldErrors, PreviewResponse } from '../../ui-server.ts'
import { apiJson, reportError } from './api.ts'

export interface Preview {
  files: PlannedFile[]
  errors: FieldErrors
  /** The resolved project folder. Empty until the first answer. */
  target: string
  /** Paths whose content changed in the latest answer. */
  fresh: ReadonlySet<string>
  /** Counts answers, so the tree can restart the flash for a file that changed again. */
  generation: number
}

const EMPTY: Preview = { files: [], errors: {}, target: '', fresh: new Set(), generation: 0 }
const DEBOUNCE_MS = 120
const FRESH_MS = 1800

/**
 * @param refreshKey change it to ask again with the same options (the disk may have changed).
 * @returns the latest preview, and `forget()`, which stops the next answer from being compared
 *   with this one (so nothing flashes after switching to a new project).
 */
export function usePreview(options: ProjectOptions | null, refreshKey: number): Preview & { forget: () => void } {
  const [preview, setPreview] = useState<Preview>(EMPTY)
  const previous = useRef<Map<string, string> | null>(null)

  useEffect(() => {
    if (!options) return
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const data = await apiJson<PreviewResponse>('/api/preview', options, controller.signal)
        const before = previous.current
        const fresh = new Set(before ? data.files.filter((f) => before.get(f.path) !== f.content).map((f) => f.path) : [])
        previous.current = new Map(data.files.map((f) => [f.path, f.content]))
        setPreview((p) => ({ files: data.files, errors: data.errors, target: data.target, fresh, generation: p.generation + 1 }))
      } catch (error) {
        reportError(error)
      }
    }, DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [options, refreshKey])

  // Drop the marks once the flash animation is over.
  useEffect(() => {
    if (!preview.fresh.size) return
    const timer = setTimeout(() => setPreview((p) => ({ ...p, fresh: new Set() })), FRESH_MS)
    return () => clearTimeout(timer)
  }, [preview.fresh])

  const forget = useCallback(() => {
    previous.current = null
  }, [])
  return { ...preview, forget }
}
