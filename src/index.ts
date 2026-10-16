import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { getAuth } from './auth.js'
import { getTrustedOrigins } from './config.js'
import { getDb } from './db.js'
import { errorHandler } from './hooks/error-handler.js'
import { realtimeRoutes } from './realtime/sse.routes.js'
import { connectinkRoutes } from './services/connectink/connectink.routes.js'
import { feelingsRoutes } from './services/feelings/feelings.routes.js'
import { meRoutes } from './services/me/me.routes.js'
import { profileRoutes } from './services/profile/profile.routes.js'
import { stacksRoutes } from './services/stacks/stacks.routes.js'
import { testRoutes } from './services/test/test.routes.js'
import { usersRoutes } from './services/users/users.routes.js'

const api = new Hono().basePath('/api')

/**
 * CORS
 */
api.use(
  '*',
  cors({
    // Vertraute Origins aus der Env-Variable TRUSTED_ORIGINS
    // (komma-separiert, getrimmt). Als Funktion pro Request gelöst –
    // die Liste ist lazy lesbar (konsistent zu getDb/getAuth) und je
    // Umgebung über die Env-Variable konfigurierbar.
    origin: (origin) => (getTrustedOrigins().includes(origin) ? origin : null),
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    exposeHeaders: ['Content-Length'],
    maxAge: 600,
    credentials: true,
  }),
)

api.onError(errorHandler)

const routes = api
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
  .route('/feelings', feelingsRoutes)
  .route('/connectink', connectinkRoutes)
  .route('/test', testRoutes)
  .route('/users', usersRoutes)
  .route('/realtime', realtimeRoutes)

const app = api
export type AppType = typeof routes

export default app
