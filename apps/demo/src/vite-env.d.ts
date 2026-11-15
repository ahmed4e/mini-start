/// <reference types="vite/client" />

// The environment variables this app knows about. Read them through src/**/env.ts.
interface ImportMetaEnv {
  readonly VITE_APP_NAME?: string
  readonly VITE_API_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
