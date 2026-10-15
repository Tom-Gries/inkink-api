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

interface GroupBody {
  id: string
  name: string
  ownerId: string
  management: string
  myRole: string
  createdAt: string
  members: Array<{
    userId: string
    name: string
    image: string | null
    role: string
    addedAt: string
  }>
  invitations: Array<{
    userId: string
    name: string
    image: string | null
    role: string
    addedAt: string
  }>
}

interface GroupInvitationsBody {
  invitations: Array<{
    id: string
    group: { id: string; name: string }
    invitedBy: { id: string; name: string; image: string | null }
    status: string
    createdAt: string
  }>
}

async function createGroupRequest(name: string): Promise<Response> {
  return app.request('/api/connectink/groups', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
}

async function addMemberRequest(
  groupId: string,
  userId: string,
): Promise<Response> {
  return app.request(`/api/connectink/groups/${groupId}/members`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  })
}

async function patchGroupRequest(
  groupId: string,
  body: { name?: string; management?: string },
): Promise<Response> {
  return app.request(`/api/connectink/groups/${groupId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** Legt eine acceptierte Verbindung zwischen zwei Nutzern an. */
async function seedConnection(from: string, to: string): Promise<void> {
  const db = (await import('../../db.js')).getDb()
  await db.collection('connections').insertOne({
    fromUserId: from,
    toUserId: to,
    status: 'accepted',
    createdAt: new Date(),
    updatedAt: new Date(),
  })
}

/**
 * Lässt den AKTUELLEN Session-Nutzer einen Ziel-Nutzer einladen und den
 * Ziel-Nutzer die Einladung annehmen. Danach ist wieder der Einladende aktiv.
 */
async function inviteAndAccept(
  groupId: string,
  targetUserId: string,
): Promise<void> {
  const inviter = authState.userId

  const invite = await addMemberRequest(groupId, targetUserId)
  expect(invite.status).toBe(200)

  authState.userId = targetUserId
  const accept = await app.request(
    `/api/connectink/groups/invitations/${groupId}/accept`,
    { method: 'POST' },
  )
  expect(accept.status).toBe(200)

  authState.userId = inviter
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
  it('erstellt eine Gruppe (201) mit Owner als Mitglied', async () => {
    const res = await createGroupRequest('Lerngruppe')
    expect(res.status).toBe(201)
    const body = (await res.json()) as GroupBody
    expect(body.name).toBe('Lerngruppe')
    expect(body.ownerId).toBe(ME)
    expect(body.management).toBe('owner')
    expect(body.myRole).toBe('owner')
    expect(body.members).toHaveLength(1)
    expect(body.members[0].userId).toBe(ME)
    expect(body.members[0].role).toBe('owner')
  })

  it('liefert 400 bei leerem Gruppennamen', async () => {
    const res = await createGroupRequest('   ')
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('VALIDATION_ERROR')
  })

  it('listet meine Gruppen', async () => {
    const created = await createGroupRequest('Lerngruppe')
    expect(created.status).toBe(201)

    const res = await app.request('/api/connectink/groups')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { groups: GroupBody[] }
    expect(body.groups).toHaveLength(1)
    expect(body.groups[0].name).toBe('Lerngruppe')
  })

  it('lädt ein; erst nach Akzeptieren ist die Person Mitglied und sieht die Gruppe', async () => {
    await seedConnection(ME, ALICE)
    const created = await createGroupRequest('Lerngruppe')
    const group = (await created.json()) as GroupBody

    // Owner lädt Alice ein → offene Einladung, aber noch kein Mitglied.
    const add = await addMemberRequest(group.id, ALICE)
    expect(add.status).toBe(200)
    const addBody = (await add.json()) as GroupBody
    expect(addBody.invitations.some((i) => i.userId === ALICE)).toBe(true)
    expect(addBody.members.some((m) => m.userId === ALICE)).toBe(false)

    // Alice sieht die Einladung, aber noch nicht die Gruppe als Mitglied.
    authState.userId = ALICE
    const inv = await app.request('/api/connectink/groups/invitations')
    const invBody = (await inv.json()) as GroupInvitationsBody
    expect(invBody.invitations.some((i) => i.group.id === group.id)).toBe(true)

    const listBefore = await app.request('/api/connectink/groups')
    const listBeforeBody = (await listBefore.json()) as { groups: GroupBody[] }
    expect(listBeforeBody.groups.some((g) => g.id === group.id)).toBe(false)

    // Alice akzeptiert → Mitglied und sieht die Gruppe.
    const accept = await app.request(
      `/api/connectink/groups/invitations/${group.id}/accept`,
      { method: 'POST' },
    )
    expect(accept.status).toBe(200)

    const list = await app.request('/api/connectink/groups')
    const listBody = (await list.json()) as { groups: GroupBody[] }
    expect(listBody.groups.some((g) => g.id === group.id)).toBe(true)
    expect(listBody.groups[0].myRole).toBe('member')
  })

  it('blockiert das Hinzufügen nicht-verbundener Nutzer (NOT_CONNECTED)', async () => {
    const created = await createGroupRequest('Lerngruppe')
    const group = (await created.json()) as GroupBody

    // Alice ist NICHT mit mir verbunden.
    const add = await addMemberRequest(group.id, ALICE)
    expect(add.status).toBe(400)
    const body = (await add.json()) as { error: { code: string } }
    expect(body.error.code).toBe('NOT_CONNECTED')
  })

  it('verweigert regulären Mitgliedern das Hinzufügen in der owner-Richtlinie', async () => {
    await seedConnection(ME, ALICE)
    await seedConnection(ME, BOB)
    const created = await createGroupRequest('Lerngruppe')
    const group = (await created.json()) as GroupBody

    // Alice als aktives Mitglied (einladen + akzeptieren).
    await inviteAndAccept(group.id, ALICE)

    // Alice (reguläres Mitglied) versucht, Bob einzuladen → 403.
    authState.userId = ALICE
    const addBob = await addMemberRequest(group.id, BOB)
    expect(addBob.status).toBe(403)
  })

  it('liefert 409 bei offener Einladung und bei bereits enthaltenem Mitglied', async () => {
    await seedConnection(ME, ALICE)
    const created = await createGroupRequest('Lerngruppe')
    const group = (await created.json()) as GroupBody

    const first = await addMemberRequest(group.id, ALICE)
    expect(first.status).toBe(200)

    // Einladung bereits offen → 409 ALREADY_INVITED.
    const again = await addMemberRequest(group.id, ALICE)
    expect(again.status).toBe(409)
    const againBody = (await again.json()) as { error: { code: string } }
    expect(againBody.error.code).toBe('ALREADY_INVITED')

    // Alice akzeptiert → aktives Mitglied → erneutes Einladen → 409 ALREADY_MEMBER.
    authState.userId = ALICE
    const accept = await app.request(
      `/api/connectink/groups/invitations/${group.id}/accept`,
      { method: 'POST' },
    )
    expect(accept.status).toBe(200)

    authState.userId = ME
    const asMember = await addMemberRequest(group.id, ALICE)
    expect(asMember.status).toBe(409)
    const asMemberBody = (await asMember.json()) as { error: { code: string } }
    expect(asMemberBody.error.code).toBe('ALREADY_MEMBER')
  })

  it('erlaubt in der members_add-Richtlinie das Hinzufügen durch Mitglieder', async () => {
    await seedConnection(ME, ALICE)
    await seedConnection(ALICE, BOB)
    const created = await createGroupRequest('Lerngruppe')
    const group = (await created.json()) as GroupBody

    // Alice als aktives Mitglied (einladen + akzeptieren).
    await inviteAndAccept(group.id, ALICE)

    const patch = await patchGroupRequest(group.id, {
      management: 'members_add',
    })
    expect(patch.status).toBe(200)

    // Alice (Mitglied) darf Bob einladen → 200 (offene Einladung).
    authState.userId = ALICE
    const addBob = await addMemberRequest(group.id, BOB)
    expect(addBob.status).toBe(200)
    const addBobBody = (await addBob.json()) as GroupBody
    expect(addBobBody.invitations.some((i) => i.userId === BOB)).toBe(true)
  })

  it('erlaubt in der members_full-Richtlinie Hinzufügen und Entfernen durch Mitglieder', async () => {
    await seedConnection(ME, ALICE)
    await seedConnection(ME, BOB)
    await seedConnection(ALICE, BOB)
    const created = await createGroupRequest('Lerngruppe')
    const group = (await created.json()) as GroupBody

    // Alice + Bob als aktive Mitglieder (einladen + akzeptieren).
    await inviteAndAccept(group.id, ALICE)
    await inviteAndAccept(group.id, BOB)

    const patch = await patchGroupRequest(group.id, {
      management: 'members_full',
    })
    expect(patch.status).toBe(200)

    // Alice (Mitglied) entfernt Bob → 200.
    authState.userId = ALICE
    const remove = await app.request(
      `/api/connectink/groups/${group.id}/members/${BOB}`,
      { method: 'DELETE' },
    )
    expect(remove.status).toBe(200)
    const removeBody = (await remove.json()) as GroupBody
    expect(removeBody.members.some((m) => m.userId === BOB)).toBe(false)
  })

  it('entfernt Mitglieder (Owner) und blockiert das Entfernen des Owners', async () => {
    await seedConnection(ME, ALICE)
    const created = await createGroupRequest('Lerngruppe')
    const group = (await created.json()) as GroupBody

    // Alice als aktives Mitglied (einladen + akzeptieren).
    await inviteAndAccept(group.id, ALICE)

    const remove = await app.request(
      `/api/connectink/groups/${group.id}/members/${ALICE}`,
      { method: 'DELETE' },
    )
    expect(remove.status).toBe(200)
    const removeBody = (await remove.json()) as GroupBody
    expect(removeBody.members.some((m) => m.userId === ALICE)).toBe(false)

    // Der Owner selbst kann nicht entfernt werden → 400.
    const removeOwner = await app.request(
      `/api/connectink/groups/${group.id}/members/${ME}`,
      { method: 'DELETE' },
    )
    expect(removeOwner.status).toBe(400)
  })

  it('erlaubt Umbenennen für Owner, nicht für Mitglieder; Richtlinie nur Owner', async () => {
    await seedConnection(ME, ALICE)
    const created = await createGroupRequest('Lerngruppe')
    const group = (await created.json()) as GroupBody

    // Alice als aktives Mitglied (einladen + akzeptieren).
    await inviteAndAccept(group.id, ALICE)

    // Owner benennt um + ändert Richtlinie → 200.
    const patch = await patchGroupRequest(group.id, {
      name: 'Neuer Name',
      management: 'members_add',
    })
    expect(patch.status).toBe(200)
    const patchBody = (await patch.json()) as GroupBody
    expect(patchBody.name).toBe('Neuer Name')
    expect(patchBody.management).toBe('members_add')

    // Alice (Mitglied) darf nicht umbenennen → 403.
    authState.userId = ALICE
    const patchMember = await patchGroupRequest(group.id, { name: 'Hack' })
    expect(patchMember.status).toBe(403)
  })

  it('ernennt Admins; Admins verwalten auch in der owner-Richtlinie', async () => {
    await seedConnection(ME, ALICE)
    await seedConnection(ME, BOB)
    const created = await createGroupRequest('Lerngruppe')
    const group = (await created.json()) as GroupBody

    // Alice + Bob als aktive Mitglieder (einladen + akzeptieren).
    await inviteAndAccept(group.id, ALICE)
    await inviteAndAccept(group.id, BOB)

    // Owner macht Alice zum Admin.
    const promote = await app.request(
      `/api/connectink/groups/${group.id}/admins`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: ALICE }),
      },
    )
    expect(promote.status).toBe(200)
    const promoteBody = (await promote.json()) as GroupBody
    expect(promoteBody.members.find((m) => m.userId === ALICE)?.role).toBe(
      'admin',
    )

    // Alice (Admin) darf in der owner-Richtlinie Bob entfernen → 200.
    authState.userId = ALICE
    const remove = await app.request(
      `/api/connectink/groups/${group.id}/members/${BOB}`,
      { method: 'DELETE' },
    )
    expect(remove.status).toBe(200)

    // Alice darf KEINE Admins ernennen → 403.
    const promoteByAdmin = await app.request(
      `/api/connectink/groups/${group.id}/admins`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: BOB }),
      },
    )
    expect(promoteByAdmin.status).toBe(403)

    // Owner entzieht den Admin-Status.
    authState.userId = ME
    const demote = await app.request(
      `/api/connectink/groups/${group.id}/admins/${ALICE}`,
      { method: 'DELETE' },
    )
    expect(demote.status).toBe(200)
    const demoteBody = (await demote.json()) as GroupBody
    expect(demoteBody.members.find((m) => m.userId === ALICE)?.role).toBe(
      'member',
    )
  })

  it('löscht die Gruppe (Owner) und verweigert Nicht-Ownern', async () => {
    await seedConnection(ME, ALICE)
    const created = await createGroupRequest('Lerngruppe')
    const group = (await created.json()) as GroupBody

    // Alice als aktives Mitglied (einladen + akzeptieren).
    await inviteAndAccept(group.id, ALICE)

    // Alice darf nicht löschen → 403.
    authState.userId = ALICE
    const forbidden = await app.request(`/api/connectink/groups/${group.id}`, {
      method: 'DELETE',
    })
    expect(forbidden.status).toBe(403)

    // Owner löscht → 204; danach ist die Gruppe für alle weg.
    authState.userId = ME
    const del = await app.request(`/api/connectink/groups/${group.id}`, {
      method: 'DELETE',
    })
    expect(del.status).toBe(204)

    const list = await app.request('/api/connectink/groups')
    const listBody = (await list.json()) as { groups: GroupBody[] }
    expect(listBody.groups).toHaveLength(0)

    authState.userId = ALICE
    const listAlice = await app.request('/api/connectink/groups')
    const listAliceBody = (await listAlice.json()) as { groups: GroupBody[] }
    expect(listAliceBody.groups).toHaveLength(0)
  })
  it('erlaubt nach Ablehnung einer Einladung erneutes Einladen', async () => {
    await seedConnection(ME, ALICE)
    const created = await createGroupRequest('Lerngruppe')
    const group = (await created.json()) as GroupBody

    const invite = await addMemberRequest(group.id, ALICE)
    expect(invite.status).toBe(200)

    // Alice lehnt ab.
    authState.userId = ALICE
    const reject = await app.request(
      `/api/connectink/groups/invitations/${group.id}/reject`,
      { method: 'POST' },
    )
    expect(reject.status).toBe(200)

    // Owner darf erneut einladen (reaktiviert auf pending).
    authState.userId = ME
    const again = await addMemberRequest(group.id, ALICE)
    expect(again.status).toBe(200)
    const againBody = (await again.json()) as GroupBody
    expect(againBody.invitations.some((i) => i.userId === ALICE)).toBe(true)
  })

  it('blockiert erneutes Einladen nach Ignorieren (IGNORED)', async () => {
    await seedConnection(ME, ALICE)
    const created = await createGroupRequest('Lerngruppe')
    const group = (await created.json()) as GroupBody

    const invite = await addMemberRequest(group.id, ALICE)
    expect(invite.status).toBe(200)

    // Alice ignoriert.
    authState.userId = ALICE
    const ignore = await app.request(
      `/api/connectink/groups/invitations/${group.id}/ignore`,
      { method: 'POST' },
    )
    expect(ignore.status).toBe(200)

    // Owner darf NICHT erneut einladen → 409 IGNORED.
    authState.userId = ME
    const again = await addMemberRequest(group.id, ALICE)
    expect(again.status).toBe(409)
    const body = (await again.json()) as { error: { code: string } }
    expect(body.error.code).toBe('IGNORED')
  })
})
