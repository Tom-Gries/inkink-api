// @vitest-environment node
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

// Better-Auth-Instanz mocken: getSession liefert standardmäßig einen festen
// Nutzer, damit die Session-geschützten Routen ohne echte Auth-Infrastruktur
// laufen. Für den 401-Test wird per mockReturnValueOnce einmalig null geliefert,
// für die Fremdzugriffs-Tests ein anderer Nutzer.
vi.mock('../../auth.js', () => ({
  getAuth: vi.fn(() => ({
    api: {
      getSession: async () => ({ user: { id: 'user-1' } }),
    },
  })),
}))

interface StackBody {
  id: string
  name: string
  creatorName: string
  examTime: number
  isPublic: boolean
  archived: boolean
  questions: unknown[]
  leaderboard: Array<{ name: string; score: number; time: number }>
}

let createdId: string

const baseStack = {
  name: 'Kunstquiz',
  creatorName: 'Leonardo Ein Vinci',
  examTime: 600,
  questions: [
    {
      id: 'q1',
      type: 'closed',
      appearance: 'learn & proof',
      question: 'Wer malte die Mona Lisa?',
      explanation: 'Leonardo da Vinci.',
      points: 2,
      answerOptions: [
        { id: 'a', text: 'Leonardo', correct: true },
        { id: 'b', text: 'Picasso', correct: false },
      ],
    },
    {
      id: 'q2',
      type: 'open',
      appearance: 'proof',
      question: 'Erkläre Blindkontur.',
      explanation: 'Zeichnen ohne auf das Papier zu schauen.',
      points: 3,
      answerOptions: [],
    },
  ],
}

/**
 * Legt direkt ein Legacy-Dokument an (ohne `userId`-Feld, wie Stacks
 * vor der Zugriffskontrolle bzw. anonym angelegte Stacks).
 */
async function seedLegacyStack(
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const { insertedId } = await getDb()
    .collection('stacks')
    .insertOne({
      name: 'Legacy-Stack',
      creatorName: 'Legacy Creator',
      examTime: 0,
      passingScore: 0,
      isPublic: true,
      archived: false,
      questions: [],
      leaderboard: [],
      ...overrides,
    })

  return insertedId.toHexString()
}

