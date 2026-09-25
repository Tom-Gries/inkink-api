// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import app from '../../index'

// In-Memory-Datenbank statt echter MongoDB – die Vertragstests laufen
// dadurch ohne Server und ohne Umgebungsvariablen. Das Mock-Singleton
// gilt für alle getDb()-Aufrufe innerhalb dieser Testdatei.
vi.mock('../../db', async () => {
  const { createInMemoryDb } = await import('../../testing/in-memory-db')
  const db = createInMemoryDb()

  return { getDb: () => db }
})

const createdIds: string[] = []

describe('Test-Nachrichten (Vertragstests)', () => {
  it('schreibt eine Test-Nachricht in die Datenbank (201)', async () => {
    const res = await app.request('/api/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Integrationstest' }),
    })

    expect(res.status).toBe(201)

    const body = (await res.json()) as {
      id: string
      message: string
      createdAt: string
    }
    expect(body.message).toBe('Integrationstest')
    expect(body.id).toMatch(/^[0-9a-fA-F]{24}$/)

    createdIds.push(body.id)
  })

  it('liefert 400, wenn die Nachricht fehlt', async () => {
    const res = await app.request('/api/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })

    expect(res.status).toBe(400)

    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('VALIDATION_ERROR')
  })

  it('listet die Test-Nachrichten (200)', async () => {
    const res = await app.request('/api/test')

    expect(res.status).toBe(200)

    const messages = (await res.json()) as Array<{ message: string }>
    expect(messages.some((m) => m.message === 'Integrationstest')).toBe(true)
  })

  it('liefert eine Test-Nachricht per ID (200)', async () => {
    const res = await app.request(`/api/test/${createdIds[0]}`)

    expect(res.status).toBe(200)

    const body = (await res.json()) as { id: string; message: string }
    expect(body.id).toBe(createdIds[0])
    expect(body.message).toBe('Integrationstest')
  })

  it('liefert 400 bei ungültiger ID', async () => {
    const res = await app.request('/api/test/keine-gueltige-id')

    expect(res.status).toBe(400)
  })

  it('liefert 404 für unbekannte, aber gültige ID', async () => {
    const res = await app.request('/api/test/507f1f77bcf86cd799439011')

    expect(res.status).toBe(404)
  })

  it('löscht die Test-Nachricht (204) und liefert danach 404', async () => {
    const res = await app.request(`/api/test/${createdIds[0]}`, {
      method: 'DELETE',
    })

    expect(res.status).toBe(204)

    const resAfter = await app.request(`/api/test/${createdIds[0]}`)
    expect(resAfter.status).toBe(404)
  })
})
