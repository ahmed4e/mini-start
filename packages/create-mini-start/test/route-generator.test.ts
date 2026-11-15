import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'
import { buildRouteNodes, generateRouteTree } from '../framework/src/vite/route-generator.ts'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mini-start-routes-'))
after(() => fs.rmSync(tmp, { recursive: true, force: true }))

const routesDir = path.join(tmp, 'src/routes')
const outFile = path.join(tmp, 'src/routeTree.gen.ts')
const files: Record<string, string> = {
  '__root.tsx': "export const Route = createRootRoute({ component: X })",
  'index.tsx': "export const Route = createFileRoute('/')({ component: X })",
  'posts.tsx': "export const Route = createFileRoute('/posts')({ component: X })",
  'posts.index.tsx': "export const Route = createFileRoute('/posts/')({ component: X })",
  'posts/$postId.tsx': "export const Route = createFileRoute('/wrong')({ component: X })",
  '_auth.tsx': "export const Route = createFileRoute('/_auth')({ component: X })",
  '_auth/dashboard.tsx': "export const Route = createFileRoute('/_auth/dashboard')({ component: X })",
  '(marketing)/pricing.tsx': "export const Route = createFileRoute('/pricing')({ component: X })",
  'files/$.tsx': "export const Route = createFileRoute('/files/$')({ component: X })",
  'api/health.ts': "export const Route = createFileRoute('/api/health')({ server: { handlers: {} } })",
  '-components/Card.tsx': 'export const Card = () => null',
  'posts.test.tsx': 'test()',
  'new-page.tsx': '',
}
for (const [file, content] of Object.entries(files)) {
  fs.mkdirSync(path.dirname(path.join(routesDir, file)), { recursive: true })
  fs.writeFileSync(path.join(routesDir, file), content)
}

describe('route generator', () => {
  it('derives ids, parents and paths from file names', () => {
    const nodes = buildRouteNodes(routesDir, outFile)
    const byId = Object.fromEntries(nodes.map((n) => [n.id, n]))
    assert.deepEqual(
      nodes.map((n) => n.id).sort(),
      ['/', '/_auth', '/_auth/dashboard', '/api/health', '/files/$', '/new-page', '/posts', '/posts/', '/posts/$postId', '/pricing', '__root__'].sort(),
    )
    assert.equal(byId['/posts/$postId']?.parent?.id, '/posts')
    assert.equal(byId['/posts/$postId']?.path, '$postId')
    assert.equal(byId['/posts/']?.parent?.id, '/posts')
    assert.equal(byId['/posts/']?.isIndex, true)
    assert.equal(byId['/_auth']?.isPathless, true)
    assert.equal(byId['/_auth/dashboard']?.fullPath, '/dashboard')
    assert.equal(byId['/pricing']?.parent?.id, '__root__')
    assert.equal(byId['/api/health']?.serverOnly, true)
  })

  it('writes the tree, registers types, and syncs route files', () => {
    assert.equal(generateRouteTree({ routesDir, outFile }), true)
    const tree = fs.readFileSync(outFile, 'utf8')
    assert.match(tree, /PostsRoute\._addChildren\(\[PostsIndexRoute, PostsPostIdRoute\]\)/)
    assert.match(tree, /'\/posts': typeof PostsIndexRouteImport/, 'index wins the navigable path')
    assert.match(tree, /'\/dashboard': typeof AuthDashboardRouteImport/)
    assert.doesNotMatch(tree, /'\/api\/health': typeof/, 'API routes are not navigable')
    assert.doesNotMatch(tree, /Card|posts\.test/, 'ignored files are skipped')
    assert.match(tree, /import\.meta\.hot\.accept/)

    // The mismatched id was rewritten, and the empty file scaffolded.
    assert.match(fs.readFileSync(path.join(routesDir, 'posts/$postId.tsx'), 'utf8'), /createFileRoute\('\/posts\/\$postId'\)/)
    assert.match(fs.readFileSync(path.join(routesDir, 'new-page.tsx'), 'utf8'), /createFileRoute\('\/new-page'\)/)

    assert.equal(generateRouteTree({ routesDir, outFile }), false, 'idempotent')
  })

  it('reports conflicting files', () => {
    fs.writeFileSync(path.join(routesDir, 'posts/route.tsx'), "export const Route = createFileRoute('/posts')({})")
    assert.throws(() => buildRouteNodes(routesDir, outFile), /both resolve to "\/posts"/)
    fs.rmSync(path.join(routesDir, 'posts/route.tsx'))
  })
})
