import { createFileRoute } from 'mini-start'

// An API route: only `server.handlers`, no component.
export const Route = createFileRoute('/api/health')({
  server: {
    handlers: {
      GET: () =>
        Response.json({
          status: 'ok',
          time: new Date().toISOString(),
          uptimeSeconds: Math.round(process.uptime()),
        }),
    },
  },
})
