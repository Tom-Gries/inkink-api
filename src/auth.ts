import { type Auth, createAuth } from './better-auth.js'
import { getDb, getMongoClient } from './db.js'

let auth: Auth | undefined

/**
 * Lazy Singleton der Better-Auth-Instanz (eine DB-Verbindung pro warmem
 * Serverless-Storage). In Produktion liegen Frontend und API auf derselben
 * Domain → kein CORS, keine trustedOrigins-Liste und kein Cross-Domain-Cookie
 * nötig; Better Auth vertraut automatisch der eigenen Origin (baseURL).
 *
 * Lokal (Dev) laufen Web (:3000) und API (:8787) als getrennte Origins.
 * Damit Better Auth die callbackURL/Origin des Web-Frontends akzeptiert
 * (sonst INVALID_CALLBACK_URL/INVALID_ORIGIN), werden die Web-Origins als
 * trustedOrigins übergeben – bewusst nur außerhalb von Produktion.
 */
export function getAuth(): Auth {
  if (!auth) {
    const baseURL = process.env.BETTER_AUTH_URL ?? 'http://localhost:3000'
    const secret = process.env.BETTER_AUTH_SECRET ?? ''
    const googleClientId = process.env.GOOGLE_CLIENT_ID
    const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET
    const logLevel = process.env.AUTH_LOG_LEVEL as
      | 'debug'
      | 'info'
      | 'warn'
      | 'error'
      | undefined

    // Dev: Das Vite-Frontend läuft auf localhost:3000 (bzw. 127.0.0.1:3000),
    // die API auf localhost:8787. Better Auth validiert origin/callbackURL
    // gegen trustedOrigins – ohne die Web-Origins schlägt der Google-Flow
    // nach dem CORS-Fix mit INVALID_CALLBACK_URL fehl. In Produktion
    // (same-origin) bleibt die Liste leer.
    const trustedOrigins =
      process.env.NODE_ENV === 'production'
        ? undefined
        : ['http://localhost:3000', 'http://127.0.0.1:3000']

    console.log(
      '[auth:server] getAuth(): Erstelle Better-Auth-Instanz (lazy Singleton)',
    )
    console.log(`[auth:server] getAuth(): BETTER_AUTH_URL=${baseURL}`)
    console.log(
      `[auth:server] getAuth(): BETTER_AUTH_SECRET=${secret ? `gesetzt (${secret.length} Zeichen)` : 'FEHLT'}`,
    )
    console.log(
      `[auth:server] getAuth(): GOOGLE_CLIENT_ID=${googleClientId ? 'gesetzt' : 'FEHLT'}`,
    )
    console.log(
      `[auth:server] getAuth(): GOOGLE_CLIENT_SECRET=${googleClientSecret ? 'gesetzt' : 'FEHLT'}`,
    )
    console.log(
      `[auth:server] getAuth(): AUTH_LOG_LEVEL=${logLevel ?? '(Standard laut NODE_ENV)'}`,
    )
    console.log(
      `[auth:server] getAuth(): trustedOrigins=${trustedOrigins ? trustedOrigins.join(', ') : '(nur baseURL)'}`,
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
