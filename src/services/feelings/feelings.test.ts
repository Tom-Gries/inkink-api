// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import app from '../../index.js'

// In-Memory-Datenbank statt echter MongoDB – die Vertragstests laufen
// dadurch ohne Server und ohne Umgebungsvariablen.
vi.mock('../../db.js', async () => {
  const { createInMemoryDb } = await import('../../testing/in-memory-db.js')
  const db = createInMemoryDb()

  return { getDb: () => db }
})

// Better-Auth-Instanz mocken: getSession liefert standardmäßig einen festen
// Nutzer, damit die Session-geschützten Routen ohne echte Auth-Infrastruktur
// laufen. Für den 401-Test wird per mockReturnValueOnce einmalig null geliefert.
vi.mock('../../auth.js', () => ({
  getAuth: vi.fn(() => ({
    api: {
      getSession: async () => ({ user: { id: 'user-1' } }),
    },
  })),
}))

interface FeelingBody {
  id: string
  mood: string
  note: string
  createdAt: string
}

const baseFeeling = {
  mood: 'happy',
  note: 'Heute war ein guter Tag.',
}

let createdId: string

describe('Feelings (Vertragstests)', () => {
  it('legt einen Gefühls-Eintrag an (201)', async () => {
    const res = await app.request('/api/feelings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(baseFeeling),
    })

    expect(res.status).toBe(201)
    const body = (await res.json()) as FeelingBody
    expect(body.mood).toBe('happy')
    expect(body.note).toBe('Heute war ein guter Tag.')
    expect(body.id).toMatch(/^[0-9a-fA-F]{24}$/)

    createdId = body.id
  })

  it('erlaubt einen Eintrag ohne Notiz (note wird auf "" gesetzt)', async () => {
    const res = await app.request('/api/feelings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mood: 'calm' }),
    })

    expect(res.status).toBe(201)
    const body = (await res.json()) as FeelingBody
    expect(body.mood).toBe('calm')
    expect(body.note).toBe('')
  })

  it('liefert 400 bei unbekanntem mood', async () => {
    const res = await app.request('/api/feelings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mood: 'unbekannt', note: '' }),
    })

    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('VALIDATION_ERROR')
  })

  it('listet die eigenen Einträge (200)', async () => {
    const res = await app.request('/api/feelings')

    expect(res.status).toBe(200)
    const list = (await res.json()) as FeelingBody[]
    expect(list.some((feeling) => feeling.id === createdId)).toBe(true)
  })

  it('liefert 404 für unbekannte, aber gültige ID beim Löschen', async () => {
    const res = await app.request('/api/feelings/507f1f77bcf86cd799439011', {
      method: 'DELETE',
    })

    expect(res.status).toBe(404)
  })

  it('löscht den Eintrag (204) und liefert danach 404', async () => {
    const res = await app.request(`/api/feelings/${createdId}`, {
      method: 'DELETE',
    })

    expect(res.status).toBe(204)

    const resAfter = await app.request(`/api/feelings/${createdId}`, {
      method: 'DELETE',
    })
    expect(resAfter.status).toBe(404)
  })

  it('liefert 401 ohne gültige Session', async () => {
    const { getAuth } = await import('../../auth.js')
    vi.mocked(getAuth).mockReturnValueOnce({
      api: { getSession: async () => null },
    } as unknown as ReturnType<typeof getAuth>)

    const res = await app.request('/api/feelings')

    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('UNAUTHORIZED')
  })
})
