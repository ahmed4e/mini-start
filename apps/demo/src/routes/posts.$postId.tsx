import { createFileRoute, type ErrorComponentProps } from 'mini-start'
import { fetchPost } from '../data/posts'

export const Route = createFileRoute('/posts/$postId')({
  // params.postId is typed as string because of "$postId" in the id.
  loader: ({ params }) => fetchPost({ data: params.postId }),
  head: ({ loaderData }) => ({
    meta: [
      { title: `${loaderData.title} · mini-start` },
      { name: 'description', content: loaderData.body.slice(0, 140) },
    ],
  }),
  component: PostPage,
  notFoundComponent: PostNotFound,
  errorComponent: PostError,
})

function PostPage() {
  const post = Route.useLoaderData()
  return (
    <article>
      <h1>{post.title}</h1>
      <p className="muted small">
        Published {post.publishedAt.toDateString()} ·{' '}
        {[...post.tags].map((tag) => (
          <span key={tag} className="tag">
            {tag}
          </span>
        ))}
      </p>
      <p>{post.body}</p>
      <p className="muted small">
        <code>publishedAt</code> is a real <code>Date</code> and <code>tags</code> a real{' '}
        <code>Set</code>: the serializer keeps them intact.
      </p>
    </article>
  )
}

function PostNotFound() {
  const { postId } = Route.useParams()
  return (
    <div className="empty">
      <h2>Post not found</h2>
      <p className="muted">
        The loader threw <code>notFound()</code> for <code>{postId}</code>. The layout stayed on
        screen and the response status is 404.
      </p>
    </div>
  )
}

function PostError({ error, reset }: ErrorComponentProps) {
  return (
    <div className="empty error">
      <h2>Could not load this post</h2>
      <p>{error.message}</p>
      <button type="button" onClick={reset}>
        Retry
      </button>
    </div>
  )
}
