/* index.wrappers.test.ts — coverage supplement for the endpoint wrappers
 * not exercised by index.test.ts.
 *
 * Same seam as the sibling suite: stub globalThis.fetch and assert the
 * request path/method plus the adapted response shape. Each wrapper is a
 * thin call<T>() shell, so a single happy-path call per wrapper (plus the
 * documented fallback/error branches) drives the lines. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  fetchStatus,
  fetchTeam,
  updateTeam,
  listMembers,
  listInvitations,
  inviteMember,
  getResource,
  pauseResource,
  resumeResource,
  rotateResource,
  getResourceMetrics,
  fetchResourceAudit,
  getStack,
  getStackLogs,
  deleteDeployment,
  confirmDeploymentDeletion,
  cancelDeploymentDeletion,
  deleteStack,
  confirmStackDeletion,
  cancelStackDeletion,
  makeDeploymentPermanent,
  setDeploymentTTL,
  getTeamSettings,
  updateTeamSettings,
  listCustomDomains,
  createCustomDomain,
  verifyCustomDomain,
  deleteCustomDomain,
  updatePaymentMethod,
  changePlan,
  listVault,
  revealVaultSecret,
  putVaultSecret,
  deleteVaultSecret,
  fetchActivity,
  listAPIKeys,
  createAPIKey,
  revokeAPIKey,
  fetchBillingUsage,
  fetchTeamSummary,
  fetchQuotaWall,
  completeCliSession,
  setToken,
  APIError,
} from './index'

type FetchMock = ReturnType<typeof vi.fn>

function jsonResponse(body: any, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  const status = init.status ?? 200
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'OK',
    headers: new Headers({ 'content-type': 'application/json', ...(init.headers ?? {}) }),
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

let fetchMock: FetchMock

beforeEach(() => {
  try { localStorage.clear() } catch { /* jsdom */ }
  delete (window as any).__INSTANODE_API_URL__
  fetchMock = vi.fn() as FetchMock
  vi.stubGlobal('fetch', fetchMock)
  setToken('test-token')
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

/** Helper: queue a sequence of responses, one per fetch() call. */
function queue(...responses: Response[]) {
  for (const r of responses) fetchMock.mockResolvedValueOnce(r)
}
function lastPath(callIndex = 0): string {
  return String(fetchMock.mock.calls[callIndex][0])
}
function lastInit(callIndex = 0): RequestInit {
  return (fetchMock.mock.calls[callIndex][1] ?? {}) as RequestInit
}

// /auth/me returns the FLAT agent shape: { ok, user_id, team_id, email, tier }.
const ME = { ok: true, user_id: 'u1', team_id: 't1', email: 'a@b.com', tier: 'pro' }
function headerOf(callIndex: number, name: string): string | null {
  const h = lastInit(callIndex).headers
  return h instanceof Headers ? h.get(name) : ((h as any)?.[name] ?? null)
}

describe('fetchStatus', () => {
  it('returns the status payload on a 200', async () => {
    queue(jsonResponse({ ok: true, components: [{ slug: 'api' }], current_incidents: [] }))
    const s = await fetchStatus()
    expect(s.components.length).toBe(1)
    expect(lastPath()).toMatch(/\/api\/v1\/status$/)
  })

  it('coerces a missing current_incidents to []', async () => {
    queue(jsonResponse({ ok: true, components: [] }))
    const s = await fetchStatus()
    expect(s.current_incidents).toEqual([])
  })

  it('returns the empty payload on a non-200', async () => {
    queue(jsonResponse({}, { status: 500 }))
    const s = await fetchStatus()
    expect(s.ok).toBe(false)
    expect(s.components).toEqual([])
  })

  it('returns the empty payload when the body has no components array', async () => {
    queue(jsonResponse({ ok: true }))
    const s = await fetchStatus()
    expect(s.ok).toBe(false)
  })

  it('returns the empty payload when fetch throws', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network'))
    const s = await fetchStatus()
    expect(s.ok).toBe(false)
  })
})

