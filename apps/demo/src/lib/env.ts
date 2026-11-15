/**
 * Every environment variable the app reads, in one typed place. Components
 * import `env`, never `import.meta.env`, so a missing or misspelled variable
 * shows up here.
 *
 * Variables come from .env files (see .env.example) and must start with
 * VITE_ to reach the browser. Never put secrets in them: they end up in the
 * built JavaScript.
 */
export const env = {
  appName: import.meta.env.VITE_APP_NAME ?? 'demo',
  /** Base URL of the API, without a trailing slash. */
  apiUrl: (import.meta.env.VITE_API_URL ?? `${import.meta.env.BASE_URL}api`).replace(/\/$/, ''),
}
