import { createFileRoute, redirect } from 'mini-start'

// A server request gets a 307; a client-side navigation is replaced in history.
export const Route = createFileRoute('/old-posts')({
  beforeLoad: () => {
    throw redirect({ to: '/posts' })
  },
  component: () => null,
})
