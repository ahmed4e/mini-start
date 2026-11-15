/**
 * The Vite plugin that turns a plain React + Vite app into a full-stack app.
 *
 *   plugins: [miniStart(), react()]
 *
 * What it does (mirroring @tanstack/start-plugin-core):
 *  - generates src/routeTree.gen.ts from src/routes (and keeps it updated)
 *  - configures two Vite environments: `client` (browser) and `ssr` (server)
 *  - provides virtual entry modules for both, so apps have no entry files
 *  - compiles server functions / API routes per environment (compiler.ts)
 *  - in dev, forwards every non-asset request to the server entry running in
 *    Vite's SSR module runner (`fetch(Request) => Response`)
 *  - on `vite build`, builds the client first (collecting server function ids
 *    and the asset manifest), then the server into dist/server/server.js
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  isRunnableDevEnvironment,
  normalizePath,
  parseAst,
  type Plugin,
  type ResolvedConfig,
  type ViteDevServer,
} from 'vite'
import type { Assets } from '../router/router.ts'
import { DEFAULT_SERVER_FN_BASE } from '../server-fn/constants.ts'
import { sendWebResponse, toWebRequest } from '../server/node.ts'
import { compile, type Node } from './compiler.ts'
import { generateRouteTree } from './route-generator.ts'

export interface MiniStartOptions {
  /** Default: 'src/routes' */
  routesDirectory?: string
  /** Default: 'src/routeTree.gen.ts' */
  generatedRouteTree?: string
  /** Module exporting `getRouter()`. Default: 'src/router.tsx' */
  routerEntry?: string
  /** URL prefix for server function calls. Default: '/_serverFn/' */
  serverFnBase?: string
}

const VIRTUAL = {
  clientEntry: 'virtual:mini-start/client-entry',
  devClientEntry: 'virtual:mini-start/dev-client-entry',
  serverEntry: 'virtual:mini-start/server-entry',
  nodeServer: 'virtual:mini-start/node-server',
  assets: 'virtual:mini-start/assets',
  serverFnManifest: 'virtual:mini-start/server-fn-manifest',
} as const
const VIRTUAL_IDS = new Set<string>(Object.values(VIRTUAL))
const DEV_CLIENT_ENTRY_URL = `/@id/__x00__${VIRTUAL.devClientEntry}`

interface ServerFnInfo {
  file: string
  name: string
}

// Shared with code running inside Vite's SSR module runner (same process in dev).
const shared = globalThis as typeof globalThis & {
  __MINI_START_FN_MANIFEST__?: Map<string, ServerFnInfo>
  __MINI_START_DEV_ASSETS__?: () => Assets
}

