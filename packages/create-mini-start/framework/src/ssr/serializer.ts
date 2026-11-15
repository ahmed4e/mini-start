/**
 * Serialization shared by SSR dehydration and server functions.
 *
 * Plain JSON plus tagged objects (`{ "$m": tag, "v": payload }`) for values
 * JSON cannot represent. Promises become references whose values are sent
 * later in the HTML stream. (TanStack Start uses the `seroval` library for
 * the same job; this is a small purpose-built version.)
 */

const TAG = '$m'

export interface EncodeOptions {
  /** Called for each promise found; returns the reference id. Without it, promises are an error. */
  onPromise?: (promise: Promise<unknown>) => number
  /** Include `Error.stack` (development only). */
  includeStack?: boolean
}

export interface DecodeOptions {
  getPromise?: (id: number) => Promise<unknown>
}

export function encode(value: unknown, options: EncodeOptions = {}): unknown {
  const ancestors = new Set<object>()

  const walk = (v: unknown): unknown => {
    if (v === null || typeof v === 'boolean' || typeof v === 'string') return v
    if (v === undefined || typeof v === 'function' || typeof v === 'symbol') {
      return { [TAG]: 'undef' }
    }
    if (typeof v === 'number') {
      if (Number.isNaN(v)) return { [TAG]: 'num', v: 'NaN' }
      if (v === Number.POSITIVE_INFINITY) return { [TAG]: 'num', v: 'Infinity' }
      if (v === Number.NEGATIVE_INFINITY) return { [TAG]: 'num', v: '-Infinity' }
      if (Object.is(v, -0)) return { [TAG]: 'num', v: '-0' }
      return v
    }
    if (typeof v === 'bigint') return { [TAG]: 'bigint', v: v.toString() }

    const obj = v as object
    if (obj instanceof Date) {
      return {
        [TAG]: 'date',
        v: Number.isNaN(obj.getTime()) ? null : obj.toISOString(),
      }
    }
    if (obj instanceof RegExp) return { [TAG]: 'regexp', v: [obj.source, obj.flags] }
    if (obj instanceof URL) return { [TAG]: 'url', v: obj.href }
    if (typeof (obj as { then?: unknown }).then === 'function') {
      if (!options.onPromise) {
        throw new TypeError('A Promise cannot be serialized in this context')
      }
      return { [TAG]: 'promise', v: options.onPromise(Promise.resolve(obj)) }
    }
    if (obj instanceof Error) {
      return {
        [TAG]: 'error',
        v: {
          name: obj.name,
          message: obj.message,
          ...(options.includeStack && obj.stack ? { stack: obj.stack } : {}),
        },
      }
    }

    if (ancestors.has(obj)) {
      throw new TypeError('Cannot serialize a circular structure')
    }
    ancestors.add(obj)
    try {
      if (obj instanceof Map) {
        return { [TAG]: 'map', v: [...obj].map(([k, val]) => [walk(k), walk(val)]) }
      }
      if (obj instanceof Set) return { [TAG]: 'set', v: [...obj].map(walk) }
      if (Array.isArray(obj)) return obj.map(walk)
      const out = Object.fromEntries(
        Object.entries(obj).map(([k, val]) => [k, walk(val)]),
      )
      // A real object that happens to own the tag key is wrapped so it is not misread.
      return TAG in out ? { [TAG]: 'obj', v: out } : out
    } finally {
      ancestors.delete(obj)
    }
  }

  return walk(value)
}

export function decode(value: unknown, options: DecodeOptions = {}): unknown {
  const plain = (o: Record<string, unknown>) =>
    // fromEntries defines own properties, so a "__proto__" key cannot change the prototype.
    Object.fromEntries(Object.entries(o).map(([k, val]) => [k, walk(val)]))

  const walk = (v: unknown): unknown => {
    if (v === null || typeof v !== 'object') return v
    if (Array.isArray(v)) return v.map(walk)
    const o = v as Record<string, unknown>
    const tag = o[TAG]
    if (typeof tag !== 'string') return plain(o)
    const payload = o.v as never
    switch (tag) {
      case 'undef':
        return undefined
      case 'num':
        return payload === 'NaN'
          ? Number.NaN
          : payload === 'Infinity'
            ? Number.POSITIVE_INFINITY
            : payload === '-Infinity'
              ? Number.NEGATIVE_INFINITY
              : -0
      case 'bigint':
        return BigInt(payload)
      case 'date':
        return new Date(payload ?? Number.NaN)
      case 'regexp': {
        const [source, flags] = payload as [string, string]
        return new RegExp(source, flags)
      }
      case 'url':
        return new URL(payload)
      case 'map':
        return new Map(
          (payload as Array<[unknown, unknown]>).map(([k, val]) => [walk(k), walk(val)]),
        )
      case 'set':
        return new Set((payload as unknown[]).map(walk))
      case 'error': {
        const info = payload as { name: string; message: string; stack?: string }
        const error = new Error(info.message)
        error.name = info.name
        if (info.stack) error.stack = info.stack
        return error
      }
      case 'promise':
        if (!options.getPromise) {
          throw new TypeError('Found a promise reference but no promise resolver')
        }
        return options.getPromise(payload)
      case 'obj':
        return plain(payload)
      default:
        return plain(o)
    }
  }

  return walk(value)
}

/** JSON that is safe to place inside an inline <script>. */
export function toScriptSafeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}
