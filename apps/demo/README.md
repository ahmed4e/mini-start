# demo

A React app on Vite, styled with Tailwind CSS and CSS Modules.

## Commands

```bash
pnpm dev          # dev server on http://localhost:5173
pnpm build        # type-check, then build to dist/
pnpm preview      # serve the built app locally
pnpm typecheck    # type-check only
pnpm test         # run the tests once
```

## Structure: Atomic Design

Components are sorted by how much they are made of. Each level only imports
from the levels above it in this list.

- `src/components/atoms`: the smallest pieces, with no other components inside (`Button`, `Card`)
- `src/components/molecules`: a few atoms working together (`Counter`)
- `src/components/organisms`: complete sections of a page (`SiteHeader`, `Hero`, `CounterCard`, `NextSteps`)
- `src/components/templates`: page frames without real content (`PageLayout`)
- `src/components/pages`: templates filled with real content (`HomePage`)

## What the add-ons added

- **Routing** (React Router): the routes are listed in `src/App.tsx`. Pages are next to `src/components/pages/AboutPage.tsx`. To add one, create the page and add a `<Route>` and a `<NavLink>`.
- **State** (Zustand): `src/stores/counterStore.ts` holds the counter. Any component can read it with `useCounterStore`, and it keeps its value while you move between pages.
- **Data fetching** (TanStack Query): `src/hooks/useTips.ts` loads `public/api/tips.json` through `src/lib/api.ts`. The query client is created in `src/main.tsx`. Replace the JSON file with your API.
- **Theme toggle**: `src/components/molecules/ThemeToggle.tsx` switches between system, light and dark; `src/hooks/useTheme.ts` remembers the choice. The colors for each theme are in `src/styles.css`.
- **Environment variables**: read them through `src/lib/env.ts`. Copy `.env.example` to `.env.local` to set them.
- **Error handling**: `src/providers/ErrorBoundary.tsx` wraps the app in `src/main.tsx` and shows `src/components/organisms/ErrorFallback.tsx` if rendering fails.
- **Tests** (Vitest + Testing Library): `pnpm test` runs them once, `pnpm test:watch` reruns on save. Test files sit next to the code they test and end in `.test.ts` or `.test.tsx`.

## Styling: CSS Modules

A file named `Something.module.css` is a normal CSS file whose class names and
`@keyframes` names are local to it. Import it and use the names as properties:

```tsx
import styles from './Card.module.css'

<section className={styles.card}>
```

Two components can both have a `.title` class or a `rise` animation without
clashing, because the build gives each one a unique name. What stays in
`src/styles.css` is global on purpose: the colors, the base tag styles and the
`.muted` helper. To use a global class name inside a module, write
`:global(.name)`.

## Other files

- `index.html`: the page Vite serves
- `src/main.tsx`: mounts the app
- `src/App.tsx`: the top of the component tree
- `src/styles.css`: colors and the starter styles
