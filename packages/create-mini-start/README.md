# create-mini-start

Creates starter projects. You choose a framework, a design pattern and
add-ons in a browser UI (or in the terminal), and it writes a project that
contains only what you chose.

```bash
pnpm dev                        # from this repo: the project builder on http://localhost:5173
pnpm create-app --ui            # the same builder on port 4600
pnpm create-app my-app          # terminal prompts
pnpm create-app my-app -y       # defaults, no prompts
```

## The project builder (`--ui`)

`--ui` starts a local server and opens it in your browser. On the page you
can:

- name the project and choose where it goes, with live checks for invalid
  names and folders that aren't empty
- pick a framework (React for now), a design pattern (Atomic Design by
  default) and add-ons (Tailwind CSS, Husky + lint-staged)
- pick a package manager (only installed ones can be selected), and whether
  to install dependencies and run `git init`
- browse a live preview of every generated file; files an option changes
  are highlighted when you toggle it
- copy the equivalent terminal command
- click **Create project** and follow the steps as they run, including the
  install log, then open the result in VS Code or create another

The server listens on localhost only. Each run uses a random token, which is
in the URL the CLI prints, and API calls without it are refused. Requests
with a foreign `Host` or `Origin` header are refused too, so other websites
can't use it to write files or run installs.

## Options

| Flag | |
| --- | --- |
| `--ui` | Use the browser UI |
| `--framework <name>` | `react` (the default, and the only one so far) |
| `--pattern <name>` | `atomic` (the default), `component-driven`, `smart-dumb`, `domain-driven` or `web-components` |
| `--add-ons <list>` | `tailwind` (on by default) and/or `husky`, comma-separated, or `none` |
| `--pm <name>` | `pnpm`, `npm`, `yarn` or `bun` |
| `--dir <path>` | Parent folder (default: where you ran the command) |
| `--no-install` / `--no-git` | Skip those steps |
| `-y`, `--yes` | Don't prompt; use defaults for anything not passed |
| `--port <n>`, `--no-open` | For `--ui` |

## What a new project contains

A React + TypeScript app on Vite: `index.html`, `src/main.tsx`, `src/App.tsx`,
`src/styles.css`, the design pattern's folders, and the usual config files.
Its only runtime dependencies are `react` and `react-dom` (plus `lit` for the
Web Components pattern). Nothing from this tool or from the mini-start
framework is copied into it, and a test checks that.

The starter page is the same in every pattern: a welcome, a small counter
(so there is some state to place) and next steps.

| Choice | What it adds |
| --- | --- |
| React (framework) | React 19, `@vitejs/plugin-react`, TypeScript |
| Tailwind CSS (add-on, on by default) | `tailwindcss` + `@tailwindcss/vite`. The starter styles move into `@layer base` / `@layer components`, so utility classes override them. |
| Husky + lint-staged (add-on) | A pre-commit hook that runs on the files being committed: `oxlint --fix` and `prettier --write` for `.ts`/`.tsx`, `prettier --write` for `.css`, `.html`, `.json` and `.md`. Adds `husky`, `lint-staged`, `oxlint` and `prettier`, plus `lint` and `format` scripts. |

The linter is Oxlint, not ESLint: ESLint's TypeScript plugin (typescript-eslint
8) refuses to run on TypeScript 7, which new projects use. With the add-on, the
builder formats the project once after installing, turns the hook on after
`git init`, and makes the first commit without running the hook.

## Design patterns

The pattern decides how the starter's components are organized. The
project's own README explains its structure and import rules.

| Pattern | What the new app looks like |
| --- | --- |
| Atomic Design (default) | `src/components/{atoms,molecules,organisms,templates,pages}` |
| Component-Driven (CDD) | `src/components/<Name>/` with the component, its `index.ts` and its stories, plus a gallery page (`#/components`) that previews every story. Stories use Storybook's format, but Storybook itself isn't installed. |
| Smart-Dumb Components | `src/components` (presentational, props only) and `src/containers` (state and logic) |
| Domain-Driven Frontend (DDD) | `src/domains/<domain>/{model.ts,components,index.ts}` and `src/shared/ui` |
| Web Components (Lit) | `src/elements/app-*.ts` custom elements built with Lit, composed by React |

The patterns are defined in `src/patterns.ts`. The four React patterns share
one set of component sources and differ in where each file goes. Frameworks,
patterns and add-ons are listed in `src/options.ts`; add an entry there and
the builder shows it.

## Code map

```
src/cli.ts         flags, terminal prompts, starts the UI
src/ui-server.ts   local HTTP server + JSON/NDJSON API for the UI
src/ui/index.html  the builder page (no build step, no dependencies)
src/generate.ts    options -> list of files (also feeds the live preview)
src/templates.ts   the contents of the generated config, styles and README
src/patterns.ts    the components, laid out per design pattern
src/create.ts      write files, install, git init; reports progress events
src/options.ts     framework, design pattern and add-on catalogs, name/folder validation
src/versions.ts    dependency ranges for new projects
test/              tests for the generator and for the framework below
framework/         the mini-start framework, used by apps/demo
```

`framework/` is not part of what this tool generates. It is the mini-start
framework (a from-scratch re-implementation of TanStack Start), which
`apps/demo` uses as the `mini-start` workspace package.

## Publishing (not done yet)

For `pnpm create mini-start` to work outside this repo, this package needs to
be published. Node won't run TypeScript from `node_modules`, so `src/` has to
be compiled to JavaScript first.
