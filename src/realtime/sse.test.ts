// @vitest-environment node
import { describe, expect, it } from 'vitest'
import app from '../index'

describe('GET /api/realtime/events', () => {
  it('öffnet einen SSE-Stream und sendet sofort ein Heartbeat-Event', async () => {
    const controller = new AbortController()
    const res = await app.request('/api/realtime/events', {
      signal: controller.signal,
    })

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')

    const reader = res.body?.getReader()
    expect(reader).toBeDefined()
    if (!reader) return

    const { value } = await reader.read()
    const text = new TextDecoder().decode(value)
    expect(text).toContain('event: heartbeat')

    await controller.abort()
    await reader.cancel().catch(() => undefined)
  })
})
