import { type Auth, createAuth } from './better-auth.js'
import { getDb, getMongoClient } from './db.js'

let auth: Auth | undefined

/**
 * Lazy Singleton der Better-Auth-Instanz (eine DB-Verbindung pro warmem
 * Serverless-Storage).
 *
 * Production:
 * Frontend und API laufen auf getrennten Domains:
 *   Frontend: https://inkink-lilac.vercel.app
 *   API:      https://inkink-api.vercel.app
 *
 * Deshalb muss die Frontend-Origin als trustedOrigin bei Better Auth
 * eingetragen werden.
 *
 * Lokal:
 * Web (:3000) und API (:8787) laufen als getrennte Origins.
 * Deshalb werden auch die lokalen Web-Origins als trustedOrigins
 * angegeben.
 */
export function getAuth(): Auth {
  if (!auth) {
    const baseURL =
      process.env.BETTER_AUTH_URL ?? 'http://localhost:3000'

    const secret = process.env.BETTER_AUTH_SECRET ?? ''

    const googleClientId = process.env.GOOGLE_CLIENT_ID
    const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET

    const logLevel = process.env.AUTH_LOG_LEVEL as
      | 'debug'
      | 'info'
      | 'warn'
      | 'error'
      | undefined

    /**
     * Better Auth muss sowohl die lokale Frontend-Origin als auch
     * die Production-Frontend-Origin akzeptieren.
     *
     * Production:
     *   https://inkink-lilac.vercel.app
     *
     * API:
     *   https://inkink-api.vercel.app
     */
    const trustedOrigins = [
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'https://inkink-lilac.vercel.app',
    ]

    console.log(
      '[auth:server] getAuth(): Erstelle Better-Auth-Instanz (lazy Singleton)',
    )

    console.log(
      `[auth:server] getAuth(): BETTER_AUTH_URL=${baseURL}`,
    )

    console.log(
      `[auth:server] getAuth(): BETTER_AUTH_SECRET=${secret ? `gesetzt (${secret.length} Zeichen)` : 'FEHLT'
      }`,
    )

    console.log(
      `[auth:server] getAuth(): GOOGLE_CLIENT_ID=${googleClientId ? 'gesetzt' : 'FEHLT'
      }`,
    )

    console.log(
      `[auth:server] getAuth(): GOOGLE_CLIENT_SECRET=${googleClientSecret ? 'gesetzt' : 'FEHLT'
      }`,
    )

    console.log(
      `[auth:server] getAuth(): AUTH_LOG_LEVEL=${logLevel ?? '(Standard laut NODE_ENV)'
      }`,
    )

    console.log(
      `[auth:server] getAuth(): trustedOrigins=${trustedOrigins.join(', ')}`,
    )

    if (!secret) {
      console.warn(
        '[auth:server] getAuth(): BETTER_AUTH_SECRET ist nicht gesetzt – Auth wird fehlschlagen!',
      )
    }

    if (!googleClientId || !googleClientSecret) {
      console.warn(
        '[auth:server] getAuth(): Google-Credentials fehlen – Google-Login wird nicht funktionieren!',
      )
    }

    auth = createAuth({
      db: getDb(),
      mongoClient: getMongoClient(),
      baseURL,
      secret,
      googleClientId,
      googleClientSecret,
      logLevel,
      trustedOrigins,
    })
  }

  return auth
}