import { type Auth, createAuth } from './better-auth'
import { getDb, getMongoClient } from './db'

let auth: Auth | undefined

/**
 * Lazy Singleton der Better-Auth-Instanz (eine DB-Verbindung pro warmem
 * Serverless-Storage). Frontend und API liegen auf derselben Domain →
 * kein CORS, keine trustedOrigins-Liste und kein Cross-Domain-Cookie nötig;
 * Better Auth vertraut automatisch der eigenen Origin (baseURL).
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
    })
  }

  return auth
}
