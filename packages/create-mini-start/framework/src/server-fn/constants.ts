/** Required on every server function request: a custom header cannot be sent cross-site without CORS, which blocks CSRF. */
export const SERVER_FN_HEADER = 'x-mini-start-fn'
/** Marks a JSON envelope produced by the server function handler (vs. a raw Response returned by user code). */
export const SERVER_FN_RESULT_HEADER = 'x-mini-start-fn-result'
export const DEFAULT_SERVER_FN_BASE = '/_serverFn/'
export const RPC_MARKER = Symbol.for('mini-start.client-rpc')
