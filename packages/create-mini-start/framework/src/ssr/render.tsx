import { renderToReadableStream } from 'react-dom/server'
import { RouterProvider } from '../react/RouterProvider.tsx'
import type { Router } from '../router/router.ts'
import { createHtmlInjector, type SsrStream } from './stream.ts'

/** Render the loaded router to a streaming HTML Response. */
export async function renderToResponse(
  router: Router,
  ssr: SsrStream,
  status: number,
): Promise<Response> {
  const stream = await renderToReadableStream(
    <RouterProvider router={router} />,
    {
      onError(error) {
        // Errors inside <Suspense> (e.g. a rejected <Await>) are recovered on the client.
        console.error('[mini-start] SSR error:', error)
      },
    },
  )
  return new Response(stream.pipeThrough(createHtmlInjector(ssr)), {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  })
}
