import { createFileRoute, createServerFn, Link } from 'mini-start'
import type { ReactNode } from 'react'

// Defined in a route file: the handler body (process.*) only exists in the server bundle.
const getServerInfo = createServerFn().handler(async () => ({
  renderedAt: new Date(),
  node: process.version,
  platform: process.platform,
  uptimeSeconds: Math.round(process.uptime()),
}))

export const Route = createFileRoute('/')({
  loader: () => getServerInfo(),
  component: Home,
})

function Home() {
  const info = Route.useLoaderData()
  return (
    <>
      <section className="hero">
        <h1>A full-stack React framework, built from scratch</h1>
        <p>
          mini-start re-implements the core of TanStack Start — file-based routing, loaders,
          streaming SSR with hydration, server functions and API routes — on top of Vite and
          React, without any TanStack packages.
        </p>
      </section>

      <section className="card">
        <h2>Loaded by a server function</h2>
        <p className="muted">
          On the first request this ran during SSR (a direct call). After a client-side navigation
          it runs over HTTP. The <code>Date</code> survives serialization either way.
        </p>
        <dl className="facts">
          <dt>Rendered at</dt>
          <dd>{info.renderedAt.toLocaleTimeString()}</dd>
          <dt>Node.js</dt>
          <dd>{info.node}</dd>
          <dt>Platform</dt>
          <dd>{info.platform}</dd>
          <dt>Server uptime</dt>
          <dd>{info.uptimeSeconds}s</dd>
        </dl>
      </section>

      <section className="grid">
        <Feature to="/posts" title="Nested routes + loaders">
          Layout route with an index and a dynamic child, typed params, preloading on hover,
          404 and error boundaries.
        </Feature>
        <Feature to="/todos" title="Server functions">
          GET and POST RPCs with input validation, then <code>router.invalidate()</code>.
        </Feature>
        <Feature to="/deferred" title="Streaming SSR">
          Un-awaited promises in loader data stream in after the shell.
        </Feature>
        <Feature to="/search" title="Typed search params">
          <code>validateSearch</code> turns the query string into typed state.
        </Feature>
      </section>

      <p className="muted">
        API routes: <a href="/api/health">/api/health</a> · <a href="/api/todos">/api/todos</a> ·
        Redirect: <Link to="/old-posts">/old-posts</Link>
      </p>
    </>
  )
}

function Feature({
  to,
  title,
  children,
}: {
  to: '/posts' | '/todos' | '/deferred' | '/search'
  title: string
  children: ReactNode
}) {
  return (
    <Link to={to} className="card feature">
      <h3>{title} →</h3>
      <p>{children}</p>
    </Link>
  )
}
