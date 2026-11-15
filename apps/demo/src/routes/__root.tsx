import { createRootRoute, HeadContent, Link, Outlet, Scripts, useRouterState } from 'mini-start'
import '../styles.css'

// The same layout create-mini-start generates, plus a nav for the demo pages.
export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'mini-start' },
      {
        name: 'description',
        content: 'A from-scratch re-implementation of the ideas behind TanStack Start.',
      },
    ],
    links: [{ rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' }],
  }),
  component: RootLayout,
  notFoundComponent: NotFound,
})

function RootLayout() {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <PendingBar />
        <header className="site-header">
          <Link to="/" className="brand">
            mini-start
          </Link>
          <nav>
            <Link to="/posts" activeProps={{ className: 'active' }}>
              Posts
            </Link>
            <Link to="/todos" activeProps={{ className: 'active' }}>
              Todos
            </Link>
            <Link to="/deferred" activeProps={{ className: 'active' }}>
              Streaming
            </Link>
            <Link to="/search" search={{ q: 'react' }} activeProps={{ className: 'active' }}>
              Search
            </Link>
            <Link to="/about" activeProps={{ className: 'active' }}>
              About
            </Link>
          </nav>
        </header>
        <main className="container">
          <Outlet />
        </main>
        <Scripts />
      </body>
    </html>
  )
}

/** A thin progress bar while a client-side navigation loads data. */
function PendingBar() {
  const pending = useRouterState((s) => s.status === 'pending')
  return <div className="pending-bar" data-active={pending} aria-hidden="true" />
}

function NotFound() {
  return (
    <section className="card">
      <h1>Page not found</h1>
      <p className="muted">There is no route for this URL.</p>
      <Link to="/">Back home</Link>
    </section>
  )
}
