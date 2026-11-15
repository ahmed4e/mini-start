import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseAst } from 'vite'
import { compile, type Node, serverFnId } from '../framework/src/vite/compiler.ts'

const root = '/app'
const run = (code: string, env: 'client' | 'server', id = '/app/src/routes/todos.js') =>
  compile({
    code,
    id,
    root,
    env,
    serverFnBase: '/_serverFn/',
    parse: (source) => parseAst(source) as unknown as Node,
  })

const SOURCE = `import { createServerFn, createFileRoute, notFound } from 'mini-start'
import { db } from '../server/db'
import { helper, shared } from './utils'
import './side-effect.css'

const secret = process.env.SECRET
function formatRow(row) {
  return helper(row, secret)
}

export const listTodos = createServerFn().handler(async () => {
  const rows = await db.todos.list()
  if (!rows) throw notFound()
  return rows.map(formatRow)
})

export const addTodo = createServerFn({ method: 'POST' })
  .validator((input) => input)
  .handler(async ({ data }) => db.todos.add(data.title))

export const Route = createFileRoute('/todos')({
  server: {
    handlers: { GET: async () => Response.json(await db.todos.list()) },
  },
  loader: () => listTodos(),
  component: () => shared,
})
`

describe('compiler', () => {
  it('replaces handlers with RPC stubs on the client and removes server-only code', () => {
    const result = run(SOURCE, 'client')
    assert.ok(result)
    const code = result.code
    const listId = serverFnId('src/routes/todos.js', 'listTodos')
    assert.ok(code.includes(`createServerFn().handler(__mini_createClientRpc("${listId}", "/_serverFn/")`))
    assert.ok(code.includes('from "mini-start/client-rpc"'))
    assert.ok(!code.includes('db.todos'), 'handler bodies are gone')
    assert.ok(!code.includes("'../server/db'"), 'server-only import removed')
    assert.ok(!code.includes('formatRow') && !code.includes('process.env.SECRET'), 'helpers only used by handlers removed')
    assert.ok(code.includes('import { shared } from "./utils";'), 'partially used import keeps live specifiers')
    assert.ok(code.includes('import { createServerFn, createFileRoute } from "mini-start";'), 'notFound dropped, others kept')
    assert.ok(code.includes("import './side-effect.css'"), 'side-effect imports are kept')
    assert.ok(!code.includes('server:'), 'route server handlers stripped')
    assert.ok(code.includes('.validator((input) => input)'), 'validator kept')
    assert.equal(
      code.split('\n').indexOf('export const Route = createFileRoute(\'/todos\')({'),
      SOURCE.split('\n').indexOf('export const Route = createFileRoute(\'/todos\')({'),
      'line numbers are preserved',
    )
    assert.doesNotThrow(() => parseAst(code), 'output is valid JavaScript')
  })

  it('registers handlers with stable ids on the server and keeps everything else', () => {
    const result = run(SOURCE, 'server')
    assert.ok(result)
    const listId = serverFnId('src/routes/todos.js', 'listTodos')
    assert.ok(result.code.includes(`}, { id: "${listId}", url: "/_serverFn/${listId}" })`))
    assert.ok(result.code.includes('server:'), 'API handlers stay on the server')
    assert.ok(result.code.includes("'../server/db'"))
    assert.deepEqual(result.serverFns.map((f) => f.name), ['listTodos', 'addTodo'])
  })

  it('produces the same ids for the client and server builds', () => {
    const client = run(SOURCE, 'client')
    const server = run(SOURCE, 'server')
    assert.deepEqual(client?.serverFns, server?.serverFns)
  })

  it('ignores files that do not use mini-start factories', () => {
    assert.equal(run('export const createServerFn = () => 1; createServerFn()', 'client'), null)
    assert.equal(run('import { createServerFn } from "other-lib"; createServerFn().handler(() => 1)', 'client'), null)
    assert.equal(run('const x = { server: 1 }', 'client'), null)
  })

  it('handles aliased imports and repeated anonymous functions', () => {
    const code = `import { createServerFn as fn } from 'mini-start'
export default fn().handler(() => 1)
const list = [fn().handler(() => 2), fn().handler(() => 3)]
export { list }`
    const result = run(code, 'server', '/app/src/a.js')
    assert.deepEqual(result?.serverFns.map((f) => f.name), ['default', 'anonymous', 'anonymous_2'])
  })
})
