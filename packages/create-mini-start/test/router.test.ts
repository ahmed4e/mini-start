import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { notFound, redirect } from '../framework/src/router/errors.ts'
import { createMemoryHistory } from '../framework/src/router/history.ts'
import { interpolatePath, parseSearch, stringifySearch } from '../framework/src/router/path.ts'
import { type AnyRoute, createFileRoute, createRootRoute } from '../framework/src/router/route.ts'
import { createRouter } from '../framework/src/router/router.ts'

describe('path utilities', () => {
  it('interpolates params and splats', () => {
    assert.equal(interpolatePath('/posts/$postId', { postId: 'a b' }), '/posts/a%20b')
    assert.equal(interpolatePath('/files/$', { _splat: 'x/y z' }), '/files/x/y%20z')
    assert.equal(interpolatePath('/posts/'), '/posts')
    assert.equal(interpolatePath('/'), '/')
    assert.throws(() => interpolatePath('/posts/$postId', {}), /Missing param "postId"/)
  })

  it('round-trips typed search params', () => {
    const search = { q: 'react', page: 2, tags: ['a', 'b'], flag: true, numeric: '123' }
    const str = stringifySearch(search)
    assert.deepEqual(parseSearch(str), search)
    assert.equal(stringifySearch({}), '')
    assert.equal(stringifySearch({ skip: undefined }), '')
  })
})

function buildTree() {
  const root = createRootRoute()
  const make = (id: string, path: string, parent: AnyRoute, extra: { isIndex?: boolean } = {}) =>
    createFileRoute(id)({ component: () => null })._init({
      id,
      path,
      fullPath: id.replace(/\/$/, '') || '/',
      parent,
      ...extra,
    })
  const index = make('/', '/', root, { isIndex: true })
  const posts = make('/posts', 'posts', root)
  const postsIndex = make('/posts/', '/', posts, { isIndex: true })
  const postsNew = make('/posts/new', 'new', posts)
  const post = make('/posts/$postId', '$postId', posts)
  const files = make('/files/$', 'files/$', root)
  const auth = make('/_auth', '', root)
  const dashboard = make('/_auth/dashboard', 'dashboard', auth)
  posts._addChildren([postsIndex, postsNew, post])
  auth._addChildren([dashboard])
  return root._addChildren([index, posts, files, auth])
}

describe('route matching', () => {
  const router = createRouter({ routeTree: buildTree(), history: createMemoryHistory('/') })
  const ids = (path: string) => router.matchRoutes(path)?.routes.map((r) => r.id)

  it('picks the most specific branch', () => {
    assert.deepEqual(ids('/'), ['__root__', '/'])
    assert.deepEqual(ids('/posts'), ['__root__', '/posts', '/posts/'])
    assert.deepEqual(ids('/posts/'), ['__root__', '/posts', '/posts/'])
    assert.deepEqual(ids('/posts/new'), ['__root__', '/posts', '/posts/new'])
    assert.deepEqual(ids('/posts/42'), ['__root__', '/posts', '/posts/$postId'])
    assert.deepEqual(ids('/dashboard'), ['__root__', '/_auth', '/_auth/dashboard'])
  })

  it('extracts and decodes params', () => {
    assert.deepEqual(router.matchRoutes('/posts/hello%20world')?.params, { postId: 'hello world' })
    assert.deepEqual(router.matchRoutes('/files/a/b/c.txt')?.params, { _splat: 'a/b/c.txt' })
  })

  it('returns null when nothing matches and never matches a pathless layout alone', () => {
    assert.equal(router.matchRoutes('/nope'), null)
    assert.equal(router.matchRoutes('/posts/1/extra'), null)
  })
})

describe('loading', () => {
  it('runs beforeLoad sequentially, loaders in parallel, and exposes context', async () => {
    const order: string[] = []
    const root = createRootRoute({
      beforeLoad: () => {
        order.push('root:before')
        return { user: 'ada' }
      },
      loader: async () => {
        order.push('root:loader')
        return 'root-data'
      },
    })
    const page = createFileRoute('/page')({
      loader: async ({ context }) => {
        order.push('page:loader')
        return `hello ${(context as { user: string }).user}`
      },
    })._init({ id: '/page', path: 'page', fullPath: '/page', parent: root })
    root._addChildren([page])

    const router = createRouter({ routeTree: root, history: createMemoryHistory('/page') })
    await router.load()
    assert.equal(order[0], 'root:before')
    assert.deepEqual(router.state.matches.map((m) => m.loaderData), ['root-data', 'hello ada'])
    assert.equal(router.state.statusCode, 200)
  })

  it('turns notFound(), errors and redirects into state', async () => {
    const root = createRootRoute()
    const missing = createFileRoute('/missing')({
      loader: (): string => {
        throw notFound()
      },
    })._init({ id: '/missing', path: 'missing', fullPath: '/missing', parent: root })
    const broken = createFileRoute('/broken')({
      loader: (): string => {
        throw new Error('boom')
      },
    })._init({ id: '/broken', path: 'broken', fullPath: '/broken', parent: root })
    const old = createFileRoute('/old')({
      beforeLoad: () => {
        throw redirect({ to: '/missing' })
      },
    })._init({ id: '/old', path: 'old', fullPath: '/old', parent: root })
    root._addChildren([missing, broken, old])

    const load = async (url: string) => {
      const router = createRouter({ routeTree: root, history: createMemoryHistory(url) })
      await router.load()
      return router.state
    }

    const nf = await load('/missing')
    assert.equal(nf.statusCode, 404)
    assert.equal(nf.matches.length, 1, 'renders at the root boundary')
    assert.equal(nf.matches[0]?.globalNotFound, true)

    const err = await load('/broken')
    assert.equal(err.statusCode, 500)
    assert.equal(err.matches[1]?.status, 'error')
    assert.equal((err.matches[1]?.error as Error).message, 'boom')

    const unmatched = await load('/nowhere')
    assert.equal(unmatched.statusCode, 404)

    const redirected = await load('/old')
    assert.equal(redirected.redirect?.options.to, '/missing')
  })

  it('dehydrates on the server and hydrates without re-running loaders', async () => {
    let calls = 0
    const root = createRootRoute()
    const page = createFileRoute('/p')({
      loader: () => {
        calls++
        return { when: new Date(0) }
      },
    })._init({ id: '/p', path: 'p', fullPath: '/p', parent: root })
    root._addChildren([page])

    const server = createRouter({ routeTree: root, history: createMemoryHistory('/p') })
    await server.load()
    const state = server.dehydrate({ entry: '/e.js', css: [], dev: false })

    const client = createRouter({ routeTree: root, history: createMemoryHistory('/p') })
    client.hydrate(state)
    assert.equal(calls, 1)
    assert.deepEqual(client.state.matches[1]?.loaderData, { when: new Date(0) })
    assert.equal(client.ssr?.assets.entry, '/e.js')
  })
})
