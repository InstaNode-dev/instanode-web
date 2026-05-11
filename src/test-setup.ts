/* test-setup.ts — runs before every vitest file.
 *
 * Node 25 + jsdom 24 ship a broken `localStorage` (the object exists but
 * its methods are undefined — see https://github.com/jsdom/jsdom/issues
 * for context). The dashboard's API client reads/writes auth tokens
 * through localStorage on every call(), so we install a minimal in-memory
 * polyfill here. This is test infrastructure only; nothing changes in
 * the runtime bundle. */

function installLocalStoragePolyfill() {
  if (typeof window === 'undefined') return
  // Detect the broken shape (object present, methods missing).
  const ls = window.localStorage as any
  if (ls && typeof ls.setItem === 'function') return
  const store = new Map<string, string>()
  const polyfill = {
    getItem(k: string) { return store.has(k) ? store.get(k)! : null },
    setItem(k: string, v: string) { store.set(k, String(v)) },
    removeItem(k: string) { store.delete(k) },
    clear() { store.clear() },
    key(i: number) { return Array.from(store.keys())[i] ?? null },
    get length() { return store.size },
  }
  Object.defineProperty(window, 'localStorage', { value: polyfill, configurable: true, writable: true })
  // jsdom also exposes localStorage as a global — overwrite that too.
  ;(globalThis as any).localStorage = polyfill
}

installLocalStoragePolyfill()
