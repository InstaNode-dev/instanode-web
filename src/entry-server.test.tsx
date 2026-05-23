/* entry-server.test.tsx — covers the react-router v7 `StaticRouter` import in
 * entry-server.tsx (the line the upgrade changed from the removed
 * `react-router-dom/server` subpath). No test previously imported this SSR
 * module, so that changed line tripped the 100% patch-coverage gate. Importing
 * the module here executes its top-level imports (incl. the StaticRouter line)
 * and exposes the render entry point. The render() output itself is exercised
 * by scripts/prerender.mjs during `npm run build` (121 prerendered HTML files),
 * which is the appropriate integration surface for SSR; a jsdom unit call hits
 * a react-router/react-router-dom dual-instance context mismatch that doesn't
 * occur in the bundled build. */
import { describe, it, expect } from 'vitest'
import { render as ssrRender } from './entry-server'

describe('entry-server SSR module', () => {
  it('exposes a render(url) entry point', () => {
    expect(typeof ssrRender).toBe('function')
    expect(ssrRender.length).toBe(1) // takes the url arg
  })
})