describe('Stacks (Vertragstests)', () => {
  it('legt einen Stack an (201)', async () => {
    const res = await app.request('/api/stacks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(baseStack),
    })

    expect(res.status).toBe(201)
    const body = (await res.json()) as StackBody
    expect(body.name).toBe('Kunstquiz')
    expect(body.archived).toBe(false)
    // Ohne Angabe ist ein Stack standardmäßig öffentlich (Default public).
    expect(body.isPublic).toBe(true)
    expect(body.leaderboard).toEqual([])
    expect(body.id).toMatch(/^[0-9a-fA-F]{24}$/)

    createdId = body.id
  })

  it('liefert 400 bei fehlendem Namen', async () => {
    const res = await app.request('/api/stacks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...baseStack, name: '' }),
    })

    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('VALIDATION_ERROR')
  })

  it('liefert 400 bei geschlossener Frage ohne korrekte Option', async () => {
    const stack = {
      ...baseStack,
      questions: [
        {
          id: 'q1',
          type: 'closed',
          appearance: 'learn & proof',
          question: 'Was?',
          explanation: '',
          points: 1,
          answerOptions: [
            { id: 'a', text: 'A', correct: false },
            { id: 'b', text: 'B', correct: false },
          ],
        },
      ],
    }
    const res = await app.request('/api/stacks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(stack),
    })

    expect(res.status).toBe(400)
  })

  it('weist offenen Fragen ohne Antwortoptionen nicht ab', async () => {
    const res = await app.request(`/api/stacks/${createdId}`)

    expect(res.status).toBe(200)
    const body = (await res.json()) as StackBody
    expect(body.questions).toHaveLength(2)
  })

  it('listet die Stacks (200)', async () => {
    const res = await app.request('/api/stacks')

    expect(res.status).toBe(200)
    const list = (await res.json()) as StackBody[]
    expect(list.some((s) => s.name === 'Kunstquiz')).toBe(true)
  })

  it('liefert 404 für unbekannte, aber gültige ID', async () => {
    const res = await app.request('/api/stacks/507f1f77bcf86cd799439011')
    expect(res.status).toBe(404)
  })

  it('aktualisiert einen Stack (ersetzt Fragen, 200)', async () => {
    const updated = {
      ...baseStack,
      name: 'Kunstquiz II',
      isPublic: false,
      questions: [baseStack.questions[0]],
    }
    const res = await app.request(`/api/stacks/${createdId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated),
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as StackBody
    expect(body.name).toBe('Kunstquiz II')
    expect(body.questions).toHaveLength(1)
    expect(body.isPublic).toBe(false)
  })

  it('archiviert einen Stack (200)', async () => {
    const res = await app.request(`/api/stacks/${createdId}/archive`, {
      method: 'POST',
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as { archived: boolean }
    expect(body.archived).toBe(true)
  })

  it('fügt Leaderboard-Einträge in die Top 3 ein (200)', async () => {
    const entries = [
      { name: 'Tom', score: 18, time: 400 },
      { name: 'Frida', score: 20, time: 500 },
      { name: 'Claude', score: 20, time: 300 },
      { name: 'Salvador', score: 19, time: 500 },
    ]

    for (const entry of entries) {
      const res = await app.request(`/api/stacks/${createdId}/leaderboard`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry),
      })
      expect(res.status).toBe(200)
    }

    const res = await app.request(`/api/stacks/${createdId}`)
    const body = (await res.json()) as StackBody
    // Claude (20/300), Frida (20/500), Salvador (19/500) – Tom (18) fällt raus.
    expect(body.leaderboard.map((e) => e.name)).toEqual([
      'Claude',
      'Frida',
      'Salvador',
    ])
  })

  it('ignoriert Einträge außerhalb der Top 3', async () => {
    const res = await app.request(`/api/stacks/${createdId}/leaderboard`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Schlecht', score: 1, time: 1 }),
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as StackBody
    expect(body.leaderboard.some((e) => e.name === 'Schlecht')).toBe(false)
    expect(body.leaderboard).toHaveLength(3)
  })

  it('verlangt eine Session zum Bearbeiten (401 ohne Login)', async () => {
    const { getAuth } = await import('../../auth.js')
    vi.mocked(getAuth).mockReturnValueOnce({
      api: { getSession: async () => null },
    } as unknown as ReturnType<typeof getAuth>)

    const res = await app.request(`/api/stacks/${createdId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(baseStack),
    })

    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('UNAUTHORIZED')
  })

  it('verlangt eine Session zum Archivieren (401 ohne Login)', async () => {
    const { getAuth } = await import('../../auth.js')
    vi.mocked(getAuth).mockReturnValueOnce({
      api: { getSession: async () => null },
    } as unknown as ReturnType<typeof getAuth>)

    const res = await app.request(`/api/stacks/${createdId}/archive`, {
      method: 'POST',
    })

    expect(res.status).toBe(401)
  })

  it('erlaubt das Anlegen ohne Session, erzwingt aber öffentlich (201)', async () => {
    const { getAuth } = await import('../../auth.js')
    vi.mocked(getAuth).mockReturnValueOnce({
      api: { getSession: async () => null },
    } as unknown as ReturnType<typeof getAuth>)

    const res = await app.request('/api/stacks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...baseStack,
        name: 'Anonymer Stack',
        isPublic: false,
      }),
    })

    expect(res.status).toBe(201)
    const body = (await res.json()) as StackBody
    // Privat stellen ist ohne Login nicht erlaubt → Server erzwingt öffentlich.
    expect(body.isPublic).toBe(true)
    expect(body.id).toMatch(/^[0-9a-fA-F]{24}$/)
  })

  it('zeigt anonym nur öffentliche Stacks (Liste und Einzelansicht)', async () => {
    // Zwei Stacks anlegen (angemeldet): einer öffentlich, einer privat.
    const publicRes = await app.request('/api/stacks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...baseStack, name: 'Öffentlich für alle' }),
    })
    expect(publicRes.status).toBe(201)
    const publicStack = (await publicRes.json()) as StackBody

    const privateRes = await app.request('/api/stacks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...baseStack,
        name: 'Streng geheim',
        isPublic: false,
      }),
    })
    expect(privateRes.status).toBe(201)
    const privateStack = (await privateRes.json()) as StackBody

    const { getAuth } = await import('../../auth.js')
    const asAnonymous = () =>
      vi.mocked(getAuth).mockReturnValueOnce({
        api: { getSession: async () => null },
      } as unknown as ReturnType<typeof getAuth>)

    // Anonyme Liste: nur öffentliche Stacks.
    asAnonymous()
    const listRes = await app.request('/api/stacks')
    expect(listRes.status).toBe(200)
    const list = (await listRes.json()) as StackBody[]
    expect(list.some((s) => s.id === publicStack.id)).toBe(true)
    expect(list.some((s) => s.id === privateStack.id)).toBe(false)

    // Anonyme Einzelansicht: öffentlich 200, privat 404.
    asAnonymous()
    const publicGet = await app.request(`/api/stacks/${publicStack.id}`)
    expect(publicGet.status).toBe(200)

    asAnonymous()
    const privateGet = await app.request(`/api/stacks/${privateStack.id}`)
    expect(privateGet.status).toBe(404)
  })

  it('übernimmt einen öffentlichen Legacy-Stack ohne userId beim Bearbeiten (Claim)', async () => {
    const legacyId = await seedLegacyStack({ isPublic: true })

    // user-1 öffnet den Legacy-Stack, stellt privat und speichert.
    const putRes = await app.request(`/api/stacks/${legacyId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...baseStack,
        name: 'Übernommen',
        isPublic: false,
      }),
    })
    expect(putRes.status).toBe(200)
    expect(((await putRes.json()) as StackBody).isPublic).toBe(false)

    // Ab jetzt ist der Stack dem Besitzer zugeordnet und sichtbar.
    const ownerList = await app.request('/api/stacks')
    const ownerListBody = (await ownerList.json()) as StackBody[]
    expect(ownerListBody.some((s) => s.id === legacyId)).toBe(true)

    // Für andere bleibt er unsichtbar.
    const { getAuth } = await import('../../auth.js')
    vi.mocked(getAuth).mockReturnValueOnce({
      api: { getSession: async () => ({ user: { id: 'user-2' } }) },
    } as unknown as ReturnType<typeof getAuth>)
    const otherGet = await app.request(`/api/stacks/${legacyId}`)
    expect(otherGet.status).toBe(404)
  })

  it('verweigert die Übernahme eines privaten Legacy-Stacks ohne userId (404)', async () => {
    const legacyId = await seedLegacyStack({ isPublic: false })

    const res = await app.request(`/api/stacks/${legacyId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...baseStack, name: 'Hijack', isPublic: true }),
    })

    expect(res.status).toBe(404)
  })

  it('übernimmt einen öffentlichen Legacy-Stack beim Archivieren (Claim)', async () => {
    const legacyId = await seedLegacyStack({ isPublic: true })

    const res = await app.request(`/api/stacks/${legacyId}/archive`, {
      method: 'POST',
    })

    expect(res.status).toBe(200)
  })

  it('zeigt private Stacks nur dem Besitzer', async () => {
    const res = await app.request('/api/stacks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...baseStack,
        name: 'Privatquiz',
        isPublic: false,
      }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as StackBody

    // Der Besitzer sieht den privaten Stack in der Liste und per ID.
    const ownerList = await app.request('/api/stacks')
    const ownerListBody = (await ownerList.json()) as StackBody[]
    expect(ownerListBody.some((s) => s.id === body.id)).toBe(true)

    const ownerGet = await app.request(`/api/stacks/${body.id}`)
    expect(ownerGet.status).toBe(200)

    // Ein fremder Nutzer sieht ihn weder in der Liste noch per ID (404).
    const { getAuth } = await import('../../auth.js')
    vi.mocked(getAuth).mockReturnValueOnce({
      api: { getSession: async () => ({ user: { id: 'user-2' } }) },
    } as unknown as ReturnType<typeof getAuth>)

    const otherList = await app.request('/api/stacks')
    const otherListBody = (await otherList.json()) as StackBody[]
    expect(otherListBody.some((s) => s.id === body.id)).toBe(false)

    vi.mocked(getAuth).mockReturnValueOnce({
      api: { getSession: async () => ({ user: { id: 'user-2' } }) },
    } as unknown as ReturnType<typeof getAuth>)

    const otherGet = await app.request(`/api/stacks/${body.id}`)
    expect(otherGet.status).toBe(404)

    // Danach sieht der Besitzer den Stack weiterhin per ID.
    const ownerGetAgain = await app.request(`/api/stacks/${body.id}`)
    expect(ownerGetAgain.status).toBe(200)
  })

  it('verweigert das Bearbeiten und Archivieren fremder Stacks (404)', async () => {
    const { getAuth } = await import('../../auth.js')

    // Der Besitzer (user-1) kann den Stack weiterhin bearbeiten.
    const ownerPut = await app.request(`/api/stacks/${createdId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...baseStack, name: 'Privatquiz' }),
    })
    expect(ownerPut.status).toBe(200)

    // Ein fremder Nutzer darf weder bearbeiten noch archivieren – beides 404.
    vi.mocked(getAuth).mockReturnValueOnce({
      api: { getSession: async () => ({ user: { id: 'user-2' } }) },
    } as unknown as ReturnType<typeof getAuth>)
    const otherPut = await app.request(`/api/stacks/${createdId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...baseStack, name: 'Übernommen' }),
    })
    expect(otherPut.status).toBe(404)

    vi.mocked(getAuth).mockReturnValueOnce({
      api: { getSession: async () => ({ user: { id: 'user-2' } }) },
    } as unknown as ReturnType<typeof getAuth>)
    const otherArchive = await app.request(`/api/stacks/${createdId}/archive`, {
      method: 'POST',
    })
    expect(otherArchive.status).toBe(404)
  })
})
