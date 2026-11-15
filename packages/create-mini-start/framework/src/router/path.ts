/**
 * Path utilities: parsing route paths into segments, interpolating params,
 * and (de)serializing search params.
 *
 * Route path syntax (same as TanStack Router):
 *   about        static segment
 *   $postId      dynamic segment  -> params.postId
 *   $            splat            -> params._splat (rest of the URL)
 */

export type Segment =
  | { type: 'static'; value: string }
  | { type: 'param'; value: string }
  | { type: 'splat'; value: '_splat' }

export function parseRoutePath(path: string): Segment[] {
  return path
    .split('/')
    .filter(Boolean)
    .map((part): Segment => {
      if (part === '$') return { type: 'splat', value: '_splat' }
      if (part.startsWith('$')) return { type: 'param', value: part.slice(1) }
      return { type: 'static', value: part }
    })
}

export function splitPathname(pathname: string): string[] {
  return pathname.split('/').filter(Boolean)
}

/** '/posts/$postId' + { postId: 'a b' } -> '/posts/a%20b' */
export function interpolatePath(
  path: string,
  params: Record<string, string> = {},
): string {
  const parts = path.split('/').map((part) => {
    if (part === '$') {
      const splat = params._splat ?? ''
      return splat.split('/').map(encodeURIComponent).join('/')
    }
    if (part.startsWith('$')) {
      const name = part.slice(1)
      const value = params[name]
      if (value === undefined) {
        throw new Error(`Missing param "${name}" for path "${path}"`)
      }
      return encodeURIComponent(value)
    }
    return part
  })
  const joined = parts.join('/').replace(/\/{2,}/g, '/')
  return joined.length > 1 ? joined.replace(/\/$/, '') : joined || '/'
}

export function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

// ---------------------------------------------------------------------------
// Search params. Values are JSON-encoded when they are not plain strings, so
// numbers, booleans, arrays and objects survive a round trip through the URL.
// ---------------------------------------------------------------------------

export function parseSearch(searchStr: string): Record<string, unknown> {
  const params = new URLSearchParams(
    searchStr.startsWith('?') ? searchStr.slice(1) : searchStr,
  )
  const out: Record<string, unknown> = {}
  for (const [key, raw] of params) {
    out[key] = parseSearchValue(raw)
  }
  return out
}

function parseSearchValue(raw: string): unknown {
  if (
    raw === 'true' ||
    raw === 'false' ||
    raw === 'null' ||
    /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(raw) ||
    /^[[{"]/.test(raw)
  ) {
    try {
      return JSON.parse(raw)
    } catch {
      return raw
    }
  }
  return raw
}

export function stringifySearch(search: Record<string, unknown> = {}): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(search)) {
    if (value === undefined) continue
    if (typeof value === 'string') {
      // A string that would be re-parsed as something else must be quoted.
      const reparsed = parseSearchValue(value)
      params.set(key, reparsed === value ? value : JSON.stringify(value))
    } else {
      params.set(key, JSON.stringify(value))
    }
  }
  const str = params.toString()
  return str ? `?${str}` : ''
}
