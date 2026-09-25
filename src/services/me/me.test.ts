// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import app from '../../index'

// Better-Auth-Instanz mocken: Ohne Cookie liefert getSession null –
// der Test läuft dadurch ohne echte Auth-Infrastruktur und Datenbank.
vi.mock('../../auth', () => ({
  getAuth: () => ({
    api: {
      getSession: async () => null,
    },
  }),
}))

describe('GET /api/me', () => {
  it('liefert 401 ohne gültige Session', async () => {
    const res = await app.request('/api/me')

    expect(res.status).toBe(401)

    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('UNAUTHORIZED')
  })
})
