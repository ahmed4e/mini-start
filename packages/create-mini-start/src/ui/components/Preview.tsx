/** The right panel: a file tree of the project the options would create, and the selected file's code. */
import { Fragment, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { PlannedFile } from '../../generate.ts'
import { highlight } from '../lib/highlight.ts'
import { buildTree, containsAny, type DirNode, extension, fileName } from '../lib/tree.ts'
import { ChevronIcon } from './icons.tsx'

const DEFAULT_FILE = 'src/App.tsx'

interface Props {
  files: PlannedFile[]
  fresh: ReadonlySet<string>
  generation: number
}

export function Preview({ files, fresh, generation }: Props) {
  const [selected, setSelected] = useState(DEFAULT_FILE)
  // Folders start open, including ones an option adds later; this remembers the ones the user closed.
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const tree = useMemo(() => buildTree(files), [files])
  const file = files.find((f) => f.path === selected) ?? files.find((f) => f.path === DEFAULT_FILE) ?? files[0]
  const lines = useMemo(() => files.reduce((sum, f) => sum + f.content.split('\n').length - 1, 0), [files])

  const toggle = (path: string) =>
    setCollapsed((current) => {
      const next = new Set(current)
      if (!next.delete(path)) next.add(path)
      return next
    })

  return (
    <section className="panel preview" aria-label="Preview of the generated files">
      <div className="preview-head">
        <h2>Preview</h2>
        <span className="preview-stats">{files.length > 0 && `${files.length} files · ${lines.toLocaleString()} lines`}</span>
      </div>
      <div className="preview-body">
        <nav className="tree" aria-label="Files">
          <TreeRows
            node={tree}
            depth={0}
            tree={{ collapsed, toggle, selected: file?.path, select: setSelected, fresh, generation }}
          />
        </nav>
        <CodeView file={file} />
      </div>
    </section>
  )
}

interface TreeContext {
  collapsed: ReadonlySet<string>
  toggle: (path: string) => void
  selected: string | undefined
  select: (path: string) => void
  fresh: ReadonlySet<string>
  generation: number
}

function TreeRows({ node, depth, tree }: { node: DirNode; depth: number; tree: TreeContext }) {
  // A changed file flashes; so does a closed folder that contains one. Keying flashing rows by
  // the preview's generation remounts them, which restarts the animation when a file changes again.
  const flashKey = (path: string, flash: boolean) => (flash ? `${path}@${tree.generation}` : path)
  return (
    <>
      {node.dirs.map((dir) => {
        const open = !tree.collapsed.has(dir.path)
        const flash = !open && containsAny(dir, tree.fresh)
        return (
          <Fragment key={dir.path}>
            <button
              key={flashKey(dir.path, flash)}
              type="button"
              className={`row dir${open ? ' open' : ''}${flash ? ' fresh' : ''}`}
              aria-expanded={open}
              style={{ paddingLeft: 8 + depth * 14 }}
              onClick={() => tree.toggle(dir.path)}
            >
              <ChevronIcon />
              <span className="name">{dir.name}</span>
            </button>
            {open && <TreeRows node={dir} depth={depth + 1} tree={tree} />}
          </Fragment>
        )
      })}
      {node.files.map((file) => {
        const flash = tree.fresh.has(file.path)
        return (
          <button
            key={flashKey(file.path, flash)}
            type="button"
            className={`row${file.path === tree.selected ? ' selected' : ''}${flash ? ' fresh' : ''}`}
            style={{ paddingLeft: 20 + depth * 14 }}
            onClick={() => tree.select(file.path)}
          >
            <span className={`dot ${extension(file.path)}`} />
            <span className="name">{fileName(file.path)}</span>
            {file.addOn && <span className="tag">{file.addOn}</span>}
          </button>
        )
      })}
    </>
  )
}

function CodeView({ file }: { file: PlannedFile | undefined }) {
  const ref = useRef<HTMLDivElement>(null)
  const path = file?.path ?? ''
  const content = file?.content ?? ''
  const lines = useMemo(() => highlight(content.replace(/\n$/, ''), extension(path)), [content, path])

  // A different file starts at the top; the same file with new content keeps its scroll position.
  useLayoutEffect(() => {
    if (ref.current) ref.current.scrollTop = 0
  }, [path])

  return (
    <div className="code" ref={ref}>
      {file && (
        <>
          <div className="code-head">
            <span>{file.path}</span>
            <span>{lines.length} lines</span>
          </div>
          <pre className="src">
            {lines.map((tokens, i) => (
              <span className="ln" key={i}>
                {tokens.map((token, j) =>
                  token.cls ? (
                    <span key={j} className={token.cls}>
                      {token.text}
                    </span>
                  ) : (
                    <Fragment key={j}>{token.text}</Fragment>
                  ),
                )}
              </span>
            ))}
          </pre>
        </>
      )}
    </div>
  )
}
