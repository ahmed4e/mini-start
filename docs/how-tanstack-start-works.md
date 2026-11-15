# How TanStack Start works

This is what I found when I took TanStack Start apart to rebuild it as
mini-start. Everything here comes from reading the TypeScript sources that ship
inside the npm packages (TanStack is MIT-licensed and open source). The versions
studied were:

| Package | Version |
| --- | --- |
| `@tanstack/react-start` | 1.169.5 |
| `@tanstack/start-plugin-core` | 1.171.56 |
| `@tanstack/start-server-core` / `start-client-core` | 1.17x |
| `@tanstack/router-core` | 1.171.39 |
| `@tanstack/react-router` | 1.170.46 |

File paths below are relative to each package's `src/` folder. For mini-start,
that is `packages/create-mini-start/framework/src/`.

## The big picture

TanStack Start is **TanStack Router plus a Vite plugin plus a server runtime**.

```
            ┌─────────── vite build / vite dev ───────────┐
src/routes ─┤ router-plugin: generate routeTree.gen.ts    │
            │ start-compiler: rewrite createServerFn etc. │
            │ two Vite environments: client + ssr         │
            └─────────────────────────────────────────────┘
                              │
          ┌───────────────────┴────────────────────┐
     client bundle                            server bundle
  hydrate + client router             one fetch(Request) => Response
  server fns = fetch stubs            server fns / API routes / SSR
```

The server is a single Web-standard handler. Every request goes through
`fetch(request)`, which returns a `Response`, both in development (inside Vite)
and in production (behind Node, Bun, Workers and so on).

## 1. Two Vite environments and virtual entries

`start-plugin-core/constants.ts` defines two Vite environments: `client`, and
`ssr` for the server. The server environment is called `ssr` "to ensure backwards
compatibility with vite plugins that are not compatible with the new vite
environment API". Apps have no entry files. The plugin supplies virtual modules
instead:

```ts
ENTRY_POINTS = {
  client: 'virtual:tanstack-start-client-entry',
  server: 'virtual:tanstack-start-server-entry',
  start:  '#tanstack-start-entry',
  router: '#tanstack-router-entry',
}
```

`vite/plugins.ts` (`createDevClientEntryPlugin`) builds the development client
entry. TanStack renders the HTML itself and never goes through `index.html`, so
it has to inject the React Fast Refresh preamble by hand
(`injectIntoGlobalHook(window)`, `window.$RefreshReg$ = ...`) before importing
the real client entry.

## 2. Development server: Vite middleware runs the server entry

`vite/dev-server-plugin/plugin.ts` installs one middleware that runs after Vite's
own:

```ts
const webReq = new NodeRequest({ req, res })            // Node -> Web Request
const serverEntry = await serverEnv.runner.import(ENTRY_POINTS.server)
const webRes = await serverEntry['default'].fetch(webReq)
return sendNodeResponse(res, webRes)                    // Web Response -> Node
```

The server code runs inside Vite's **module runner** (the SSR environment), in
the same Node process as the plugin. Edits are picked up because the runner
invalidates the modules that changed. Because everything shares one process, the
plugin can share state with server code through `globalThis`. For example,
`globalThis.TSS_ROUTES_MANIFEST` is used to collect development CSS for the
matched routes.

## 3. File-based routing and type registration

The router plugin scans `src/routes` and writes `routeTree.gen.ts`. Its shape:

```ts
import { Route as PostsRouteImport } from './routes/posts'
const PostsRoute = PostsRouteImport.update({
  id: '/posts', path: '/posts', getParentRoute: () => rootRouteImport,
} as any)
...
export const routeTree = rootRouteImport._addFileChildren(rootRouteChildren)._addFileTypes<FileRouteTypes>()

declare module '@tanstack/react-router' {
  interface FileRoutesByPath { '/posts': { ... parentRoute: typeof rootRouteImport } }
}
declare module '@tanstack/react-start' {
  interface Register { ssr: true; router: Awaited<ReturnType<typeof getRouter>> }
}
```

Each route file calls `createFileRoute('/posts/$postId')({...})` and so starts
out detached. The generated file wires it to its parent. **Type safety comes from
declaration merging**: the generated file augments interfaces exported by the
library, and template-literal types turn `'/posts/$postId'` into
`{ postId: string }` and restrict `<Link to>` to real paths. The generator also
rewrites the `createFileRoute('...')` string when a file moves.

## 4. Server functions are compiled three ways

`start-compiler/handleCreateServerFn.ts` is the heart of Start. It finds every
`createServerFn(...).handler(fn)` and replaces the handler expression depending
on where the module is being compiled:

| Where | Becomes | Effect |
| --- | --- | --- |
| client bundle | `createClientRpc(functionId)` | the body is gone; calling it does an HTTP request |
| SSR bundle (caller) | `createSsrRpc(functionId)` | looks the function up by id and calls it directly |
| "provider" module (`file?tss-serverfn-split`) | `createServerRpc(meta, fn)` | the real implementation, registered by id |

After rewriting, Babel dead-code elimination removes the imports and declarations
that only the deleted handler used. That is why `import { db } from './db'` never
reaches the browser.

The runtime stubs are tiny:

- `start-client-core/client-rpc/createClientRpc.ts` builds the URL
  `process.env.TSS_SERVER_FN_BASE + functionId` and calls `serverFnFetcher`.
