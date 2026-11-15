/**
 * Compile-time tests for route type safety. Not imported anywhere; `pnpm
 * typecheck` fails if a valid line errors or an @ts-expect-error line stops
 * erroring.
 */
import { createServerFn, Link, redirect, useNavigate } from 'mini-start'
import { Route as PostRoute } from './routes/posts.$postId'
import { Route as SearchRoute } from './routes/search'

export function TypeChecks() {
  const navigate = useNavigate()
  void navigate({ to: '/posts/$postId', params: { postId: '1' } })
  // @ts-expect-error params are required for a dynamic path
  void navigate({ to: '/posts/$postId' })

  return (
    <>
      <Link to="/" />
      <Link to="/posts" />
      <Link to="/posts/$postId" params={{ postId: 'abc' }} />
      <Link to="/search" search={{ q: 'vite', page: 2 }} />

      {/* @ts-expect-error unknown path */}
      <Link to="/does-not-exist" />
      {/* @ts-expect-error missing params */}
      <Link to="/posts/$postId" />
      {/* @ts-expect-error wrong param name */}
      <Link to="/posts/$postId" params={{ id: 'abc' }} />
      {/* @ts-expect-error API routes are not navigable */}
      <Link to="/api/todos" />
      {/* @ts-expect-error search params are typed by validateSearch */}
      <Link to="/search" search={{ page: 'two' }} />
    </>
  )
}

export function routeHookTypes() {
  const post = PostRoute.useLoaderData()
  const title: string = post.title
  const tags: Set<string> = post.tags
  const { postId }: { postId: string } = PostRoute.useParams()
  const { q, page }: { q: string; page: number } = SearchRoute.useSearch()
  // @ts-expect-error loader data is typed
  const wrong: number = post.title
  return { title, tags, postId, q, page, wrong }
}

export function serverFnTypes() {
  const noInput = createServerFn().handler(() => 42)
  const withInput = createServerFn({ method: 'POST' })
    .validator((input: { name: string }) => input)
    .handler(({ data }) => `hello ${data.name}`)

  const a: Promise<number> = noInput()
  const b: Promise<string> = withInput({ data: { name: 'x' } })
  // @ts-expect-error input is required when a validator declares one
  void withInput()
  // @ts-expect-error input is type-checked
  void withInput({ data: { name: 1 } })
  return { a, b }
}

export function redirectTypes() {
  redirect({ to: '/posts/$postId', params: { postId: '1' } })
  // @ts-expect-error unknown redirect target
  redirect({ to: '/nowhere' })
}
