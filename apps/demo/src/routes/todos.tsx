import { createFileRoute, createServerFn, useRouter } from 'mini-start'
import { type FormEvent, useState } from 'react'
import { db } from '../server/db'

const listTodos = createServerFn().handler(() => db.todos.list())

const addTodo = createServerFn({ method: 'POST' })
  .validator((input: { title: string }) => {
    const title = typeof input?.title === 'string' ? input.title.trim() : ''
    if (!title) throw new Error('A todo needs a title.')
    if (title.length > 80) throw new Error('Keep it under 80 characters.')
    return { title }
  })
  .handler(({ data }) => db.todos.add(data.title))

const toggleTodo = createServerFn({ method: 'POST' })
  .validator((id: string) => id)
  .handler(({ data: id }) => db.todos.toggle(id))

const removeTodo = createServerFn({ method: 'POST' })
  .validator((id: string) => id)
  .handler(({ data: id }) => db.todos.remove(id))

export const Route = createFileRoute('/todos')({
  loader: () => listTodos(),
  head: () => ({ meta: [{ title: 'Todos · mini-start' }] }),
  component: TodosPage,
})

function TodosPage() {
  const todos = Route.useLoaderData()
  const router = useRouter()
  const [title, setTitle] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Call a server function, then re-run the loader so the list is fresh.
  const mutate = async (action: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await action()
      await router.invalidate()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    void mutate(async () => {
      await addTodo({ data: { title } })
      setTitle('')
    })
  }

  return (
    <section className="card">
      <h1>Todos</h1>
      <p className="muted">
        Each action is a POST server function. Validation runs on the server; try submitting an
        empty title.
      </p>
      <form onSubmit={onSubmit} className="row">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="What needs doing?"
          aria-label="New todo"
        />
        <button type="submit" disabled={busy}>
          Add
        </button>
      </form>
      {error && <p className="error-text">{error}</p>}
      <ul className="todo-list">
        {todos.map((todo) => (
          <li key={todo.id} className={todo.done ? 'done' : undefined}>
            <label>
              <input
                type="checkbox"
                checked={todo.done}
                disabled={busy}
                onChange={() => void mutate(() => toggleTodo({ data: todo.id }))}
              />
              {todo.title}
            </label>
            <button
              type="button"
              className="link-button"
              disabled={busy}
              onClick={() => void mutate(() => removeTodo({ data: todo.id }))}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
      {todos.length === 0 && <p className="muted">Nothing to do.</p>}
    </section>
  )
}
