/**
 * Server-only "database". It imports a Node built-in, so if any of this ever
 * leaked into the browser bundle the build would show it. The compiler
 * removes the imports of this module from client code because they are only
 * used inside server function handlers and API route handlers.
 */
import { randomUUID } from 'node:crypto'

export interface Post {
  id: string
  title: string
  body: string
  publishedAt: Date
  tags: Set<string>
}

export interface Todo {
  id: string
  title: string
  done: boolean
  createdAt: Date
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const posts: Post[] = [
  {
    id: 'file-routing',
    title: 'File-based routing',
    body: 'Every file in src/routes becomes a route. The Vite plugin scans the folder and generates routeTree.gen.ts, which wires parents to children and registers types so <Link to> only accepts real paths.',
    publishedAt: new Date('2026-01-12T09:00:00Z'),
    tags: new Set(['routing', 'codegen']),
  },
  {
    id: 'server-functions',
    title: 'Server functions',
    body: 'createServerFn().handler(fn) is compiled twice: in the server bundle the real function is registered under a stable id, in the client bundle it becomes a tiny fetch to /_serverFn/<id>.',
    publishedAt: new Date('2026-02-03T09:00:00Z'),
    tags: new Set(['rpc', 'compiler']),
  },
  {
    id: 'streaming',
    title: 'Streaming SSR',
    body: 'Loaders can return promises without awaiting them. The server streams the page shell immediately, then streams each value as a small script when it resolves.',
    publishedAt: new Date('2026-03-21T09:00:00Z'),
    tags: new Set(['ssr', 'suspense']),
  },
]

const todos = new Map<string, Todo>()
for (const title of ['Read the route generator', 'Trace a server function call', 'Watch the HTML stream']) {
  const id = randomUUID()
  todos.set(id, { id, title, done: false, createdAt: new Date() })
}

export const db = {
  posts: {
    async list() {
      await sleep(120)
      return posts.map(({ id, title, publishedAt }) => ({ id, title, publishedAt }))
    },
    async get(id: string) {
      await sleep(120)
      return posts.find((post) => post.id === id) ?? null
    },
  },
  todos: {
    async list() {
      return [...todos.values()].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    },
    async add(title: string) {
      const todo: Todo = { id: randomUUID(), title, done: false, createdAt: new Date() }
      todos.set(todo.id, todo)
      return todo
    },
    async toggle(id: string) {
      const todo = todos.get(id)
      if (todo) todo.done = !todo.done
      return todo ?? null
    },
    async remove(id: string) {
      return todos.delete(id)
    },
  },
}
