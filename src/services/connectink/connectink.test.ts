// @vitest-environment node
import { ObjectId } from 'mongodb'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../../index.js'

// In-Memory-Datenbank statt echter MongoDB – die Vertragstests laufen
// dadurch ohne Server und ohne Umgebungsvariablen.
vi.mock('../../db.js', async () => {
  const { createInMemoryDb } = await import('../../testing/in-memory-db.js')
  const db = createInMemoryDb()

  return { getDb: () => db }
})

// Better-Auth-Instanz mocken: getSession liefert standardmäßig einen festen
// Nutzer (gültige ObjectId-Hex, damit der Service sie für _id-Vergleiche
// verwenden kann). Für den 401-Test wird per mockReturnValueOnce null geliefert.
const ME = 'aaaaaaaaaaaaaaaaaaaaaaaa'
const ALICE = '111111111111111111111111'
const BOB = '222222222222222222222222'
const CAROL = '333333333333333333333333'
const DAVE = '444444444444444444444444'
const EVE = '555555555555555555555555'

// Aktiver Session-Nutzer (umschaltbar): Conectink-Aktionen hängen von der
// Rolle ab (Anfrage stellen vs. als Empfänger akzeptieren/ablehnen/ignorieren).
const authState = vi.hoisted(() => ({
  userId: 'aaaaaaaaaaaaaaaaaaaaaaaa',
}))

vi.mock('../../auth.js', () => ({
  getAuth: vi.fn(() => ({
    api: {
      getSession: async () => ({ user: { id: authState.userId } }),
    },
  })),
}))

interface UserSearchBody {
  users: Array<{
    id: string
    name: string
    image: string | null
    relation: string
  }>
}

interface RequestBody {
  id: string
  user: { id: string; name: string; image: string | null }
  createdAt: string
  direction: 'incoming' | 'outgoing'
}

interface RequestsBody {
  incoming: RequestBody[]
  outgoing: RequestBody[]
}

interface ConnectionsBody {
  connections: Array<{
    id: string
    user: { id: string; name: string; image: string | null }
    since: string
  }>
}

async function postRequest(toUserId: string): Promise<Response> {
  return app.request('/api/connectink/requests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ toUserId }),
  })
}

async function incomingRequestId(from: string): Promise<string> {
  const res = await app.request('/api/connectink/requests')
  const body = (await res.json()) as RequestsBody
  const request = body.incoming.find((item) => item.user.id === from)
  if (!request) {
    throw new Error(`Keine eingehende Anfrage von ${from} gefunden.`)
  }
  return request.id
}

