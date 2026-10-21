// @vitest-environment node
import { ObjectId } from 'mongodb'
import { describe, expect, it, vi } from 'vitest'
import { getDb } from '../../db.js'
import app from '../../index.js'

// In-Memory-Datenbank statt echter MongoDB – die Vertragstests laufen
// dadurch ohne Server und ohne Umgebungsvariablen.
vi.mock('../../db.js', async () => {
  const { createInMemoryDb } = await import('../../testing/in-memory-db.js')
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

describe('Öffentliche Benutzerdaten', () => {
  it('gibt gespeicherte E-Mail-Adressen weder in Listen noch in Einzelabfragen aus', async () => {
    const id = new ObjectId()
    await getDb().collection('user').insertOne({
      _id: id,
      name: 'Privater Nutzer',
      email: 'privat@example.com',
      createdAt: new Date(),
    })

    const detail = await app.request(`/api/users/${id.toHexString()}`)
    expect(detail.status).toBe(200)
    expect(await detail.json()).toEqual({
      id: id.toHexString(),
      name: 'Privater Nutzer',
    })

    const list = await app.request('/api/users')
    expect(list.status).toBe(200)
    const body = await list.json()
    expect(body).toContainEqual({
      id: id.toHexString(),
      name: 'Privater Nutzer',
    })
    for (const user of body) {
      expect(user).not.toHaveProperty('email')
    }

    const stored = await getDb().collection('user').findOne({ _id: id })
    expect(stored?.email).toBe('privat@example.com')
  })
})
