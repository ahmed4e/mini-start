import { createContext } from 'react'
import type { Router } from '../router/router.ts'

export const RouterContext = createContext<Router | null>(null)

/** Index of the match whose component is currently rendering (used by <Outlet />). */
export const MatchIndexContext = createContext<number>(0)
