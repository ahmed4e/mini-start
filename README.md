# mini-start

Two things live in this repo:

- **A starter-project builder.** You choose a framework, a design pattern and
  add-ons in a browser UI, and it creates a project that contains only what
  you chose.
- **The mini-start framework.** A from-scratch, minimal re-implementation of
  TanStack Start, with a demo app. New projects don't use it or contain it.

```
packages/create-mini-start             the project builder (browser UI and terminal)
packages/create-mini-start/framework   the mini-start framework (TypeScript source)
apps/demo                              a demo app built with the framework
docs/                                  notes on how TanStack Start works
```

## Create a new project

```bash
pnpm dev                    # the project builder, on http://localhost:5173
pnpm create-app --ui        # the same builder on its default port (4600)
pnpm create-app my-app      # or answer prompts in the terminal
```

The builder lets you name the project, choose a framework (React for now) and
a design pattern (Atomic Design by default, or Component-Driven, Smart-Dumb,
Domain-Driven or Web Components), add Tailwind CSS and a Husky + lint-staged pre-commit hook, pick a package manager,
and preview every generated file before you click **Create**. It then writes
the files, installs dependencies, and runs `git init`.

A new project is a plain React + TypeScript app on Vite. Its only runtime
dependencies are `react` and `react-dom` (plus `lit` for the Web Components
pattern). See [`packages/create-mini-start`](packages/create-mini-start/README.md).

## The mini-start framework

A full-stack React framework on Vite, re-implementing the core of **TanStack
Start**: file-based routing, type-safe links, loaders, streaming SSR with
hydration, server functions and API routes. It uses no TanStack packages; its
only runtime dependencies are React and Vite. It is about 4,000 lines of
heavily commented TypeScript.
[`docs/how-tanstack-start-works.md`](docs/how-tanstack-start-works.md) explains
how TanStack Start works internally and maps each piece to the file here that
re-implements it. The rest of this page is about the framework and its demo
app.

## Quick start

```bash
pnpm install
pnpm dev            # the project builder: http://localhost:5173
pnpm demo           # the demo app (apps/demo): http://localhost:5180
pnpm demo:build     # demo: dist/client (browser) + dist/server/server.js
pnpm demo:start     # demo: production server on PORT (default 3000)
pnpm test           # unit tests (node:test, no extra dependencies)
pnpm typecheck      # includes compile-time tests of route type safety
```

Requires Node.js 22.18+ (the tests run TypeScript directly) and pnpm.

## What a mini-start app looks like

```ts
// vite.config.ts
export default defineConfig({ plugins: [miniStart(), react()] })

// src/router.tsx
export const getRouter = () => createRouter({ routeTree })
```

```tsx
// src/routes/posts.$postId.tsx
export const Route = createFileRoute('/posts/$postId')({
  loader: ({ params }) => fetchPost({ data: params.postId }),   // params.postId: string
  head: ({ loaderData }) => ({ meta: [{ title: loaderData.title }] }),
  component: () => <h1>{Route.useLoaderData().title}</h1>,
  notFoundComponent: () => <p>No such post</p>,
})

// anywhere: runs on the server, callable from the client
export const fetchPost = createServerFn({ method: 'GET' })
  .validator((id: string) => id)
  .handler(async ({ data }) => {
    const post = await db.posts.get(data)        // db never reaches the browser
    if (!post) throw notFound()
    return post
  })

// src/routes/api/health.ts: an API route
export const Route = createFileRoute('/api/health')({
  server: { handlers: { GET: () => Response.json({ ok: true }) } },
})
```

```tsx
<Link to="/posts/$postId" params={{ postId: '1' }}>…</Link>   // ✔
<Link to="/posts/$postId">…</Link>                           // ✘ missing params
<Link to="/nope">…</Link>                                    // ✘ unknown route
```

## Features

