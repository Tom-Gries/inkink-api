import { Hono } from 'hono'
import { getAuth } from './auth'
import { getDb } from './db'
import { errorHandler } from './hooks/error-handler'
import { realtimeRoutes } from './realtime/sse.routes'
import { meRoutes } from './services/me/me.routes'
import { profileRoutes } from './services/profile/profile.routes'
import { stacksRoutes } from './services/stacks/stacks.routes'
import { testRoutes } from './services/test/test.routes'
import { usersRoutes } from './services/users/users.routes'

/**
 * Hono-App – läuft als EINE Vercel-Function unter /api (Fluid Compute,
 * inkl. Streaming) und lokal über `tsx server/dev.ts`.
 *
 * Seit dem Umbau liegen Frontend und API auf derselben Domain:
 *  - keine CORS-Middleware mehr nötig,
 *  - Better-Auth-Cookies (httpOnly, SameSite) laufen zwischen allen
 *    /api/auth/*-Endpunkten normal – der frühere state_mismatch-Fehler
 *    (getrennte Domains) ist damit gegenstandslos.
 */
const app = new Hono().basePath('/api')

app.onError(errorHandler)

const routes = app
  .get('/health', (c) => c.json({ status: 'ok' }))
  .get('/ping', async (c) => {
    try {
      await getDb().command({ ping: 1 })

      return c.json({ mongo: 'up' })
    } catch {
      return c.json({ mongo: 'down' }, 503)
    }
  })
  .all('/auth/*', async (c) => {
    const url = new URL(c.req.url)
    console.log(`[auth:server] → ${c.req.method} ${url.pathname}${url.search}`)

    try {
      const res = await getAuth().handler(c.req.raw)
      console.log(
        `[auth:server] ← ${c.req.method} ${url.pathname} status=${res.status}`,
      )
      return res
    } catch (error) {
      console.error(`[auth:server] ✗ ${c.req.method} ${url.pathname}:`, error)
      throw error
    }
  })
  .route('/me', meRoutes)
  .route('/profile', profileRoutes)
  .route('/stacks', stacksRoutes)
  .route('/test', testRoutes)
  .route('/users', usersRoutes)
  .route('/realtime', realtimeRoutes)

export type AppType = typeof routes

export default app
