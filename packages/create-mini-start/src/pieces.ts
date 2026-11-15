/**
 * The vocabulary shared by patterns.ts and features.ts.
 *
 * A starter is made of pieces: components, hooks, stores and helpers. A
 * piece knows what it is (its kind, whether it holds state, which business
 * domain it belongs to) and how to print its source. It does not know where
 * it lives: each design pattern decides that from the piece's description.
 */
import path from 'node:path'
import type { AddOnId } from './options.ts'

export type Kind = 'atom' | 'molecule' | 'organism' | 'template' | 'page' | 'hook' | 'store' | 'lib' | 'provider'

/** Returns the import specifier for the piece called `name`, as written in the importing file. */
export type Importer = (name: string) => string

export interface Piece {
  /** File name without extension. Also the exported name, unless `exportName` is set. */
  name: string
  exportName?: string
  kind: Kind
  /** Defaults to tsx for components, pages and providers, ts for hooks, stores and libs. */
  ext?: 'ts' | 'tsx'
  /** Holds state or loads data (Smart-Dumb puts these in containers). */
  smart?: boolean
  /** The business domain it belongs to (Domain-Driven groups by this). */
  domain?: string
  /** Exported from its domain's index.ts, so code outside the domain may import it. */
  public?: boolean
  source: (i: Importer) => string
  addOn?: AddOnId
}

export interface Placement {
  /** Path relative to src/, without extension. */
  file: string
  /** Where other code imports it from, when that isn't the file itself (a folder or a domain index). */
  from?: string
}

export interface PatternFile {
  /** Path relative to the project folder. */
  path: string
  content: string
  /** The add-on that contributed this file, if any. */
  addOn?: AddOnId
}

/** How a component's global class names map into its CSS Module. */
export interface ModuleSpec {
  /** Starter layout rules that belong to this component, by selector. */
  select?: string[]
  /** Rules that aren't part of the starter layout (an add-on's, or the stories gallery's). */
  css?: string
  /** Global class name -> name inside the module. */
  classes: Record<string, string>
  /** Add a short entrance animation to this class, to show that @keyframes names are local too. */
  animate?: string
}

export const isComponent = (piece: Piece) => ['atom', 'molecule', 'organism', 'template'].includes(piece.kind)

export const extensionOf = (piece: Piece) => piece.ext ?? (['hook', 'store', 'lib'].includes(piece.kind) ? 'ts' : 'tsx')

export function relativeImport(fromFile: string, target: string): string {
  const rel = path.posix.relative(path.posix.dirname(fromFile), target)
  return rel.startsWith('.') ? rel : `./${rel}`
}

/** One import line per module, merging names that come from the same place. */
export function importLines(i: Importer, names: string[], exportNames: Record<string, string> = {}): string {
  const byModule = new Map<string, string[]>()
  for (const name of names) byModule.set(i(name), [...(byModule.get(i(name)) ?? []), exportNames[name] ?? name])
  return [...byModule].map(([from, list]) => `import { ${list.join(', ')} } from '${from}'`).join('\n')
}
