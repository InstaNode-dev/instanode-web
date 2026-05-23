/* App.root.test.tsx — covers the top-level <App/> shell (the BrowserRouter
 * mount at App.tsx:409). The existing App.cli-auth.test.tsx only imports the
 * named CliAuthRedirect export, so the App() component itself was never
 * rendered. RouteTracker is mocked to a no-op so this test exercises the
 * router shell without pulling in the New Relic browser agent; AppRoutes
 * resolves to its Suspense fallback, which is fine — line 409 still executes. */
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'

vi.mock('./components/RouteTracker', () => ({ RouteTracker: () => null }))

import { App } from './App'

describe('App root shell', () => {
  it('mounts the BrowserRouter without crashing', () => {
    const { container } = render(<App />)
    expect(container).toBeTruthy()
  })
})
