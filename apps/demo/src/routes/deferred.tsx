import { Await, createFileRoute, createServerFn } from 'mini-start'

const slowQuery = createServerFn({ method: 'GET' })
  .validator((ms: number) => Math.min(Math.max(ms, 0), 5000))
  .handler(async ({ data: ms }) => {
    await new Promise((resolve) => setTimeout(resolve, ms))
    return { tookMs: ms, finishedAt: new Date() }
  })

export const Route = createFileRoute('/deferred')({
  loader: () => ({
    // Awaited data is part of the initial HTML...
    shellRenderedAt: new Date(),
    // ...un-awaited promises are streamed in when they resolve.
    slow: slowQuery({ data: 1000 }),
    slower: slowQuery({ data: 2500 }),
  }),
  head: () => ({ meta: [{ title: 'Streaming · mini-start' }] }),
  component: DeferredPage,
})

function DeferredPage() {
  const { shellRenderedAt, slow, slower } = Route.useLoaderData()
  return (
    <section className="card">
      <h1>Streaming SSR</h1>
      <p className="muted">
        The shell below was sent at {shellRenderedAt.toLocaleTimeString()}. Reload the page and
        watch the two boxes fill in: the HTML response stays open and the server streams each
        result (markup <em>and</em> data) as soon as it is ready.
      </p>
      <div className="grid">
        <Await promise={slow} fallback={<Pending label="1 second query" />}>
          {(result) => <Resolved label="1 second query" {...result} />}
        </Await>
        <Await promise={slower} fallback={<Pending label="2.5 second query" />}>
          {(result) => <Resolved label="2.5 second query" {...result} />}
        </Await>
      </div>
    </section>
  )
}

function Pending({ label }: { label: string }) {
  return (
    <div className="card stream-box pending">
      <strong>{label}</strong>
      <p className="muted">Loading…</p>
    </div>
  )
}

function Resolved({ label, tookMs, finishedAt }: { label: string; tookMs: number; finishedAt: Date }) {
  return (
    <div className="card stream-box done">
      <strong>{label}</strong>
      <p>
        Finished in {tookMs}ms at {finishedAt.toLocaleTimeString()}
      </p>
    </div>
  )
}
