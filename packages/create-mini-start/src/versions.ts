/**
 * Dependency ranges written into new projects. They match apps/demo so a new
 * project runs on the same versions the framework is tested with; the test
 * suite fails if the two drift apart.
 */
export const VERSIONS = {
  react: '^19.3.1',
  'react-dom': '^19.3.1',
  '@types/node': '^26.6.6',
  '@types/react': '^19.3.0',
  '@types/react-dom': '^19.3.0',
  '@vitejs/plugin-react': '^6.3.0',
  typescript: '^7.0.2',
  vite: '^8.3.8',
  // Tailwind add-on only (not used by the demo).
  tailwindcss: '^4.3.5',
  '@tailwindcss/vite': '^4.3.5',
  // Husky + lint-staged add-on only (not used by the demo).
  husky: '^9.1.7',
  'lint-staged': '^17.6.0',
  oxlint: '^1.93.0',
  prettier: '^3.10.1',
  // App add-ons (routing, state, data fetching).
  'react-router': '^8.5.1',
  zustand: '^5.1.0',
  '@tanstack/react-query': '^5.107.1',
  // Testing add-on.
  vitest: '^5.1.0',
  jsdom: '^31.0.1',
  '@testing-library/react': '^16.3.3',
  '@testing-library/jest-dom': '^7.0.1',
  '@testing-library/user-event': '^14.6.10',
  // Web Components pattern only (not used by the demo).
  lit: '^3.3.3',
} as const
