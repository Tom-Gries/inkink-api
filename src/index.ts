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

const api = new Hono().basePath('/api')

/**
 * CORS
 */
api.use(
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

/**
 * Root-App
 *
 * Die API läuft unter /api/*.
 * Die Root-Domain / wird für eine kleine
 * OAuth-Diagnose-Seite verwendet.
 */
const app = new Hono()

app.get('/', (c) => {
  const url = new URL(c.req.url)

  const error = url.searchParams.get('error')
  const errorDescription = url.searchParams.get('error_description')

  const origin = c.req.header('Origin')
  const referer = c.req.header('Referer')
  const userAgent = c.req.header('User-Agent')

  return c.html(`
    <!doctype html>
    <html lang="de">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />

        <title>InkInk API – Auth Debug</title>

        <style>
          body {
            font-family: system-ui, sans-serif;
            max-width: 900px;
            margin: 40px auto;
            padding: 0 20px;
            background: #f5f5f5;
            color: #222;
          }

          .card {
            background: white;
            border-radius: 12px;
            padding: 24px;
            margin-bottom: 20px;
            box-shadow: 0 2px 10px rgba(0,0,0,.08);
          }

          h1 {
            margin-top: 0;
          }

          .error {
            color: #b00020;
            font-size: 20px;
            font-weight: 700;
          }

          code {
            background: #eee;
            padding: 3px 6px;
            border-radius: 4px;
          }

          dt {
            font-weight: 700;
            margin-top: 12px;
          }

          dd {
            margin-left: 0;
            word-break: break-word;
          }
        </style>
      </head>

      <body>
        <div class="card">
          <h1>InkInk API</h1>

          <p>
            Diese Seite dient zur Diagnose von OAuth/Auth-Problemen.
          </p>

          ${error
      ? `
                <p class="error">
                  OAuth Error: ${error}
                </p>
              `
      : `
                <p>
                  Keine OAuth-Fehlermeldung vorhanden.
                </p>
              `
    }

          ${errorDescription
      ? `
                <p>
                  <strong>Description:</strong>
                  ${errorDescription}
                </p>
              `
      : ''
    }
        </div>

        <div class="card">
          <h2>Request</h2>

          <dl>
            <dt>URL</dt>
            <dd><code>${url.href}</code></dd>

            <dt>Method</dt>
            <dd>${c.req.method}</dd>

            <dt>Origin</dt>
            <dd>${origin ?? '(nicht vorhanden)'}</dd>

            <dt>Referer</dt>
            <dd>${referer ?? '(nicht vorhanden)'}</dd>

            <dt>User-Agent</dt>
            <dd>${userAgent ?? '(nicht vorhanden)'}</dd>
          </dl>
        </div>

        <div class="card">
          <h2>Environment</h2>

          <dl>
            <dt>NODE_ENV</dt>
            <dd>${process.env.NODE_ENV ?? '(nicht gesetzt)'}</dd>

            <dt>BETTER_AUTH_URL</dt>
            <dd>${process.env.BETTER_AUTH_URL ?? '(nicht gesetzt)'}</dd>

            <dt>BETTER_AUTH_SECRET</dt>
            <dd>
              ${process.env.BETTER_AUTH_SECRET
      ? '✅ gesetzt'
      : '❌ fehlt'
    }
            </dd>

            <dt>MONGODB_URI</dt>
            <dd>
              ${process.env.MONGODB_URI
      ? '✅ gesetzt'
      : '❌ fehlt'
    }
            </dd>

            <dt>GOOGLE_CLIENT_ID</dt>
            <dd>
              ${process.env.GOOGLE_CLIENT_ID
      ? '✅ gesetzt'
      : '❌ fehlt'
    }
            </dd>

            <dt>GOOGLE_CLIENT_SECRET</dt>
            <dd>
              ${process.env.GOOGLE_CLIENT_SECRET
      ? '✅ gesetzt'
      : '❌ fehlt'
    }
            </dd>
          </dl>
        </div>

        <div class="card">
          <h2>Endpoints</h2>

          <ul>
            <li><code>/api/health</code></li>
            <li><code>/api/ping</code></li>
            <li><code>/api/auth/*</code></li>
          </ul>
        </div>
      </body>
    </html>
  `)
})

app.route('/', api)

export type AppType = typeof routes

export default app