import { env } from './env'

const API_URL = env.apiUrl

/** GET a JSON document, typed by the caller. Fails on any non-2xx answer. */
export async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_URL}${path}`)
  if (!response.ok) throw new Error(`Request failed: ${response.status} ${response.statusText}`)
  return (await response.json()) as T
}
