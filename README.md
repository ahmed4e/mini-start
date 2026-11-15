# mini-start

A starter-project builder. You choose a framework, a design pattern and
add-ons in a browser UI, and it creates a project that contains only what you
chose.

```
packages/create-mini-start             the project builder (browser UI and terminal)
apps/demo                              a project the builder generated, with every add-on
packages/create-mini-start/framework   the mini-start framework: a separate reference project (see below)
docs/                                  notes on how TanStack Start works
```

## Create a new project

```bash
pnpm install
pnpm dev                    # the project builder, on http://localhost:5173
pnpm create-app --ui        # the same builder on its default port (4600)
pnpm create-app my-app      # or pick from lists in the terminal (arrow keys, space, enter)
```

The builder lets you name the project, pick a package manager, and choose:

- **Framework**: React (more will follow)
- **Design pattern**: Atomic Design (default), Component-Driven, Smart-Dumb,
  Domain-Driven or Web Components
- **Styling**: Tailwind CSS, CSS Modules
- **App**: routing (React Router), state management (Zustand), data fetching
  (TanStack Query), a theme toggle, env variables + error handling
- **Quality**: testing (Vitest + Testing Library), Husky + lint-staged
- **Deploy**: Docker + nginx

You see every generated file before you click **Create**. The builder then
writes the files, installs dependencies, and runs `git init`.

A new project is a plain React + TypeScript app on Vite. Without add-ons its
only runtime dependencies are `react` and `react-dom`. See
[`packages/create-mini-start`](packages/create-mini-start/README.md) for what
each choice adds.

## The demo app

`apps/demo` is a project the builder generated: Atomic Design with every
add-on except Husky and Docker (a git hook and an image build both need the
project to be the top of its own repository). It is
never edited by hand. After changing what the builder generates, run
`pnpm demo:sync`; a test fails while the two differ.

```bash
pnpm demo           # dev server: http://localhost:5180
pnpm demo:build     # type-check and build to apps/demo/dist
pnpm demo:start     # serve the built app
pnpm test:demo      # the demo's own tests (Vitest)
pnpm demo:sync      # regenerate apps/demo from the builder
```

## Checks

```bash
pnpm test           # 50 unit tests (node:test, no extra dependencies)
pnpm typecheck      # the builder, the framework and the demo
```

Requires Node.js 22.18+ (the tests run TypeScript directly) and pnpm.

## The mini-start framework

`packages/create-mini-start/framework` is a separate piece of work that lives
in this repo: a from-scratch, minimal re-implementation of **TanStack Start**
(file-based routing, type-safe links, loaders, streaming SSR with hydration,
server functions and API routes) in about 4,000 lines of commented
TypeScript, with no TanStack packages. The builder does not use it, and new
projects don't contain it. No app in this repo runs on it any more; it is kept
as a reference implementation with its unit tests.
[`docs/how-tanstack-start-works.md`](docs/how-tanstack-start-works.md) explains
how TanStack Start works internally and maps each piece to the file that
re-implements it. The rest of this page describes the framework.

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

## Framework tests

`pnpm test` includes 23 tests of the framework: route matching, loading
semantics, dehydrate/hydrate, the serializer (including prototype-pollution
and script-injection safety), the stream injector, the compiler (stubs, id
stability, dead-code elimination, line preservation) and the route generator.

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