describe('Conectink (Vertragstests)', () => {
  beforeEach(async () => {
    // Sauberer Zustand pro Test: alle Collections leeren und als „Ich“
    // anmelden (Standard-Session-Nutzer).
    const db = (await import('../../db.js')).getDb()
    ;(db as unknown as { clearAll(): void }).clearAll()
    authState.userId = ME

    // Nutzer + Profile seeden (Collection-Namen wie in der Produktion).
    const users = db.collection('user')
    await users.insertOne({
      _id: new ObjectId(ME),
      name: 'Ich Selber',
      email: 'ich@example.com',
      image: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    })
    await users.insertOne({
      _id: new ObjectId(ALICE),
      name: 'Alice Beispiel',
      email: 'alice@example.com',
      image: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    })
    await users.insertOne({
      _id: new ObjectId(BOB),
      name: 'Bob Muster',
      email: 'bob@example.com',
      image: 'https://example.com/bob.png',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    })
    await users.insertOne({
      _id: new ObjectId(CAROL),
      name: 'Carol Beispiel',
      email: 'carol@example.com',
      image: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    })
    await users.insertOne({
      _id: new ObjectId(DAVE),
      name: 'Dave Muster',
      email: 'dave@example.com',
      image: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    })
    await users.insertOne({
      _id: new ObjectId(EVE),
      name: 'Eve Beispiel',
      email: 'eve@example.com',
      image: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    })

    const profiles = db.collection('profile')
    await profiles.insertOne({ userId: ME, username: 'Ich' })
    await profiles.insertOne({ userId: ALICE, username: 'Alice B.' })
    await profiles.insertOne({ userId: BOB, username: 'Bob' })
    await profiles.insertOne({ userId: CAROL, username: 'Carol' })
    await profiles.insertOne({ userId: DAVE, username: 'Dave' })
    await profiles.insertOne({ userId: EVE, username: 'Eve' })
  })

  it('sucht Nutzer per Name/Username und schließt sich selbst aus', async () => {
    const res = await app.request('/api/connectink/users?q=alice')
    expect(res.status).toBe(200)
    const body = (await res.json()) as UserSearchBody
    expect(body.users).toHaveLength(1)
    expect(body.users[0].id).toBe(ALICE)
    // Anzeigename kommt aus dem Profil (username), nicht aus user.name.
    expect(body.users[0].name).toBe('Alice B.')
    expect(body.users[0].relation).toBe('none')

    // Eigene Person wird nie geliefert (auch wenn der Name matcht).
    const self = await app.request('/api/connectink/users?q=ich')
    const selfBody = (await self.json()) as UserSearchBody
    expect(selfBody.users).toHaveLength(0)

    // Ohne Treffer → leere Liste.
    const none = await app.request('/api/connectink/users?q=zzz')
    const noneBody = (await none.json()) as UserSearchBody
    expect(noneBody.users).toHaveLength(0)
  })

  it('stellt eine Connect-Anfrage (201)', async () => {
    const res = await postRequest(ALICE)
    expect(res.status).toBe(201)
    const body = (await res.json()) as RequestBody
    expect(body.direction).toBe('outgoing')
    expect(body.user.id).toBe(ALICE)
    expect(body.user.name).toBe('Alice B.')
    expect(body.id).toMatch(/^[0-9a-fA-F]{24}$/)
  })

  it('liefert 409 bei doppelter Anfrage (ALREADY_REQUESTED)', async () => {
    const first = await postRequest(ALICE)
    expect(first.status).toBe(201)

    const again = await postRequest(ALICE)
    expect(again.status).toBe(409)
    const body = (await again.json()) as { error: { code: string } }
    expect(body.error.code).toBe('ALREADY_REQUESTED')
  })

  it('liefert 400 bei Anfrage an sich selbst', async () => {
    const res = await postRequest(ME)
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('SELF_CONNECTION')
  })

  it('liefert 404 bei unbekanntem Ziel', async () => {
    const res = await postRequest('999999999999999999999999')
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('NOT_FOUND')
  })

  it('listet ausgehende Anfragen', async () => {
    const created = await postRequest(ALICE)
    expect(created.status).toBe(201)

    const res = await app.request('/api/connectink/requests')
    expect(res.status).toBe(200)
    const body = (await res.json()) as RequestsBody
    expect(body.outgoing.some((item) => item.user.id === ALICE)).toBe(true)
    expect(body.incoming).toHaveLength(0)
  })

  it('zeigt outgoingPending in der Suche', async () => {
    const created = await postRequest(ALICE)
    expect(created.status).toBe(201)

    const res = await app.request('/api/connectink/users?q=alice')
    const body = (await res.json()) as UserSearchBody
    expect(body.users[0].relation).toBe('outgoingPending')
  })

  it('erlaubt nach Ablehnung erneutes Anfragen (reject → re-send)', async () => {
    // Ich stelle eine Anfrage an Alice …
    const first = await postRequest(ALICE)
    expect(first.status).toBe(201)
    const firstBody = (await first.json()) as RequestBody

    // … Alice lehnt sie ab (Empfänger-Rolle).
    authState.userId = ALICE
    const reject = await app.request(
      `/api/connectink/requests/${firstBody.id}/reject`,
      { method: 'POST' },
    )
    expect(reject.status).toBe(200)

    // Nach Ablehnung darf ICH erneut anfragen (201).
    authState.userId = ME
    const again = await postRequest(ALICE)
    expect(again.status).toBe(201)

    const search = await app.request('/api/connectink/users?q=alice')
    const searchBody = (await search.json()) as UserSearchBody
    expect(searchBody.users[0].relation).toBe('outgoingPending')
  })

  it('blockiert erneutes Anfragen nach Ignorieren (ignore → 409)', async () => {
    // Ich stelle eine Anfrage an Bob …
    const first = await postRequest(BOB)
    expect(first.status).toBe(201)
    const firstBody = (await first.json()) as RequestBody

    // … Bob ignoriert sie (Empfänger-Rolle).
    authState.userId = BOB
    const ignore = await app.request(
      `/api/connectink/requests/${firstBody.id}/ignore`,
      { method: 'POST' },
    )
    expect(ignore.status).toBe(200)

    // Nach Ignorieren darf ICH NICHT erneut anfragen (409).
    authState.userId = ME
    const again = await postRequest(BOB)
    expect(again.status).toBe(409)
    const error = (await again.json()) as { error: { code: string } }
    expect(error.error.code).toBe('IGNORED')

    // Relation in der Suche ist 'ignored'.
    const search = await app.request('/api/connectink/users?q=bob')
    const searchBody = (await search.json()) as UserSearchBody
    expect(searchBody.users[0].relation).toBe('ignored')
  })

  it('verbindet bei Akzeptieren und erlaubt Entfernen', async () => {
    // Ich stelle eine Anfrage an Carol …
    const first = await postRequest(CAROL)
    expect(first.status).toBe(201)
    const firstBody = (await first.json()) as RequestBody

    // … Carol akzeptiert sie (Empfänger-Rolle).
    authState.userId = CAROL
    const accept = await app.request(
      `/api/connectink/requests/${firstBody.id}/accept`,
      { method: 'POST' },
    )
    expect(accept.status).toBe(200)

    // Als ich: Verbundene Liste enthält Carol, Suche zeigt 'accepted'.
    authState.userId = ME
    const list = await app.request('/api/connectink/connections')
    expect(list.status).toBe(200)
    const listBody = (await list.json()) as ConnectionsBody
    expect(listBody.connections.some((item) => item.user.id === CAROL)).toBe(
      true,
    )

    const search = await app.request('/api/connectink/users?q=carol')
    const searchBody = (await search.json()) as UserSearchBody
    expect(searchBody.users[0].relation).toBe('accepted')

    // Entfernen → 204, Liste leer, Suche wieder 'none'.
    const connection = listBody.connections.find(
      (item) => item.user.id === CAROL,
    )
    if (!connection) {
      throw new Error('Carol fehlt in der Verbunden-Liste.')
    }
    const remove = await app.request(
      `/api/connectink/connections/${connection.id}`,
      {
        method: 'DELETE',
      },
    )
    expect(remove.status).toBe(204)

    const listAfter = await app.request('/api/connectink/connections')
    const listAfterBody = (await listAfter.json()) as ConnectionsBody
    expect(listAfterBody.connections).toHaveLength(0)

    const searchAfter = await app.request('/api/connectink/users?q=carol')
    const searchAfterBody = (await searchAfter.json()) as UserSearchBody
    expect(searchAfterBody.users[0].relation).toBe('none')
  })

  it('verhindert Doppelanfrage bei umgekehrter offener Anfrage', async () => {
    const db = (await import('../../db.js')).getDb()
    // Dave hat mir bereits eine offene Anfrage geschickt.
    await db.collection('connections').insertOne({
      fromUserId: DAVE,
      toUserId: ME,
      status: 'pending',
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    const res = await postRequest(DAVE)
    expect(res.status).toBe(409)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('REVERSE_PENDING')

    // Die eingehende Anfrage von Dave ist sichtbar.
    const requests = await app.request('/api/connectink/requests')
    const requestsBody = (await requests.json()) as RequestsBody
    expect(requestsBody.incoming.some((item) => item.user.id === DAVE)).toBe(
      true,
    )
  })

  it('akzeptiert eine eingehende Anfrage und verbindet', async () => {
    const db = (await import('../../db.js')).getDb()
    await db.collection('connections').insertOne({
      fromUserId: EVE,
      toUserId: ME,
      status: 'pending',
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    const requestId = await incomingRequestId(EVE)

    const accept = await app.request(
      `/api/connectink/requests/${requestId}/accept`,
      {
        method: 'POST',
      },
    )
    expect(accept.status).toBe(200)
    const acceptBody = (await accept.json()) as RequestBody
    expect(acceptBody.direction).toBe('incoming')
    expect(acceptBody.user.id).toBe(EVE)

    const list = await app.request('/api/connectink/connections')
    const listBody = (await list.json()) as ConnectionsBody
    expect(listBody.connections.some((item) => item.user.id === EVE)).toBe(true)
  })

  it('liefert 401 ohne gültige Session', async () => {
    const { getAuth } = await import('../../auth.js')
    vi.mocked(getAuth).mockReturnValueOnce({
      api: { getSession: async () => null },
    } as unknown as ReturnType<typeof getAuth>)

    const res = await app.request('/api/connectink/requests')
    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('UNAUTHORIZED')
  })
})
