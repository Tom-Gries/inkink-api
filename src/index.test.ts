// @vitest-environment node
// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import app from './index'

const mongoUriBackup = process.env.MONGODB_URI

afterEach(() => {
  if (mongoUriBackup === undefined) {
    delete process.env.MONGODB_URI
  } else {
    process.env.MONGODB_URI = mongoUriBackup
  }
})

describe('GET /api/health', () => {
  it('antwortet mit status ok', async () => {
    const res = await app.request('/api/health')

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok' })
  })

  it('liefert 404 für Pfade außerhalb der /api-Basis', async () => {
    const res = await app.request('/health')

    expect(res.status).toBe(404)
  })
})

describe('GET /api/ping', () => {
  it('liefert 503, wenn keine Datenbank konfiguriert ist', async () => {
    delete process.env.MONGODB_URI

    const res = await app.request('/api/ping')

    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ mongo: 'down' })
  })
})

describe('GET /api/test ohne Datenbank', () => {
  it('liefert 503 mit einheitlichem Fehlerformat über den globalen Error-Handler', async () => {
    delete process.env.MONGODB_URI

    const res = await app.request('/api/test')

    expect(res.status).toBe(503)

    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('SERVICE_UNAVAILABLE')
  })
})
