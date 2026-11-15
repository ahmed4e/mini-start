import { createFileRoute, Link, useNavigate } from 'mini-start'

const FRAMEWORKS = [
  'React', 'Preact', 'Solid', 'Svelte', 'Vue', 'Angular', 'Qwik', 'Lit', 'Ember', 'Alpine',
  'Astro', 'Remix', 'Next.js', 'Nuxt', 'SvelteKit', 'SolidStart', 'Analog', 'TanStack Start',
  'React Router', 'Gatsby', 'Docusaurus', 'Eleventy', 'Hugo', 'Fresh', 'Hono', 'Elysia',
]
const PAGE_SIZE = 5

export const Route = createFileRoute('/search')({
  // Whatever this returns is the typed search state for the route.
  validateSearch: (raw) => ({
    q: typeof raw.q === 'string' ? raw.q : '',
    page: typeof raw.page === 'number' && raw.page > 0 ? Math.floor(raw.page) : 1,
  }),
  loader: ({ search }) => {
    const matches = FRAMEWORKS.filter((name) => name.toLowerCase().includes(search.q.toLowerCase()))
    const pages = Math.max(1, Math.ceil(matches.length / PAGE_SIZE))
    const page = Math.min(search.page, pages)
    return {
      total: matches.length,
      page,
      pages,
      results: matches.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    }
  },
  head: () => ({ meta: [{ title: 'Search · mini-start' }] }),
  component: SearchPage,
})

function SearchPage() {
  const { q } = Route.useSearch()
  const { results, total, page, pages } = Route.useLoaderData()
  const navigate = useNavigate()

  return (
    <section className="card">
      <h1>Typed search params</h1>
      <p className="muted">
        The query string is the state: <code>?q=…&amp;page=…</code>. Reload, share or go back and it
        is all still here.
      </p>
      <input
        defaultValue={q}
        placeholder="Filter frameworks"
        aria-label="Search"
        onChange={(e) => void navigate({ to: '/search', search: { q: e.target.value, page: 1 }, replace: true })}
      />
      <p className="muted small">
        {total} result{total === 1 ? '' : 's'} · page {page} of {pages}
      </p>
      <ul className="nav-list">
        {results.map((name) => (
          <li key={name}>{name}</li>
        ))}
      </ul>
      <div className="row">
        {page > 1 && (
          <Link to="/search" search={{ q, page: page - 1 }}>
            ← Previous
          </Link>
        )}
        {page < pages && (
          <Link to="/search" search={{ q, page: page + 1 }}>
            Next →
          </Link>
        )}
      </div>
    </section>
  )
}
