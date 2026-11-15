/**
 * Turns the user's choices into the full list of files to write. Nothing
 * touches the target folder here, so the browser UI can call this on every
 * change to show a live preview.
 *
 * A new project contains only what was chosen: the framework (React on
 * Vite), the design pattern's folders, and any add-ons. Nothing of this
 * tool or of the mini-start framework is copied into it.
 */
import fs from 'node:fs'
import type { AddOnId, ProjectOptions } from './options.ts'
import { planPattern } from './patterns.ts'
import * as t from './templates.ts'

export interface PlannedFile {
  /** Path relative to the project folder, with forward slashes. */
  path: string
  content: string
  /** The add-on that contributed this file, if any. */
  addOn?: AddOnId
}

/** This tool's own version, shown in the builder. */
export function toolVersion(): string {
  const manifest = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
  return manifest.version
}

export function planProject(
  options: Pick<ProjectOptions, 'name' | 'framework' | 'pattern' | 'addOns' | 'packageManager'>,
): PlannedFile[] {
  const ctx: t.TemplateContext = {
    name: options.name,
    framework: options.framework,
    pattern: options.pattern,
    addOns: new Set(options.addOns),
    packageManager: options.packageManager,
  }
  const pattern = planPattern(ctx)
  const files: PlannedFile[] = []
  const add = (file: string, content: string, addOn?: AddOnId) =>
    files.push({ path: file, content, ...(addOn ? { addOn } : {}) })

  add('package.json', t.packageJson(ctx))
  add('tsconfig.json', t.tsconfigJson())
  add('vite.config.ts', t.viteConfig(ctx))
  add('.gitignore', t.gitignore(ctx))
  add('README.md', t.readme(ctx, pattern.guide))
  add('index.html', t.indexHtml(ctx))
  add('public/favicon.svg', t.faviconSvg())
  add('src/main.tsx', t.mainTsx(pattern.main))
  add('src/styles.css', t.stylesCss(ctx, [pattern.tagCss, pattern.css].filter(Boolean).join('\n\n') || undefined, pattern.globalSelectors))
  for (const file of pattern.files) add(file.path, file.content, file.addOn)
  if (ctx.addOns.has('docker')) {
    add('Dockerfile', t.dockerfile(ctx), 'docker')
    add('.dockerignore', t.dockerignore(), 'docker')
    add('nginx.conf', t.nginxConf(ctx), 'docker')
    add('compose.yaml', t.composeYaml(ctx), 'docker')
  }
  if (ctx.addOns.has('husky')) {
    add('.husky/pre-commit', t.huskyPreCommit(ctx.packageManager), 'husky')
    add('.oxlintrc.json', t.oxlintConfig(), 'husky')
    add('.prettierrc.json', t.prettierConfig(), 'husky')
    add('.prettierignore', t.prettierIgnore(), 'husky')
  }

  return files.sort((a, b) => a.path.localeCompare(b.path))
}
