import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { getAuth } from './auth.js'
import { getDb } from './db.js'
import { errorHandler } from './hooks/error-handler.js'
import { realtimeRoutes } from './realtime/sse.routes.js'
import { meRoutes } from './services/me/me.routes.js'
import { profileRoutes } from './services/profile/profile.routes.js'
import { stacksRoutes } from './services/stacks/stacks.routes.js'
import { testRoutes } from './services/test/test.routes.js'
import { usersRoutes } from './services/users/users.routes.js'

/**
 * Hono-App – läuft als EINE Vercel-Function unter /api (Fluid Compute,
 * inkl. Streaming) und lokal über `tsx server/dev.ts`.
 *
 * Production:
 * Frontend und API liegen auf GETRENNTEN Domains:
 *
 *   Frontend: https://inkink-lilac.vercel.app
 *   API:      https://inkink-api.vercel.app
 *
 * Deshalb muss die API auch in Production CORS aktivieren.
 *
 * Lokal:
 *   Frontend: http://localhost:3000
 *   API:      http://localhost:8787
 *
 * Better Auth verwendet Credentials/Cookies, daher ist
 * `credentials: true` erforderlich.
 */
const app = new Hono().basePath('/api')

app.use(
  '*',
  cors({
    origin: [
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'https://inkink-lilac.vercel.app',
    ],
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    exposeHeaders: ['Content-Length'],
    maxAge: 600,
    credentials: true,
  }),
)

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

    console.log(
      `[auth:server] → ${c.req.method} ${url.pathname}${url.search}`,
    )

    try {
      const res = await getAuth().handler(c.req.raw)

      console.log(
        `[auth:server] ← ${c.req.method} ${url.pathname} status=${res.status}`,
      )

      return res
    } catch (error) {
      console.error(
        `[auth:server] ✗ ${c.req.method} ${url.pathname}:`,
        error,
      )

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