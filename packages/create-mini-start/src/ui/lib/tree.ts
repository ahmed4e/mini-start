/** Turns the flat list of planned files into folders for the preview's file tree. */
import type { PlannedFile } from '../../generate.ts'

export interface DirNode {
  name: string
  /** Path from the project root, e.g. "src/components". "" for the root. */
  path: string
  dirs: DirNode[]
  files: PlannedFile[]
}

export function buildTree(files: PlannedFile[]): DirNode {
  const root: DirNode = { name: '', path: '', dirs: [], files: [] }
  for (const file of files) {
    const parts = file.path.split('/')
    let node = root
    for (let i = 0; i < parts.length - 1; i++) {
      const name = parts[i]!
      let child = node.dirs.find((d) => d.name === name)
      if (!child) {
        child = { name, path: parts.slice(0, i + 1).join('/'), dirs: [], files: [] }
        node.dirs.push(child)
      }
      node = child
    }
    node.files.push(file)
  }
  sort(root)
  return root
}

function sort(node: DirNode) {
  node.dirs.sort((a, b) => a.name.localeCompare(b.name))
  node.files.sort((a, b) => a.path.localeCompare(b.path))
  node.dirs.forEach(sort)
}

export function containsAny(node: DirNode, paths: ReadonlySet<string>): boolean {
  return node.files.some((f) => paths.has(f.path)) || node.dirs.some((d) => containsAny(d, paths))
}

export function fileName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

export function extension(path: string): string {
  const name = fileName(path)
  return name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : ''
}
