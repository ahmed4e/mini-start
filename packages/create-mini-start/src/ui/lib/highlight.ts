/**
 * A tiny syntax highlighter for the preview: comments, strings, keywords,
 * numbers and tags. It returns tokens, one array per line, which React
 * renders as text (nothing is parsed as HTML).
 */

export interface Token {
  text: string
  /** CSS class: tc comment, ts string, tk keyword, tn number, tt tag/key. */
  cls?: string
}

type Rule = [RegExp, string]

const STRING = /'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"/
const TS: Rule[] = [
  [/\/\/[^\n]*|\/\*[\s\S]*?\*\//, 'tc'],
  [new RegExp(`${STRING.source}|\`(?:\\\\.|[^\`\\\\])*\``), 'ts'],
  [/<\/?[A-Z][\w.]*|<\/?[a-z][\w-]*(?=[\s>/])/, 'tt'],
  [
    /\b(?:import|export|from|const|let|var|function|return|async|await|if|else|for|of|in|new|throw|try|catch|finally|type|interface|default|as|typeof|void|null|undefined|true|false|while|switch|case|break|continue|extends|keyof|readonly)\b/,
    'tk',
  ],
  [/\b\d+(?:\.\d+)?\b/, 'tn'],
]
const YAML: Rule[] = [
  [/#[^\n]*/, 'tc'],
  [/^\s*[\w-]+(?=:)/, 'tt'],
]

const RULES: Record<string, Rule[]> = {
  ts: TS,
  tsx: TS,
  js: TS,
  css: [
    [/\/\*[\s\S]*?\*\//, 'tc'],
    [STRING, 'ts'],
    [/@[\w-]+/, 'tk'],
    [/--[\w-]+/, 'tt'],
    [/#[0-9a-fA-F]{3,8}\b|\b\d*\.?\d+(?:px|rem|em|ms|s|%|fr|ch|vw|vh|deg)?\b/, 'tn'],
  ],
  json: [
    [/"(?:\\.|[^"\\\n])*"(?=\s*:)/, 'tt'],
    [STRING, 'ts'],
    [/\b(?:true|false|null)\b|-?\b\d+(?:\.\d+)?\b/, 'tn'],
  ],
  yaml: YAML,
  yml: YAML,
  md: [
    [/^#{1,6} [^\n]*/, 'tk'],
    [/`[^`\n]+`/, 'ts'],
  ],
}

// One regex per language: each rule is a capture group, so the group that matched names the class.
const COMPILED = new Map(
  Object.entries(RULES).map(([lang, rules]) => [lang, new RegExp(rules.map(([re]) => `(${re.source})`).join('|'), 'gm')]),
)

export function highlight(text: string, ext: string): Token[][] {
  const lines: Token[][] = [[]]
  const push = (chunk: string, cls?: string) => {
    chunk.split('\n').forEach((part, i) => {
      if (i > 0) lines.push([])
      if (part) lines[lines.length - 1]!.push({ text: part, cls })
    })
  }
  const rules = RULES[ext]
  const re = COMPILED.get(ext)
  if (!rules || !re) {
    push(text)
    return lines
  }
  let last = 0
  for (const match of text.matchAll(re)) {
    if (match.index > last) push(text.slice(last, match.index))
    const group = match.slice(1).findIndex((g) => g !== undefined)
    push(match[0], rules[group]?.[1])
    last = match.index + match[0].length
  }
  push(text.slice(last))
  return lines
}