- `serverFnFetcher.ts` sets `x-tsr-serverFn: true`, puts the payload in the query
  string for GET and in the body for POST, and serializes with **seroval**
  (`toJSONAsync` / `fromCrossJSON`).
- `start-server-core/createSsrRpc.ts` runs `getServerFnById(id)` and then calls
  the function directly, with no HTTP.

## 5. Request dispatch: `createStartHandler`

`start-server-core/createStartHandler.ts` decides what each request is:

1. **The path starts with `TSS_SERVER_FN_BASE`.** The server-function id is the
   next path segment, and `handleServerAction({ request, serverFnId })` handles
   it. It also warns when no CSRF middleware is configured.
2. **Otherwise it calls `handleServerRoutes`.** This matches routes. If the
   exactly-matched route has `server.handlers[METHOD]` (or `ANY`; `HEAD` falls
   back to `GET`), it is an API route. Route-level server middleware runs first.
3. **Otherwise it calls `executeRouter`.** That refuses non-HTML `Accept` headers
   (406), then:

   ```ts
   attachRouterServerSsrUtils({ router, manifest, ... })
   await router.load()                                   // beforeLoad + loaders
   if (router._serverResult?.type === 'redirect') return redirect
   await router.serverSsr.dehydrate()                    // serialize state
   return renderRouterToStream(...)                      // stream HTML
   ```

A fresh router is created for every request (`getRouter()`), using memory
history.

## 6. Streaming SSR and dehydration

`react-router/ssr/renderRouterToStream.tsx` calls React's
`renderToReadableStream` (or `renderToPipeableStream`) and pipes the result
through `transformReadableStreamWithRouter`.

`router-core/ssr/STREAMING.md` and `ssr-server.ts` describe the protocol:

- **Two producers.** React produces HTML. Seroval produces "hydration sources"
  (JavaScript strings), using `crossSerializeStream` over the dehydrated router
  state, which contains every match's loader data.
- **Promises inside loader data** produce extra sources when they settle. That
  is how deferred data streams in.
- **The first `<Scripts>` render** takes every source that is ready and emits it
  as initial `<script>` tags, followed by a "boundary" marker.
- **Later sources become self-removing "late records".** The transform inserts
  them at **safe points** in React's output: React treats each `</script>` as a
  safe point. The transform holds back the canonical `</body></html>` until
  every source has been flushed.
- **`tsrScript.ts`** defines the bootstrap global `self.$_TSR` with a buffer, and
  hydration and stream-end flags used for cleanup.

## 7. Hydration

`router-core/load-client.ts` → `hydrate(router)`:

- reads `window.$_TSR.router` (the dehydrated state)
- matches the current URL on the client
- fills each match with the server's `loaderData` instead of running loaders
  again
- then the React adapter calls `hydrateRoot(document, <StartClient />)`

The entire document, including `<html>` and `<head>`, belongs to React. Head tags
come from each route's `head()` and are rendered by `<HeadContent />`.

## 8. What mini-start reproduces, and how

| TanStack Start piece | mini-start equivalent |
| --- | --- |
| `start-plugin-core` Vite plugin, environments, virtual entries | `src/vite/index.ts` |
| `router-generator` → `routeTree.gen.ts` + `declare module` | `src/vite/route-generator.ts` |
| `start-compiler` (Babel) + dead-code elimination | `src/vite/compiler.ts` (Vite's ESTree `parseAst` + string edits) |
| dev middleware `serverEntry.fetch(NodeRequest)` | `configureServer` in `src/vite/index.ts` + `src/server/node.ts` |
| `createStartHandler` dispatch | `src/server/handler.ts` |
| `handleServerAction` | `src/server/server-functions.ts` |
| `createClientRpc` / `createSsrRpc` / `createServerRpc` | `src/server-fn/client-rpc.ts`, `createServerFn.ts`, `registry.ts` |
| seroval | `src/ssr/serializer.ts` (tagged JSON + promise references) |
| `$_TSR` + `transformStreamWithRouter` | `src/ssr/stream.ts` (`SsrStream` + `createHtmlInjector`) |
| `router-core` matching/loading | `src/router/router.ts` |
| `hydrate()` | `Router.hydrate` + `src/client/index.tsx` |
| `<HeadContent>`, `<Scripts>`, `<Outlet>`, `<Link>`, `<Await>` | `src/react/*` |

### Deliberate simplifications

- **No "provider" split module.** The server bundle keeps the real handler in
  place and passes `{ id }` as an extra argument, which registers it. In
  development the plugin records `id → file` as it transforms modules, and the
  server imports that file when an unknown id arrives. In production every
  defining module is imported at startup.
- **One safe point.** Late data is inserted right after a `</script>` in React's
  output, and anything left over before `</body></html>` is flushed at the end.
  There is no 16 KB chunking, nonce support or backlog limit.
- **A custom serializer** instead of seroval. It handles Date, Map, Set, BigInt,
  RegExp, URL, Error, undefined, NaN, ±Infinity, -0 and promises. It does not
  preserve shared references, and class instances arrive as plain objects.
- **No route code splitting.** The client bundle contains all routes.
- **No middleware layer** (`createMiddleware`) and no `createIsomorphicFn`.
  Request context comes from `AsyncLocalStorage` (`getRequest()`).
