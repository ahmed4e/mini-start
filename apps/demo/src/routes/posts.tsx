import { createFileRoute, Link, Outlet } from 'mini-start'
import { fetchPosts } from '../data/posts'

// Layout route: renders for /posts and every /posts/* child.
export const Route = createFileRoute('/posts')({
  loader: () => fetchPosts(),
  head: () => ({ meta: [{ title: 'Posts · mini-start' }] }),
  component: PostsLayout,
})

function PostsLayout() {
  const posts = Route.useLoaderData()
  return (
    <div className="split">
      <aside className="card">
        <h2>Posts</h2>
        <ul className="nav-list">
          {posts.map((post) => (
            <li key={post.id}>
              {/* `params` is required and typed because the path has $postId */}
              <Link
                to="/posts/$postId"
                params={{ postId: post.id }}
                activeProps={{ className: 'active' }}
              >
                {post.title}
              </Link>
            </li>
          ))}
          <li>
            <Link to="/posts/$postId" params={{ postId: 'missing' }} className="muted">
              A missing post (404)
            </Link>
          </li>
          <li>
            <Link to="/posts/$postId" params={{ postId: 'broken' }} className="muted">
              A broken post (error)
            </Link>
          </li>
        </ul>
        <p className="muted small">Hover a link: its data is preloaded before you click.</p>
      </aside>
      <section className="card grow">
        <Outlet />
      </section>
    </div>
  )
}
