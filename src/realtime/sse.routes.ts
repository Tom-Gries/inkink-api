import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import type { ChangeStream } from 'mongodb'
import { watchTestMessages } from '../services/test/test.service'

const HEARTBEAT_INTERVAL_MS = 25_000

/**
 * SSE-Stream für Echtzeit-Updates – läuft auf Vercel (Streaming-Response).
 * Mit Datenbank werden neue Test-Nachrichten als „test:created" gepusht
 * (Mongo Change Stream); ohne Datenbank nur Heartbeats.
 */
export const realtimeRoutes = new Hono().get('/events', (c) =>
  streamSSE(
    c,
    async (stream) => {
      let eventId = 0
      let changeStream: ChangeStream | null = null

      try {
        changeStream = watchTestMessages()
      } catch {
        // Ohne Datenbank: Stream läuft trotzdem (nur Heartbeats).
      }

      const sendHeartbeat = () =>
        stream.writeSSE({
          event: 'heartbeat',
          data: new Date().toISOString(),
          id: String(eventId++),
        })

      await sendHeartbeat()

      const changes = changeStream ? changeStream[Symbol.asyncIterator]() : null

      while (!stream.aborted) {
        const next = changes
          ? await Promise.race([
              changes
                .next()
                .then((result) => ({ kind: 'change' as const, result })),
              stream
                .sleep(HEARTBEAT_INTERVAL_MS)
                .then(() => ({ kind: 'timeout' as const })),
            ])
          : { kind: 'timeout' as const }

        if (stream.aborted) break

        if (next.kind === 'timeout') {
          await sendHeartbeat()
          continue
        }

        if (next.result.done) break

        await stream.writeSSE({
          event: 'test:created',
          data: serializeChange(next.result.value),
          id: String(eventId++),
        })
      }

      await changeStream?.close().catch(() => undefined)
    },
    async (error) => {
      console.error('SSE-Stream-Fehler:', error)
    },
  ),
)

interface ChangeDocument {
  operationType?: string
  documentKey?: { _id?: { toString(): string } }
}

function serializeChange(change: ChangeDocument): string {
  return JSON.stringify({
    operationType: change.operationType,
    messageId: change.documentKey?._id?.toString() ?? null,
  })
}
