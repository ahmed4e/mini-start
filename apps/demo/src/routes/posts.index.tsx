import { createFileRoute } from 'mini-start'

export const Route = createFileRoute('/posts/')({
  component: () => (
    <div className="empty">
      <h2>Pick a post</h2>
      <p className="muted">This is the index route, rendered inside the posts layout.</p>
    </div>
  ),
})
