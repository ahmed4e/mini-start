// Runs before every test file (see "test" in vite.config.ts).
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Remove what the previous test rendered.
afterEach(cleanup)