| Feature | How |
| --- | --- |
| File-based routing | `__root`, `index`, layouts (`posts.tsx`, `posts/route.tsx`), `$param`, `$` splat, `_pathless` layouts, `(group)` folders, `-ignored` files. The `createFileRoute('<id>')` string is kept in sync with the file's location, and empty route files are scaffolded. |
| Type-safe routing | The generated `declare module 'mini-start'` registers routes, so `to`, `params`, `search`, `redirect()` and `navigate()` are checked at compile time. Typed `useLoaderData`, `useParams` and `useSearch`. |
| Data loading | `beforeLoad` (runs in order, extends `context`, can `redirect()`), `loader` (runs in parallel), `validateSearch`, preloading on hover (`intent`), `router.invalidate()`. |
| Boundaries | `notFound()` → nearest `notFoundComponent` (404). Errors → `errorComponent` (500). The layout stays mounted. |
| SSR + hydration | React renders the whole document. Loader data is embedded once and not refetched in the browser. Includes `<HeadContent />` and `<Scripts />`. |
| Streaming | Return un-awaited promises from a loader and use `<Await>`. The shell streams immediately and data follows as self-removing scripts. Hydration starts before the stream ends. |
| Server functions | GET/POST, `validator` (a failure returns 400), redirect/notFound pass through, a returned `Response` is passed through, a custom-header CSRF guard, and `useServerFn`. |
| API routes | `server.handlers` with `GET`/`POST`/…/`ANY`, 405 with `Allow`. Stripped from the client bundle. |
| Dev experience | HMR for route files (the route tree is swapped in place, no reload), React Fast Refresh for components, stylesheets linked during SSR to avoid a flash of unstyled content. |
| Production | `vite build` builds the client first (asset manifest + server-function ids), then the server. A Node server serves hashed assets as immutable and blocks path traversal. |

## How a request flows

1. **Request.** Node (or Vite in dev) converts it to a Web `Request` and calls
   `handler.fetch(request)`.
2. **Dispatch.**
   - `/_serverFn/<id>` → run the registered server function.
   - A route with `server.handlers` → API route.
   - Otherwise → SSR.
3. **SSR.** A new router matches the URL, runs `beforeLoad` from parent to child,
   then all loaders in parallel. A redirect becomes a 307; not-found and errors
   set 404 or 500.
4. **Render.** `renderToReadableStream` produces the HTML. `<Scripts />` embeds
   the dehydrated state, with promises replaced by references. Values for those
   references are spliced in after the next `</script>` as they resolve.
5. **Hydrate.** The browser decodes the state, gives each match its server data,
   and calls `hydrateRoot(document, …)`.
6. **Navigate.** `<Link>` is a real `<a>`. Clicks run loaders in the browser;
   server functions turn into `fetch` calls.

## Testing

- `pnpm test`: 41 unit tests. They cover route matching, loading semantics,
  dehydrate/hydrate, the serializer (including prototype-pollution and
  script-injection safety), the stream injector, the compiler (stubs, id
  stability, dead-code elimination, line preservation), the route generator,
  and the project generator.
- `pnpm typecheck`: `apps/demo/src/type-checks.tsx` contains `@ts-expect-error`
  cases that fail the build if type safety regresses.
- `pnpm --filter demo e2e [url]` (start `pnpm demo` first): a real-browser test over the Chrome DevTools
  Protocol, with 26 checks: hydration, client navigation, preload cache reuse,
  boundaries, back/forward, mutations, validation, search params, redirects,
  streaming, and no console errors. It needs Chrome; set `CHROME_PATH` if Chrome
  isn't found automatically.

## Not included (compared with TanStack Start)

- route-level code splitting
- request/function middleware
- isomorphic functions
- RSC
- prerendering and SPA mode
- non-Node deployment adapters
- seroval-level serialization (shared references, custom adapters)
- pending components with timing thresholds
- search-param middlewares
- `loaderDeps` and stale-while-revalidate caching

These are explained in the docs.