describe('team wrappers', () => {
  it('fetchTeam derives the team from /auth/me', async () => {
    queue(jsonResponse(ME))
    const r = await fetchTeam()
    expect(r.team.id).toBe('t1')
    expect(lastPath()).toMatch(/\/auth\/me$/)
  })

  it('updateTeam PATCHes the new name then re-reads /auth/me', async () => {
    queue(
      jsonResponse({ ok: true, team: { id: 't1', name: 'Renamed', plan_tier: 'pro', has_active_subscription: true, created_at: 'T0' } }),
      jsonResponse(ME),
    )
    const r = await updateTeam({ name: '  Renamed  ' })
    expect(r.team.name).toBe('Renamed')
    expect(lastPath(0)).toMatch(/\/api\/v1\/team$/)
    expect(lastInit(0).method).toBe('PATCH')
  })

  it('updateTeam short-circuits an empty name to /auth/me', async () => {
    queue(jsonResponse(ME))
    const r = await updateTeam({ name: '   ' })
    expect(r.team.id).toBe('t1')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('listMembers maps the live member rows', async () => {
    queue(jsonResponse({ ok: true, members: [{ user_id: 'u1', email: 'a@b.com', role: 'owner', joined_at: 'T0' }], member_limit: 5 }))
    const r = await listMembers()
    expect(r.members[0].email).toBe('a@b.com')
    expect(r.member_limit).toBe(5)
  })

  it('listMembers falls back to a single-owner row on a non-401 error', async () => {
    queue(jsonResponse({}, { status: 500 }), jsonResponse(ME))
    const r = await listMembers()
    expect(r.members.length).toBe(1)
    expect(r.members[0].role).toBe('owner')
    expect(r.member_limit).toBe(-1)
  })

  it('listMembers rethrows a 401', async () => {
    queue(jsonResponse({}, { status: 401 }))
    await expect(listMembers()).rejects.toBeInstanceOf(APIError)
  })

  it('listInvitations maps live invitation rows', async () => {
    queue(jsonResponse({ ok: true, invitations: [{ id: 'i1', email: 'k@b.com', role: 'developer', created_at: 'T0', expires_at: 'T1' }] }))
    const r = await listInvitations()
    expect(r.invitations[0].email).toBe('k@b.com')
    expect(r.invitations[0].status).toBe('pending')
  })

  it('listInvitations fails open to [] on 403', async () => {
    queue(jsonResponse({}, { status: 403 }))
    const r = await listInvitations()
    expect(r.invitations).toEqual([])
  })

  it('listInvitations rethrows a 500', async () => {
    queue(jsonResponse({}, { status: 500 }))
    await expect(listInvitations()).rejects.toBeInstanceOf(APIError)
  })

  it('inviteMember POSTs the invite body', async () => {
    queue(jsonResponse({ ok: true }))
    await inviteMember({ email: 'k@b.com', role: 'developer' })
    expect(lastPath()).toMatch(/\/team\/members\/invite$/)
    expect(lastInit().method).toBe('POST')
  })

  it('getTeamSettings returns the settings', async () => {
    queue(jsonResponse({ ok: true, settings: { team_id: 't1', default_deployment_ttl_policy: 'auto_24h', default_deployment_ttl_hours: 24 } }))
    const r = await getTeamSettings()
    expect(r.settings.default_deployment_ttl_policy).toBe('auto_24h')
  })

  it('getTeamSettings throws when settings are missing', async () => {
    queue(jsonResponse({ ok: true }))
    await expect(getTeamSettings()).rejects.toBeInstanceOf(APIError)
  })

  it('updateTeamSettings PATCHes the policy', async () => {
    queue(jsonResponse({ ok: true, settings: { team_id: 't1', default_deployment_ttl_policy: 'permanent', default_deployment_ttl_hours: 0 } }))
    const r = await updateTeamSettings({ default_deployment_ttl_policy: 'permanent' })
    expect(r.settings.default_deployment_ttl_policy).toBe('permanent')
    expect(lastInit().method).toBe('PATCH')
  })

  it('updateTeamSettings throws when the response has no settings', async () => {
    queue(jsonResponse({ ok: true }))
    await expect(updateTeamSettings({ default_deployment_ttl_policy: 'permanent' })).rejects.toBeInstanceOf(APIError)
  })
})

const RES = {
  id: 'res1', token: 'tok1', resource_type: 'postgres', tier: 'pro', status: 'active',
  name: 'db', env: 'production', storage_bytes: 0, storage_limit_bytes: 100, connections_in_use: 0,
  connections_limit: 5, created_at: 'T0',
}

describe('resource wrappers', () => {
  it('getResource fetches the resource + credentials for a credentialed type', async () => {
    queue(
      jsonResponse({ ok: true, item: RES }),
      jsonResponse({ connection_url: 'postgres://x' }),
    )
    const r = await getResource('tok1')
    expect(r.resource.connection_url).toBe('postgres://x')
    expect(lastPath(0)).toMatch(/\/resources\/tok1$/)
    expect(lastPath(1)).toMatch(/\/resources\/tok1\/credentials$/)
  })

  it('getResource tolerates a credentials fetch failure', async () => {
    queue(
      jsonResponse({ ok: true, item: RES }),
      jsonResponse({}, { status: 403 }),
    )
    const r = await getResource('tok1')
    expect(r.resource.id).toBe('res1')
    expect(r.resource.connection_url).toBeUndefined()
  })

  it('getResource skips credentials for a non-credentialed type', async () => {
    queue(jsonResponse({ ok: true, item: { ...RES, resource_type: 'webhook' } }))
    const r = await getResource('tok1')
    expect(r.resource.resource_type).toBe('webhook')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('pauseResource POSTs and adapts the resource envelope', async () => {
    queue(jsonResponse({ ok: true, resource: { ...RES, status: 'paused' } }))
    const r = await pauseResource('tok1')
    expect(r.resource.status).toBe('paused')
    expect(lastPath()).toMatch(/\/resources\/tok1\/pause$/)
  })

  it('resumeResource POSTs the resume path', async () => {
    queue(jsonResponse({ ok: true, resource: RES }))
    const r = await resumeResource('tok1')
    expect(r.resource.status).toBe('active')
    expect(lastPath()).toMatch(/\/resources\/tok1\/resume$/)
  })

  it('rotateResource rotates then re-reads the detail', async () => {
    queue(
      jsonResponse({ ok: true, connection_url: 'postgres://new' }),
      jsonResponse({ ok: true, item: RES }),
    )
    const r = await rotateResource('tok1')
    expect(r.connection_url).toBe('postgres://new')
    expect(lastPath(0)).toMatch(/\/rotate-credentials$/)
  })

  it('getResourceMetrics passes the window param through', async () => {
    queue(jsonResponse({ ok: true, resource_id: 'res1', metrics: {}, data_source: 'stub' }))
    await getResourceMetrics('tok1', '6h')
    expect(lastPath()).toMatch(/\/metrics\?window=6h$/)
  })

  it('fetchResourceAudit filters rows by metadata.resource_id', async () => {
    queue(jsonResponse({
      ok: true,
      items: [
        { id: 'a1', metadata: { resource_id: 'res1' } },
        { id: 'a2', metadata: { resource_id: 'other' } },
        { id: 'a3', metadata: null },
      ],
      next_cursor: null, lookback_days: 90, tier: 'pro',
    }))
    const r = await fetchResourceAudit('res1')
    expect(r.items.length).toBe(1)
    expect(r.items[0].id).toBe('a1')
  })
})

describe('stack wrappers', () => {
  it('getStack finds a stack by slug from listStacks', async () => {
    queue(jsonResponse({ ok: true, items: [{ stack_id: 'mystack', name: 'My Stack', env: 'production' }], total: 1 }))
    const r = await getStack('mystack')
    expect(r.stack?.slug).toBe('mystack')
  })

  it('getStack returns null for an unknown slug', async () => {
    queue(jsonResponse({ ok: true, items: [], total: 0 }))
    const r = await getStack('nope')
    expect(r.stack).toBeNull()
  })

  it('getStack returns null when listStacks throws', async () => {
    queue(jsonResponse({}, { status: 500 }))
    const r = await getStack('x')
    expect(r.stack).toBeNull()
  })

  it('getStackLogs returns an honest empty buffer (no fetch)', async () => {
    const r = await getStackLogs('s1')
    expect(r.lines).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

const DEP_RESOLVED = { ok: true, status: 'deleted', message: 'gone' }

describe('deletion + ttl wrappers', () => {
  it('deleteDeployment sends the skip-confirmation header when asked', async () => {
    queue(jsonResponse({ ok: true, message: 'deleted' }))
    await deleteDeployment('d1', { skipEmailConfirmation: true })
    expect(lastInit().method).toBe('DELETE')
    expect(headerOf(0, 'X-Skip-Email-Confirmation')).toBe('yes')
  })

  it('deleteDeployment omits the header by default', async () => {
    queue(jsonResponse({ ok: true, message: 'pending' }))
    await deleteDeployment('d1')
    expect(headerOf(0, 'X-Skip-Email-Confirmation')).toBeNull()
  })

  it('confirmDeploymentDeletion POSTs with the token', async () => {
    queue(jsonResponse(DEP_RESOLVED))
    await confirmDeploymentDeletion('d1', 'tok')
    expect(lastPath()).toMatch(/\/confirm-deletion\?token=tok$/)
    expect(lastInit().method).toBe('POST')
  })

  it('cancelDeploymentDeletion DELETEs the confirm path', async () => {
    queue(jsonResponse(DEP_RESOLVED))
    await cancelDeploymentDeletion('d1')
    expect(lastInit().method).toBe('DELETE')
  })

  it('deleteStack hits the /stacks path', async () => {
    queue(jsonResponse({ ok: true, message: 'pending' }))
    await deleteStack('s1', { skipEmailConfirmation: true })
    expect(lastPath()).toMatch(/\/stacks\/s1$/)
  })

  it('confirmStackDeletion POSTs', async () => {
    queue(jsonResponse(DEP_RESOLVED))
    await confirmStackDeletion('s1', 'tok')
    expect(lastInit().method).toBe('POST')
  })

  it('cancelStackDeletion DELETEs', async () => {
    queue(jsonResponse(DEP_RESOLVED))
    await cancelStackDeletion('s1')
    expect(lastInit().method).toBe('DELETE')
  })

  it('makeDeploymentPermanent adapts the deployment item', async () => {
    queue(jsonResponse({ ok: true, item: { deployment_id: 'd1', name: 'app', status: 'running' } }))
    const r = await makeDeploymentPermanent('d1')
    expect(r.deployment).toBeTruthy()
    expect(lastPath()).toMatch(/\/make-permanent$/)
  })

  it('makeDeploymentPermanent throws on a missing item', async () => {
    queue(jsonResponse({ ok: true }))
    await expect(makeDeploymentPermanent('d1')).rejects.toBeInstanceOf(APIError)
  })

  it('setDeploymentTTL POSTs the hours', async () => {
    queue(jsonResponse({ ok: true, item: { deployment_id: 'd1', name: 'app', status: 'running' } }))
    await setDeploymentTTL('d1', 48)
    expect(lastPath()).toMatch(/\/ttl$/)
    expect(lastInit().method).toBe('POST')
  })

  it('setDeploymentTTL throws on a missing item', async () => {
    queue(jsonResponse({ ok: true }))
    await expect(setDeploymentTTL('d1', 1)).rejects.toBeInstanceOf(APIError)
  })
})

describe('custom domain wrappers', () => {
  it('listCustomDomains returns the items array', async () => {
    queue(jsonResponse({ ok: true, items: [{ id: 'cd1', hostname: 'x.com', status: 'live', verified: true, certificate_ready: true }], total: 1 }))
    const r = await listCustomDomains('s1')
    expect(r[0].hostname).toBe('x.com')
  })

  it('listCustomDomains tolerates a missing items array', async () => {
    queue(jsonResponse({ ok: true }))
    const r = await listCustomDomains('s1')
    expect(r).toEqual([])
  })

  it('createCustomDomain POSTs the hostname', async () => {
    queue(jsonResponse({ domain: { id: 'cd1', hostname: 'x.com', status: 'pending_verification', verified: false, certificate_ready: false } }))
    const d = await createCustomDomain('s1', 'x.com')
    expect(d.hostname).toBe('x.com')
    expect(lastInit().method).toBe('POST')
  })

  it('verifyCustomDomain POSTs the verify path', async () => {
    queue(jsonResponse({ domain: { id: 'cd1', hostname: 'x.com', status: 'verified', verified: true, certificate_ready: false } }))
    const d = await verifyCustomDomain('s1', 'cd1')
    expect(d.verified).toBe(true)
    expect(lastPath()).toMatch(/\/domains\/cd1\/verify$/)
  })

  it('deleteCustomDomain DELETEs', async () => {
    queue(jsonResponse({ ok: true }))
    await deleteCustomDomain('s1', 'cd1')
    expect(lastInit().method).toBe('DELETE')
  })
})

describe('billing wrappers', () => {
  it('updatePaymentMethod returns the short_url', async () => {
    queue(jsonResponse({ ok: true, short_url: 'https://rzp/x' }))
    const r = await updatePaymentMethod()
    expect(r.short_url).toBe('https://rzp/x')
    expect(lastInit().method).toBe('POST')
  })

  it('changePlan returns immediate=true when no short_url', async () => {
    queue(jsonResponse({ ok: true, new_plan: 'pro', short_url: '' }))
    const r = await changePlan('pro', 'monthly')
    expect(r.immediate).toBe(true)
    expect(r.short_url).toBeUndefined()
  })

  it('changePlan returns the short_url when Razorpay requires checkout', async () => {
    queue(jsonResponse({ ok: true, short_url: 'https://rzp/sub' }))
    const r = await changePlan('team', 'yearly')
    expect(r.immediate).toBe(false)
    expect(r.short_url).toBe('https://rzp/sub')
  })

  it('fetchBillingUsage GETs the usage endpoint', async () => {
    queue(jsonResponse({ ok: true, freshness_seconds: 30, as_of: 'T', usage: {} }))
    await fetchBillingUsage()
    expect(lastPath()).toMatch(/\/billing\/usage$/)
  })

  it('fetchTeamSummary GETs the summary endpoint', async () => {
    queue(jsonResponse({ ok: true, freshness_seconds: 300, as_of: 'T', tier: 'pro', counts: {} }))
    await fetchTeamSummary()
    expect(lastPath()).toMatch(/\/team\/summary$/)
  })

  it('fetchQuotaWall GETs the usage wall', async () => {
    queue(jsonResponse({ ok: true, near_wall: false }))
    const r = await fetchQuotaWall()
    expect(r.near_wall).toBe(false)
  })
})

describe('vault wrappers', () => {
  it('listVault maps keys into entries', async () => {
    queue(jsonResponse({ ok: true, keys: ['A', 'B'] }))
    const r = await listVault('production')
    expect(r.entries.map((e) => e.key)).toEqual(['A', 'B'])
    expect(lastPath()).toMatch(/\/vault\/production$/)
  })

  it('listVault fails open to [] on a non-401 error', async () => {
    queue(jsonResponse({}, { status: 500 }))
    const r = await listVault('staging')
    expect(r.entries).toEqual([])
  })

  it('listVault rethrows a 401', async () => {
    queue(jsonResponse({}, { status: 401 }))
    await expect(listVault('production')).rejects.toBeInstanceOf(APIError)
  })

  it('revealVaultSecret GETs the key path', async () => {
    queue(jsonResponse({ value: 's', version: 1 }))
    const r = await revealVaultSecret('production', 'DB_URL')
    expect(r.value).toBe('s')
    expect(lastPath()).toMatch(/\/vault\/production\/DB_URL$/)
  })

  it('putVaultSecret PUTs the value', async () => {
    queue(jsonResponse({ version: 2 }))
    await putVaultSecret('production', 'K', 'v')
    expect(lastInit().method).toBe('PUT')
  })

  it('deleteVaultSecret DELETEs the key', async () => {
    queue(jsonResponse({ ok: true }))
    await deleteVaultSecret('production', 'K')
    expect(lastInit().method).toBe('DELETE')
  })
})

describe('activity + PAT wrappers', () => {
  it('fetchActivity maps audit rows', async () => {
    queue(jsonResponse({ ok: true, items: [{ id: 'e1', actor: 'agent', kind: 'provision', summary: 'made a db', at: 'T0' }] }))
    const r = await fetchActivity()
    expect(r.items[0].text).toBe('made a db')
  })

  it('fetchActivity synthesises from resources when the audit call fails', async () => {
    queue(
      jsonResponse({}, { status: 500 }),
      jsonResponse({ ok: true, items: [RES], total: 1 }),
    )
    const r = await fetchActivity()
    expect(r.items.length).toBe(1)
    // The synthesised row's text is built from the resource fields.
    expect(r.items[0].text).toMatch(/provisioned postgres/)
  })

  it('fetchActivity returns [] when both audit and resources fail', async () => {
    queue(jsonResponse({}, { status: 500 }), jsonResponse({}, { status: 500 }))
    const r = await fetchActivity()
    expect(r.items).toEqual([])
  })

  it('fetchActivity rethrows a 401', async () => {
    queue(jsonResponse({}, { status: 401 }))
    await expect(fetchActivity()).rejects.toBeInstanceOf(APIError)
  })

  it('listAPIKeys GETs the api-keys endpoint', async () => {
    queue(jsonResponse({ ok: true, items: [] }))
    await listAPIKeys()
    expect(lastPath()).toMatch(/\/auth\/api-keys$/)
  })

  it('createAPIKey POSTs the body', async () => {
    queue(jsonResponse({ id: 'k1', name: 'n', scopes: ['read'], created_at: 'T', last_used_at: null, revoked: false, key: 'secret', note: '' }))
    const r = await createAPIKey({ name: 'n', scopes: ['read'] })
    expect(r.key).toBe('secret')
    expect(lastInit().method).toBe('POST')
  })

  it('revokeAPIKey DELETEs the id', async () => {
    queue(jsonResponse({ ok: true }))
    await revokeAPIKey('k1')
    expect(lastPath()).toMatch(/\/auth\/api-keys\/k1$/)
    expect(lastInit().method).toBe('DELETE')
  })

  // ─── D2: CLI device-flow completion ────────────────────────────────────
  it('completeCliSession POSTs /auth/cli/{id}/complete with the session Bearer', async () => {
    queue(jsonResponse({ ok: true }))
    const r = await completeCliSession('cli_42')
    expect(r.ok).toBe(true)
    expect(lastPath()).toMatch(/\/auth\/cli\/cli_42\/complete$/)
    expect(lastInit().method).toBe('POST')
    // call() attaches the stored token as a Bearer.
    expect(headerOf(0, 'Authorization')).toBe('Bearer test-token')
  })

  it('completeCliSession URL-encodes the session id', async () => {
    queue(jsonResponse({ ok: true }))
    await completeCliSession('a/b c')
    expect(lastPath()).toContain('/auth/cli/a%2Fb%20c/complete')
  })

  it('completeCliSession returns {ok:false} on an empty id without calling fetch', async () => {
    const r = await completeCliSession('')
    expect(r.ok).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('completeCliSession swallows a server error and returns {ok:false}', async () => {
    queue(jsonResponse({ error: 'session_not_found' }, { status: 404 }))
    const r = await completeCliSession('cli_dead')
    expect(r.ok).toBe(false)
  })

  it('completeCliSession swallows a network throw and returns {ok:false}', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network'))
    const r = await completeCliSession('cli_net')
    expect(r.ok).toBe(false)
  })
})
