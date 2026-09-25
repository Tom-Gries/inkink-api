import { Hono } from 'hono'
import { cors } from 'hono/cors'
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
 * In Produktion liegen Frontend und API auf derselben Domain (Vercel-Rewrite
 * /api/*): keine CORS-Middleware nötig, und Better-Auth-Cookies (httpOnly,
 * SameSite) laufen zwischen allen /api/auth/*-Endpunkten normal – der frühere
 * state_mismatch-Fehler (getrennte Domains) ist damit gegenstandslos.
 *
 * Lokal (Dev) laufen Web (:3000) und API (:8787) als GETRENNTE Origins.
 * Deshalb wird außerhalb von Produktion eine CORS-Middleware für die
 * Web-Origins aktiviert – sonst blockiert der Browser den Google-Sign-in
 * (Preflight ohne Access-Control-Allow-Origin).
 */
const app = new Hono().basePath('/api')

// Dev: Das Vite-Frontend (http://localhost:3000) ruft die API (:8787)
// cross-origin auf – inklusive OAuth-Preflight. In Produktion sind beide
// same-origin (Vercel-Rewrite), dort ist kein CORS nötig.
if (process.env.NODE_ENV !== 'production') {
  app.use(
    '*',
    cors({
      origin: ['http://localhost:3000', 'http://127.0.0.1:3000'],
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization'],
      exposeHeaders: ['Content-Length'],
      maxAge: 600,
      credentials: true,
    }),
  )
}

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
