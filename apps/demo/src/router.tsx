import { createRouter } from 'mini-start'
import { routeTree } from './routeTree.gen'

/** Called once per request on the server and once in the browser. */
export function getRouter() {
  return createRouter({
    routeTree,
    defaultPreload: 'intent',
  })
}
