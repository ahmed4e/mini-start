/** The terminal command that creates the same project as the form. */
import type { ProjectOptions } from '../../options.ts'
import type { BuilderInfo } from '../../ui-server.ts'

export function cliCommand(info: BuilderInfo, options: ProjectOptions): string {
  const parts = [info.command, options.name.trim() || '<name>']
  parts.push('--framework', options.framework)
  parts.push('--pattern', options.pattern)
  parts.push('--add-ons', options.addOns.length ? options.addOns.join(',') : 'none')
  parts.push('--pm', options.packageManager)
  if (!options.install) parts.push('--no-install')
  if (!options.git) parts.push('--no-git')
  const dir = options.parentDir.trim()
  if (dir && dir !== info.cwd) parts.push('--dir', shellQuote(dir))
  return parts.join(' ')
}

export function shellQuote(value: string): string {
  return /^[\w@%+=:,./~-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`
}

/** Where the project would go, shown until the server answers with the resolved path. */
export function joinPath(dir: string, name: string): string {
  return `${dir.replace(/\/+$/, '')}/${name.trim()}`
}
