/**
 * Server functions can live in any module, not only in route files.
 * Route loaders import these; in the browser bundle the handlers (and the
 * `db` import) are replaced by RPC stubs.
 */
import { createServerFn, notFound } from 'mini-start'
import { db } from '../server/db'

export const fetchPosts = createServerFn({ method: 'GET' }).handler(async () => {
  return db.posts.list()
})

export const fetchPost = createServerFn({ method: 'GET' })
  .validator((postId: string) => {
    if (typeof postId !== 'string' || postId.length > 100) {
      throw new Error('Invalid post id')
    }
    return postId
  })
  .handler(async ({ data: postId }) => {
    if (postId === 'broken') {
      throw new Error('This post failed to load (on purpose, to show error boundaries).')
    }
    const post = await db.posts.get(postId)
    if (!post) throw notFound(`No post with id "${postId}"`)
    return post
  })