export function miniStart(options: MiniStartOptions = {}): Plugin[] {
  const serverFnBase = options.serverFnBase ?? DEFAULT_SERVER_FN_BASE
  const serverFns: Map<string, ServerFnInfo> = (shared.__MINI_START_FN_MANIFEST__ ??= new Map())

  let config: ResolvedConfig
  let root = process.cwd()
  let routesDir = ''
  let outFile = ''
  let routerEntry = ''
  let isDev = false

  const regenerate = () => {
    try {
      generateRouteTree({ routesDir, outFile })
    } catch (error) {
      config.logger.error(`[mini-start] ${(error as Error).message}`)
    }
  }

  const corePlugin: Plugin = {
    name: 'mini-start',

    config() {
      return {
        appType: 'custom',
        resolve: { dedupe: ['react', 'react-dom'] },
        optimizeDeps: {
          include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
          exclude: ['mini-start'],
        },
        environments: {
          client: {
            build: {
              outDir: 'dist/client',
              manifest: true,
              emptyOutDir: true,
              rolldownOptions: { input: { client: VIRTUAL.clientEntry } },
            },
          },
          ssr: {
            // The framework ships as TypeScript source, so it must be bundled.
            resolve: { noExternal: ['mini-start'] },
            build: {
              outDir: 'dist/server',
              emptyOutDir: true,
              copyPublicDir: false,
              rolldownOptions: {
                input: { server: VIRTUAL.nodeServer },
                output: { entryFileNames: '[name].js' },
              },
            },
          },
        },
        builder: {
          // Client first: its transforms discover every server function and
          // produce the asset manifest the server build embeds.
          async buildApp(builder) {
            await builder.build(builder.environments.client as never)
            await builder.build(builder.environments.ssr as never)
          },
        },
      }
    },

    configResolved(resolved) {
      config = resolved
      root = resolved.root
      isDev = resolved.command === 'serve'
      routesDir = path.resolve(root, options.routesDirectory ?? 'src/routes')
      outFile = path.resolve(root, options.generatedRouteTree ?? 'src/routeTree.gen.ts')
      routerEntry = normalizePath(path.resolve(root, options.routerEntry ?? 'src/router.tsx'))
      regenerate()
    },

    configureServer(server) {
      const onRouteFileEvent = (file: string) => {
        if (path.resolve(file).startsWith(routesDir + path.sep)) regenerate()
      }
      server.watcher.on('add', onRouteFileEvent)
      server.watcher.on('unlink', onRouteFileEvent)
      server.watcher.on('change', onRouteFileEvent)

      shared.__MINI_START_DEV_ASSETS__ = () => ({
        entry: DEV_CLIENT_ENTRY_URL,
        css: collectDevCss(server),
        dev: true,
      })

      // Returned function = runs after Vite's own middlewares (modules, /@vite/client, public/).
      return () => {
        server.middlewares.use(async (req, res) => {
          const ssr = server.environments.ssr
          try {
            if (!ssr || !isRunnableDevEnvironment(ssr)) {
              throw new Error('[mini-start] The "ssr" environment must be a runnable dev environment')
            }
            const entry = (await ssr.runner.import(VIRTUAL.serverEntry)) as {
              default: { fetch(request: Request): Promise<Response> }
            }
            await sendWebResponse(res, await entry.default.fetch(toWebRequest(req, res)))
          } catch (error) {
            if (error instanceof Error) server.ssrFixStacktrace(error)
            config.logger.error(error instanceof Error ? (error.stack ?? error.message) : String(error))
            if (res.headersSent) {
              res.end()
              return
            }
            res.statusCode = 500
            res.setHeader('content-type', 'text/html; charset=utf-8')
            res.end(devErrorPage(error))
          }
        })
      }
    },

    resolveId(id) {
      return VIRTUAL_IDS.has(id) ? `\0${id}` : undefined
    },

    async load(id) {
      if (!id.startsWith('\0virtual:mini-start/')) return undefined
      switch (id.slice(1)) {
        case VIRTUAL.clientEntry:
          return [
            `import { hydrateStart } from 'mini-start/client'`,
            `import { getRouter } from ${JSON.stringify(routerEntry)}`,
            'hydrateStart(getRouter)',
          ].join('\n')

        case VIRTUAL.devClientEntry: {
          // React Fast Refresh needs its preamble before any component module runs.
          // (Vite normally injects it into index.html; we render HTML ourselves.)
          const refresh = await this.resolve('/@react-refresh')
          const preamble = refresh
            ? 'import { injectIntoGlobalHook } from "/@react-refresh";\ninjectIntoGlobalHook(window);\nwindow.$RefreshReg$ = () => {};\nwindow.$RefreshSig$ = () => (type) => type;\nwindow.__vite_plugin_react_preamble_installed__ = true;\n'
            : ''
          return `${preamble}await import(${JSON.stringify(VIRTUAL.clientEntry)})\n`
        }

        case VIRTUAL.serverEntry:
          return [
            `import { createStartHandler } from 'mini-start/server'`,
            `import { getRouter } from ${JSON.stringify(routerEntry)}`,
            `import { getAssets } from ${JSON.stringify(VIRTUAL.assets)}`,
            `import { loadServerFn } from ${JSON.stringify(VIRTUAL.serverFnManifest)}`,
            `export default createStartHandler({ getRouter, getAssets, loadServerFn, serverFnBase: ${JSON.stringify(serverFnBase)}, dev: ${isDev} })`,
          ].join('\n')

        case VIRTUAL.nodeServer:
          return [
            `import handler from ${JSON.stringify(VIRTUAL.serverEntry)}`,
            `import { startNodeServer } from 'mini-start/node'`,
            `import { fileURLToPath } from 'node:url'`,
            `startNodeServer({ handler, clientDir: fileURLToPath(new URL('../client', import.meta.url)) })`,
          ].join('\n')

        case VIRTUAL.assets:
          if (isDev) return 'export const getAssets = () => globalThis.__MINI_START_DEV_ASSETS__()'
          return `const assets = ${JSON.stringify(readClientAssets(root, config))}\nexport const getAssets = () => assets`

        case VIRTUAL.serverFnManifest: {
          if (isDev) {
            // Ids were recorded by the compiler as modules were transformed.
            return [
              'export async function loadServerFn(id) {',
              '  const info = globalThis.__MINI_START_FN_MANIFEST__?.get(id)',
              '  if (info) await import(/* @vite-ignore */ info.file)',
              '}',
            ].join('\n')
          }
          // Production: importing every module that defines a server function
          // registers them all at startup (they are in the server bundle anyway).
          const files = [...new Set([...serverFns.values()].map((info) => info.file))]
          return [
            ...files.map((file) => `import ${JSON.stringify(file)}`),
            'export async function loadServerFn() {}',
          ].join('\n')
        }
      }
      return undefined
    },
  }

  const compilerPlugin: Plugin = {
    name: 'mini-start:compiler',
    // After TS/JSX are stripped, so the code is plain JavaScript.
    enforce: 'post',
    transform(code, id) {
      const file = id.split('?')[0] ?? ''
      if (
        id.startsWith('\0') ||
        !/\.[cm]?[jt]sx?$/.test(file) ||
        file.includes('/node_modules/') ||
        !file.startsWith(`${root}/`)
      ) {
        return undefined
      }
      const env = this.environment.config.consumer === 'client' ? 'client' : 'server'
      const result = compile({
        code,
        id: file,
        root,
        env,
        serverFnBase,
        parse: (source) => parseAst(source) as unknown as Node,
      })
      if (!result) return undefined
      for (const fn of result.serverFns) serverFns.set(fn.id, { file, name: fn.name })
      return { code: result.code, map: null }
    },
  }

  return [corePlugin, compilerPlugin]
}

