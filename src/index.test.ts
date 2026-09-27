// @vitest-environment node
// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import app from './index.js'

const mongoUriBackup = process.env.MONGODB_URI
const trustedOriginsBackup = process.env.TRUSTED_ORIGINS

afterEach(() => {
  if (mongoUriBackup === undefined) {
    delete process.env.MONGODB_URI
  } else {
    process.env.MONGODB_URI = mongoUriBackup
  }

  if (trustedOriginsBackup === undefined) {
    delete process.env.TRUSTED_ORIGINS
  } else {
    process.env.TRUSTED_ORIGINS = trustedOriginsBackup
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

describe('CORS im Dev-Setup (Web :3000 als Origin)', () => {
  beforeEach(() => {
    process.env.TRUSTED_ORIGINS = 'http://localhost:3000,http://127.0.0.1:3000'
  })

  it('beantwortet den Preflight mit Access-Control-Allow-Origin', async () => {
    const res = await app.request('/api/auth/sign-in/social', {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:3000',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type',
      },
    })

    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe(
      'http://localhost:3000',
    )
    expect(res.headers.get('access-control-allow-credentials')).toBe('true')
  })

  it('vergibt fuer fremde Origins keine CORS-Header', async () => {
    const res = await app.request('/api/auth/sign-in/social', {
      method: 'OPTIONS',
      headers: { Origin: 'http://evil.example' },
    })

    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  })
})
