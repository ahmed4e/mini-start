/**
 * One short message at a time at the bottom of the page. A tiny store, so
 * code outside React (the API helpers) can show one too.
 */
import { useSyncExternalStore } from 'react'

export interface Toast {
  id: number
  message: string
}

let current: Toast | null = null
let nextId = 1
let timer: ReturnType<typeof setTimeout> | undefined
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

export function showToast(message: string) {
  current = { id: nextId++, message }
  clearTimeout(timer)
  timer = setTimeout(() => {
    current = null
    emit()
  }, 2600)
  emit()
}

export function useToast(): Toast | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => current,
  )
}

export async function copyText(text: string, message: string) {
  try {
    await navigator.clipboard.writeText(text)
    showToast(message)
  } catch {
    showToast('Copy failed. Select the text and copy it manually.')
  }
}
