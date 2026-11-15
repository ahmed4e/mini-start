import { createFileRoute } from 'mini-start'

export const Route = createFileRoute('/about')({
  head: () => ({
    meta: [
      { title: 'About · mini-start' },
      { name: 'description', content: 'How mini-start works, in one page.' },
    ],
  }),
  component: About,
})

const STEPS: Array<[string, string]> = [
  ['Request', 'The Node server (or Vite in dev) turns the HTTP request into a Web Request and calls one fetch(request) handler.'],
  ['Dispatch', '/_serverFn/<id> runs a server function; a route with server.handlers answers as an API route; everything else is rendered.'],
  ['Load', 'A fresh router matches the URL, runs beforeLoad top-down, then every loader in parallel.'],
  ['Render', 'React streams the HTML. Loader data is embedded as a script; unresolved promises follow as more scripts while the stream is open.'],
  ['Hydrate', 'The browser reads the embedded state instead of re-running loaders, then hydrates the whole document.'],
  ['Navigate', 'Links are real <a> tags. Clicks run loaders on the client (server functions become fetch calls) and swap matches.'],
]

function About() {
  return (
    <section className="card">
      <h1>How it works</h1>
      <ol className="steps">
        {STEPS.map(([title, text]) => (
          <li key={title}>
            <strong>{title}.</strong> {text}
          </li>
        ))}
      </ol>
      <p className="muted">
        The full write-up, with references to the TanStack Start source each piece was modeled
        on, is in <code>docs/how-tanstack-start-works.md</code>.
      </p>
    </section>
  )
}
