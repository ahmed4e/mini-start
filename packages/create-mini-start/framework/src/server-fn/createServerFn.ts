/**
 * createServerFn — define a function that always runs on the server and can
 * be called from anywhere (loaders, components, event handlers).
 *
 *   export const addTodo = createServerFn({ method: 'POST' })
 *     .validator((input: { title: string }) => input)
 *     .handler(async ({ data }) => db.insert(data.title))
 *
 *   await addTodo({ data: { title: 'Milk' } })
 *
 * The Vite plugin compiles the `.handler(...)` call per environment:
 *   client: .handler(createClientRpc(id))   -> HTTP call to /_serverFn/<id>
 *   server: .handler(fn, { id, url })      -> registered + called directly
 */
import { useCallback } from 'react'
import { useRouter } from '../react/hooks.ts'
import { isRedirect } from '../router/errors.ts'
import type { NavigateOptions } from '../types.ts'
import { isClientRpc } from './client-rpc.ts'
import {
  getCurrentRequest,
  markValidationError,
  registerServerFn,
} from './registry.ts'

type Method = 'GET' | 'POST'

export interface ServerFnContext<TData> {
  data: TData
  request: Request
}

type CallArgs<TInput> = [TInput] extends [undefined]
  ? [options?: { data?: undefined; signal?: AbortSignal }]
  : [options: { data: TInput; signal?: AbortSignal }]

export type ServerFn<TInput, TResult> = ((
  ...args: CallArgs<TInput>
) => Promise<TResult>) & {
  id: string
  url: string
  method: Method
}

export interface ServerFnBuilder<TInput, TData> {
  /** Validate/transform the input on the server before the handler runs. */
  validator<TIn, TOut>(
    validate: (input: TIn) => TOut | Promise<TOut>,
  ): ServerFnBuilder<TIn, Awaited<TOut>>
  handler<TResult>(
    fn: (ctx: ServerFnContext<TData>) => TResult | Promise<TResult>,
  ): ServerFn<TInput, Awaited<TResult>>
}

export function createServerFn(
  options: { method?: Method } = {},
): ServerFnBuilder<undefined, undefined> {
  const method = options.method ?? 'GET'
  let validate: ((input: unknown) => unknown) | undefined

  const builder = {
    validator(fn: (input: unknown) => unknown) {
      validate = fn
      return builder
    },
    handler(
      fn: ((ctx: ServerFnContext<unknown>) => unknown) | unknown,
      meta?: { id: string; url: string },
    ) {
      // Browser bundle: the compiler swapped the implementation for an RPC stub.
      if (isClientRpc(fn)) {
        const call = (opts?: { data?: unknown; signal?: AbortSignal }) =>
          fn.call(method, opts?.data, opts?.signal)
        return Object.assign(call, { id: fn.id, url: fn.url, method })
      }

      if (!meta?.id || typeof fn !== 'function') {
        throw new Error(
          '[mini-start] createServerFn().handler() was not compiled. Is miniStart() in your Vite plugins?',
        )
      }
      const implementation = fn as (ctx: ServerFnContext<unknown>) => unknown
      const run = async (input: unknown, request?: Request) => {
        let data = input
        if (validate) {
          try {
            data = await validate(input)
          } catch (error) {
            throw markValidationError(error)
          }
        }
        return implementation({
          data,
          request:
            request ?? getCurrentRequest() ?? new Request('http://localhost/'),
        })
      }
      registerServerFn(meta.id, { method, run })
      // Server-side callers (e.g. loaders during SSR) skip HTTP entirely.
      const call = (opts?: { data?: unknown }) => run(opts?.data)
      return Object.assign(call, { id: meta.id, url: meta.url, method })
    },
  }
  return builder as unknown as ServerFnBuilder<undefined, undefined>
}

/**
 * Wrap a server function for use in event handlers: a `redirect()` thrown on
 * the server becomes a client-side navigation.
 */
export function useServerFn<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
): (...args: TArgs) => Promise<TResult | undefined> {
  const router = useRouter()
  return useCallback(
    async (...args: TArgs) => {
      try {
        return await fn(...args)
      } catch (error) {
        if (!isRedirect(error)) throw error
        const target = error.options
        if (target.href !== undefined) window.location.assign(target.href)
        else await router.commitNavigation(target as NavigateOptions<string>)
        return undefined
      }
    },
    [fn, router],
  )
}
