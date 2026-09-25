// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import app from '../../index'

// In-Memory-Datenbank statt echter MongoDB – die Vertragstests laufen
// dadurch ohne Server und ohne Umgebungsvariablen.
vi.mock('../../db', async () => {
  const { createInMemoryDb } = await import('../../testing/in-memory-db')
  const db = createInMemoryDb()

  return { getDb: () => db }
})

describe('GET /api/users/:id', () => {
  it('liefert 400 bei ungültiger ID (ohne Datenbankzugriff)', async () => {
    const res = await app.request('/api/users/keine-gueltige-id')

    expect(res.status).toBe(400)
  })
})

describe('GET /api/users', () => {
  it('liefert eine Benutzerliste – auch leer, solange kein Login erfolgte (200)', async () => {
    const res = await app.request('/api/users')

    expect(res.status).toBe(200)
    expect(Array.isArray(await res.json())).toBe(true)
  })
})
