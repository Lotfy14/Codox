/**
 * Custom pdf.js worker entry.
 *
 * pdf.js v6's worker calls `Promise.try`, which only shipped in Chrome/Edge
 * 128, Safari 18.2, and Firefox 134. On an older browser the worker throws
 * `Promise.try is not a function`, the worker dies, and the `getDocument()`
 * promise never settles — so the render step's text-layer pass hangs and the
 * run sits at 0% forever. A main-thread polyfill can't reach here: a worker
 * has its own global scope. So we define the method here, then load pdf.js's
 * real worker.
 *
 * The dynamic import is deliberate: static imports hoist above module-body
 * statements, so the polyfill must run first, then pull in the worker. This
 * builds as an ES-module worker (vite.config `worker.format: 'es'`), which is
 * also what pdf.js expects — it always creates the worker with
 * `{ type: 'module' }`.
 */
type PromiseTry = (
  fn: (...args: unknown[]) => unknown,
  ...args: unknown[]
) => Promise<unknown>

const promiseCtor = Promise as unknown as { try?: PromiseTry }
if (typeof promiseCtor.try !== 'function') {
  promiseCtor.try = function polyfilledTry(fn, ...args) {
    return new Promise((resolve) => resolve(fn(...args)))
  }
}

// @ts-expect-error pdf.js's worker bundle ships no type declarations; it is
// imported only for its side effect (registering the worker message handler).
await import('pdfjs-dist/build/pdf.worker.min.mjs')
