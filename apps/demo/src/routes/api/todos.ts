import { createFileRoute } from 'mini-start'
import { db } from '../../server/db'

// GET /api/todos and POST /api/todos {"title": "..."}.
// The `server` block (and therefore the db import) is removed from the client bundle.
export const Route = createFileRoute('/api/todos')({
  server: {
    handlers: {
      GET: async () => Response.json(await db.todos.list()),
      POST: async ({ request }) => {
        const body = (await request.json().catch(() => null)) as { title?: unknown } | null
        const title = typeof body?.title === 'string' ? body.title.trim() : ''
        if (!title) return Response.json({ error: 'title is required' }, { status: 400 })
        return Response.json(await db.todos.add(title), { status: 201 })
      },
    },
  },
})