interface ManifestChunk {
  file: string
  isEntry?: boolean
  css?: string[]
  imports?: string[]
}

function readClientAssets(root: string, config: ResolvedConfig): Assets {
  const outDir = path.resolve(root, config.environments.client?.build.outDir ?? 'dist/client')
  const manifestPath = path.join(outDir, '.vite', 'manifest.json')
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`[mini-start] Client manifest not found at ${manifestPath}. The client must be built first.`)
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Record<string, ManifestChunk>
  const entry = Object.values(manifest).find((chunk) => chunk.isEntry)
  if (!entry) throw new Error('[mini-start] No entry chunk in the client manifest')

  const css = new Set<string>()
  const seen = new Set<string>()
  const visit = (chunk: ManifestChunk) => {
    for (const file of chunk.css ?? []) css.add(file)
    for (const key of chunk.imports ?? []) {
      if (seen.has(key)) continue
      seen.add(key)
      const imported = manifest[key]
      if (imported) visit(imported)
    }
  }
  visit(entry)
  const base = config.base.endsWith('/') ? config.base : `${config.base}/`
  return { entry: base + entry.file, css: [...css].map((file) => base + file), dev: false }
}

const CSS_FILE = /\.(css|less|sass|scss|styl|stylus|pcss|postcss)$/

/** Stylesheets imported by modules the server has loaded, linked in <head> to avoid a flash of unstyled content. */
function collectDevCss(server: ViteDevServer): string[] {
  const urls: string[] = []
  const graph = server.environments.ssr?.moduleGraph
  if (!graph) return urls
  for (const mod of graph.idToModuleMap.values()) {
    if (mod.id && CSS_FILE.test(mod.id) && mod.importers.size > 0) {
      urls.push(`${mod.url}${mod.url.includes('?') ? '&' : '?'}direct`)
    }
  }
  return urls
}

function devErrorPage(error: unknown): string {
  const text = error instanceof Error ? (error.stack ?? error.message) : String(error)
  const escaped = text.replace(/[&<>]/g, (c) => `&#${c.charCodeAt(0)};`)
  return `<!DOCTYPE html><html><head><title>mini-start error</title><script type="module" src="/@vite/client"></script></head><body><h1>Server error</h1><pre style="white-space:pre-wrap">${escaped}</pre></body></html>`
}
