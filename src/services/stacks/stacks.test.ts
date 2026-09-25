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

interface StackBody {
  id: string
  name: string
  creatorName: string
  examTime: number
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
})
